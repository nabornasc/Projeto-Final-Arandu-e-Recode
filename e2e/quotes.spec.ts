import { expect, test } from '@playwright/test';
import {
  capture,
  chooseOption,
  confirmWithReason,
  createQuote,
  historyRow,
  itemSelect,
  login,
  OWNER,
  openHistory,
  openMenuItem,
  SERVICE,
  STOCK_PRODUCT,
  sendQuote,
  toast,
} from './helpers.ts';

test.beforeEach(({ page }) => login(page, OWNER));

test('alteração aparece no histórico e o clique abre antes e depois', async ({ page }) => {
  const path = await createQuote(page);

  await page.getByLabel('Desconto (R$)').fill('10');
  await page.locator('input[name="items.0.quantity"]:visible').fill('2');
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await chooseOption(itemSelect(page, 1), STOCK_PRODUCT);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toast(page, 'Orçamento salvo.')).toBeVisible();

  await capture(page, 'orcamento-documento');
  await openHistory(page);
  const change = historyRow(page, /Alterou desconto.*itens/);
  await expect(change).toBeVisible();
  await expect(change).toContainText('Dona Ateliê Arandu');
  await expect(historyRow(page, /Criou o orçamento/)).toBeVisible();
  await capture(page, 'orcamento-historico');

  await change.click();
  await expect(page).toHaveURL(/\/historico\/\d+$/);
  await expect(
    page.getByText(/^Por Dona Ateliê Arandu em \d{2}\/\d{2}\/\d{2,4}.*\d{2}:\d{2}:\d{2}$/),
  ).toBeVisible();
  await expect(page.getByRole('row', { name: /Desconto\s+R\$\s*0,00\s+R\$\s*10,00/ })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`Item alterado: ${SERVICE}`) })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`Item incluído: ${STOCK_PRODUCT}`) })).toBeVisible();
  await capture(page, 'historico-detalhe');

  await page.getByRole('link', { name: 'Abrir orçamento' }).click();
  await expect(page).toHaveURL(path);
});

test('salvar sem mudar nada não cria linha no histórico', async ({ page }) => {
  await createQuote(page);
  await page.getByLabel('Observações').fill('');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toast(page, 'Orçamento salvo.')).toBeVisible();

  await openHistory(page);
  await expect(page.getByRole('region', { name: 'Histórico de alterações' }).getByRole('link')).toHaveCount(
    1,
  );
});

test('espelho do cliente mostra o documento e esconde a observação interna', async ({ page }) => {
  await createQuote(page);
  await page.getByText('Entrega, frete e observação interna').click();
  await page.getByLabel('Frete (R$)').fill('30');
  await page.getByLabel('Local de entrega ou serviço').fill('Loja do centro');
  await page.getByLabel('Observação interna').fill('Cliente pede desconto');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toast(page, 'Orçamento salvo.')).toBeVisible();

  const popup = page.waitForEvent('popup');
  await openMenuItem(page, 'Espelho do cliente');
  const mirror = await popup;

  await expect(mirror.getByRole('heading', { name: /Orçamento #\d+/ })).toBeVisible();
  await expect(mirror).toHaveTitle(/Orçamento #\d+ - Ateliê Arandu/);
  await expect(mirror.getByText('Ateliê Arandu MEI')).toBeVisible();
  await expect(mirror.getByText('Rascunho: ainda não enviado ao cliente.')).toBeVisible();
  await expect(mirror.getByRole('cell', { name: SERVICE })).toBeVisible();
  await expect(mirror.getByText('Loja do centro')).toBeVisible();
  await expect(mirror.getByText(/^Frete/)).toBeVisible();
  await expect(mirror.getByText('Cliente pede desconto')).toHaveCount(0);
  await expect(mirror.getByRole('button', { name: 'Imprimir / Salvar PDF' })).toBeVisible();
  await capture(mirror, 'espelho-cliente');

  // Na impressão, sai só a folha.
  await mirror.emulateMedia({ media: 'print' });
  await expect(mirror.getByRole('button', { name: 'Imprimir / Salvar PDF' })).toBeHidden();
  await mirror.close();
});

test('logo enviado em Configurações sai no espelho, e o botão abre a impressão', async ({ page }) => {
  const saveSettings = async () => {
    const saved = page.waitForResponse(
      (response) => response.url().endsWith('/company') && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    expect((await saved).status()).toBe(200);
  };

  await page.goto('/configuracoes');
  await page.locator('input[name="logo"]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(page.getByAltText('Logo atual da empresa')).toBeVisible();
  await saveSettings();

  await createQuote(page);
  const popup = page.waitForEvent('popup');
  await openMenuItem(page, 'Espelho do cliente');
  const mirror = await popup;

  const logo = mirror.getByRole('img', { name: /^Logo de / });
  await expect(logo).toBeVisible();
  // Largura natural zero indicaria imagem bloqueada pela CSP ou corrompida.
  expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  await mirror.evaluate(() => {
    (window as unknown as { printed: boolean }).printed = false;
    window.print = () => {
      (window as unknown as { printed: boolean }).printed = true;
    };
  });
  await mirror.getByRole('button', { name: 'Imprimir / Salvar PDF' }).click();
  expect(await mirror.evaluate(() => (window as unknown as { printed: boolean }).printed)).toBe(true);
  await mirror.close();

  // Os outros testes não esperam logo na empresa.
  await page.goto('/configuracoes');
  await page.getByRole('button', { name: 'Remover logo' }).click();
  await saveSettings();
});

test('recusar exige motivo, e o motivo fica no histórico', async ({ page }) => {
  await createQuote(page);
  await sendQuote(page);

  await openMenuItem(page, 'Recusar');
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture(page, 'janela-motivo');
  await confirmWithReason(page, 'Recusar orçamento', 'Achou caro');
  await expect(page.getByRole('heading', { name: /Recusado/ })).toBeVisible();

  await openHistory(page);
  await expect(historyRow(page, /Recusou.*Motivo: Achou caro/)).toBeVisible();
});

test('cancelar exige motivo; cancelado sai do menu e continua no histórico', async ({ page }) => {
  await createQuote(page);
  await sendQuote(page);

  await openMenuItem(page, 'Cancelar orçamento');
  await confirmWithReason(page, 'Cancelar orçamento', 'Pedido do cliente');
  await expect(page.getByRole('heading', { name: /Cancelado/ })).toBeVisible();

  await page.getByRole('button', { name: /^Ações:/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Duplicar' })).toBeVisible();
  for (const gone of ['Cancelar orçamento', 'Aprovar', 'Excluir']) {
    await expect(page.getByRole('menuitem', { name: gone, exact: true })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');

  await openHistory(page);
  const line = historyRow(page, /Cancelou.*Motivo: Pedido do cliente/);
  await line.click();
  await expect(page.getByText('Pedido do cliente')).toBeVisible();
  await expect(page.getByRole('row', { name: /Status\s+Enviado\s+Cancelado/ })).toBeVisible();
});

test('só rascunho oferece excluir', async ({ page }) => {
  await createQuote(page);
  await page.getByRole('button', { name: /^Ações:/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Excluir', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Cancelar orçamento' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await sendQuote(page);
  await page.getByRole('button', { name: /^Ações:/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Excluir', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Cancelar orçamento' })).toBeVisible();
});

test('registro continua consultável depois de excluir o rascunho', async ({ page }) => {
  await createQuote(page);
  await openHistory(page);
  await historyRow(page, /Criou o orçamento/).click();
  await expect(page).toHaveURL(/\/historico\/\d+$/);
  const entry = page.url();

  await page.getByRole('link', { name: 'Abrir orçamento' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await openMenuItem(page, 'Excluir');
  await expect(toast(page, 'excluído.')).toBeVisible();

  await page.goto(entry);
  await expect(page.getByText('Documento excluído')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir orçamento' })).toHaveCount(0);
});

test('orçamento aprovado vira pedido, com o caminho nos dois históricos', async ({ page }) => {
  await createQuote(page);
  await sendQuote(page);
  await openMenuItem(page, 'Aprovar');
  await expect(page.getByRole('heading', { name: /Aprovado/ })).toBeVisible();

  await openMenuItem(page, 'Converter em pedido');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar pedido' }).click();
  await expect(page).toHaveURL(/\/pedidos\/\d+$/);
  // A URL muda antes de o pedido aparecer: até lá, a aba Histórico na tela é a do orçamento.
  await expect(page.getByRole('heading', { name: /Pedido #\d+ / })).toBeVisible();
  await openHistory(page);
  await expect(historyRow(page, /Criou o pedido a partir do orçamento/)).toBeVisible();

  await page.getByRole('button', { name: /^Ações:/ }).click();
  await page.getByRole('menuitem', { name: 'Abrir orçamento de origem' }).click();
  await expect(page).toHaveURL(/\/orcamentos\/\d+$/);
  // Espera a troca de aba terminar: o pedido também tem uma aba "Histórico".
  await expect(page.getByRole('heading', { name: /Orçamento #\d+ Aprovado/ })).toBeVisible();
  await openHistory(page);
  await expect(historyRow(page, /Converteu no pedido #\d+/)).toBeVisible();
  await page.getByRole('button', { name: /^Ações:/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Cancelar orçamento' })).toHaveCount(0);
});
