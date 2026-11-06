import { expect, type Page, test } from '@playwright/test';
import { CUSTOMER, capture, chooseOption, itemSelect, login, OWNER, SERVICE, toast } from './helpers.ts';

const totalOf = (page: Page, name: string) =>
  page.locator('.list-totals dl > div').filter({ hasText: name }).locator('dd');

test.beforeEach(({ page }) => login(page, OWNER));

test('atalhos de período preenchem as datas, com semana de segunda a domingo', async ({ page }) => {
  // Quarta-feira.
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00-04:00'));
  await page.goto('/pedidos');
  const period = page.getByLabel('Data do pedido');
  const from = page.getByLabel('De', { exact: true });
  const to = page.getByLabel('Até', { exact: true });

  const expected: [string, string, string][] = [
    ['Hoje', '2026-11-04', '2026-11-04'],
    ['Ontem', '2026-11-03', '2026-11-03'],
    ['Amanhã', '2026-11-05', '2026-11-05'],
    ['Esta semana', '2026-11-02', '2026-11-08'],
    ['Semana passada', '2026-10-26', '2026-11-01'],
    ['Semana que vem', '2026-11-09', '2026-11-15'],
    ['Este mês', '2026-11-01', '2026-11-30'],
    ['Mês passado', '2026-10-01', '2026-10-31'],
    ['Mês que vem', '2026-12-01', '2026-12-31'],
    ['Este ano', '2026-01-01', '2026-12-31'],
    ['Ano passado', '2025-01-01', '2025-12-31'],
    ['Ano que vem', '2027-01-01', '2027-12-31'],
  ];
  for (const [label, start, end] of expected) {
    await period.selectOption({ label });
    await expect(from, label).toHaveValue(start);
    await expect(to, label).toHaveValue(end);
  }

  // Mudar a data à mão vira período personalizado.
  await from.fill('2026-10-15');
  await expect(period).toHaveValue('custom');
  await period.selectOption({ label: 'Todos' });
  await expect(from).toHaveValue('');
});

test('pedidos: busca e status filtram a lista e os totais, e limpar restaura', async ({ page }) => {
  await page.goto('/pedidos');
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  const all = await rows.count();
  await expect(totalOf(page, 'Registros')).toHaveText(String(all));

  // Sem diferenciar acentos nem maiúsculas.
  await page.getByLabel('Cliente ou número').fill('bar do ze');
  await page.getByLabel('Status').selectOption({ label: 'Pago' });
  await expect(rows).toHaveCount(2);
  await capture(page, 'lista-pedidos');
  await expect(totalOf(page, 'Valor total')).toHaveText(/R\$\s342,00/);
  await expect(totalOf(page, 'Em aberto')).toHaveText(/R\$\s0,00/);

  await page.getByLabel('Status').selectOption({ label: 'Pendente' });
  await expect(rows).toHaveCount(1);
  await expect(totalOf(page, 'Em aberto')).toHaveText(/R\$\s206,00/);

  await page.getByLabel('Cliente ou número').fill('nao existe');
  await expect(page.getByText('Nenhum registro com esses filtros.')).toBeVisible();
  await expect(totalOf(page, 'Registros')).toHaveText('0');

  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(rows).toHaveCount(all);
  await expect(page.getByRole('button', { name: 'Limpar filtros' })).toBeDisabled();
});

test('pedidos: período exclui o que está fora das datas', async ({ page }) => {
  await page.goto('/pedidos');
  await page.getByLabel('De', { exact: true }).fill('2000-01-01');
  await page.getByLabel('Até', { exact: true }).fill('2000-01-31');
  await expect(page.getByText('Nenhum registro com esses filtros.')).toBeVisible();
});

test('orçamentos filtram por número e por status', async ({ page }) => {
  await page.goto('/orcamentos');
  await page.getByLabel('Cliente ou número').fill('#001');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '#001', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();

  await page.getByLabel('Status').selectOption({ label: 'Recusado' });
  await expect(page.getByRole('cell', { name: 'João Pedro Martins' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Carla Nunes' })).toHaveCount(0);
  // Recusado e cancelado não somam no total em negociação.
  await expect(totalOf(page, 'Valor total')).toHaveText(/R\$\s0,00/);
});

test('contas a pagar filtram por status e descrição, com total pago e em aberto', async ({ page }) => {
  await page.goto('/despesas');
  await page.getByLabel('Descrição, categoria ou fornecedor').fill('aluguel');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(totalOf(page, 'Valor total')).toHaveText(/R\$\s700,00/);
  await expect(totalOf(page, 'Pago')).toHaveText(/R\$\s350,00/);
  await expect(totalOf(page, 'Em aberto')).toHaveText(/R\$\s350,00/);

  await page.getByLabel('Status').selectOption({ label: 'Pendente' });
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(totalOf(page, 'Pago')).toHaveText(/R\$\s0,00/);
});

test('contas a receber filtram por cliente', async ({ page }) => {
  await page.goto('/contas-a-receber');
  await page.getByLabel('Cliente ou número').fill('Bar do Zé');
  await expect(page.getByRole('cell', { name: 'Bar do Zé' }).first()).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(totalOf(page, 'Valor total')).toHaveText(/R\$\s206,00/);
});

test('pedido parcelado gera contas, baixa por parcela e fica pago só na última', async ({ page }) => {
  await page.goto('/pedidos/novo');
  await chooseOption(page.getByLabel('Cliente'), CUSTOMER);
  await chooseOption(itemSelect(page, 0), SERVICE);
  await page.locator('input[name="items.0.quantity"]:visible').fill('2');
  await page.getByText('Parcelas', { exact: true }).click();
  await page.getByLabel('Número de parcelas').fill('2');
  await page.getByLabel('Forma de pagamento').fill('Boleto');
  await page.getByRole('button', { name: 'Gerar parcelas' }).click();
  await page.getByRole('button', { name: 'Criar pedido' }).click();
  await expect(page).toHaveURL(/\/pedidos\/\d+$/);

  const table = page.getByRole('table', { name: 'Contas a receber do pedido' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('cell', { name: '1/2', exact: true })).toBeVisible();
  const heading = await page.getByRole('heading', { name: /Pedido #\d+/ }).innerText();
  const code = heading.match(/#\d+/)?.[0] ?? '';

  await page.goto('/contas-a-receber');
  await page.getByLabel('Cliente ou número').fill(code);
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await capture(page, 'contas-a-receber');
  await page.getByRole('button', { name: `Dar baixa: pedido ${code}, parcela 1/2` }).click();
  await page.getByLabel('Data do recebimento').fill('2026-11-01');
  await page.getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(toast(page, 'registrada no caixa')).toBeVisible();
  // A parcela paga sai da visão padrão, de contas em aberto.
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Status').selectOption({ label: 'Todos' });
  await expect(page.getByRole('cell', { name: 'Recebida' })).toBeVisible();

  await page.goto('/pedidos');
  await page.getByLabel('Cliente ou número').fill(code);
  await expect(page.getByText('· parcial')).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`Ações: pedido ${code}`) }).click();
  await page.getByRole('menuitem', { name: 'Dar baixa (recebido)' }).click();
  await page.getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(toast(page, 'registrada no caixa')).toBeVisible();
  await expect(page.locator('tbody tr').getByText('Pago', { exact: true })).toBeVisible();
  await expect(page.getByText('· parcial')).toHaveCount(0);
});

test('despesa com fornecedor aparece na lista e na busca', async ({ page }) => {
  await page.goto('/despesas');
  await page.getByRole('button', { name: 'Novo registro' }).click();
  await page.getByLabel('Descrição', { exact: true }).fill('Compra de carvão');
  await page.getByLabel('Categoria (ex.: Aluguel)').fill('Mercadorias');
  await page.getByLabel('Valor (R$)').fill('80');
  await page.locator('select[name="supplierId"]').selectOption({ label: 'Gelo Polar' });
  await page.getByRole('button', { name: /Salvar|Criar/ }).click();
  await expect(toast(page, 'Registro criado')).toBeVisible();
  await page.getByLabel('Descrição, categoria ou fornecedor').fill('gelo polar');
  await expect(page.getByRole('cell', { name: 'Compra de carvão' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Gelo Polar' }).first()).toBeVisible();
});

test('imprimir lista abre a impressão e sai só a lista, com o resumo dos filtros', async ({ page }) => {
  await page.goto('/pedidos');
  await page.getByLabel('Cliente ou número').fill('Bar do Zé');
  await page.evaluate(() => {
    (window as unknown as { printed: boolean }).printed = false;
    window.print = () => {
      (window as unknown as { printed: boolean }).printed = true;
    };
  });
  await page.getByRole('button', { name: 'Imprimir lista' }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: boolean }).printed)).toBe(true);

  await expect(page.locator('.list-print-summary')).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.locator('.list-totals dl')).toBeVisible();
  await capture(page, 'lista-impressao');
  await expect(page.locator('.list-print-summary')).toContainText('Bar do Zé');
  for (const hidden of ['.sidebar', '.topbar', '.tabbar', '.list-filters', '.list-print', 'td.actions']) {
    await expect(page.locator(hidden).first(), hidden).toBeHidden();
  }
});
