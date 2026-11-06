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
  SELLER,
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
  await expect(change).toContainText('Marina Rocha');
  await expect(historyRow(page, /Criou o orçamento/)).toBeVisible();
  await capture(page, 'orcamento-historico');

  await change.click();
  await expect(page).toHaveURL(/\/historico\/\d+$/);
  await expect(
    page.getByText(/^Por Marina Rocha em \d{2}\/\d{2}\/\d{2,4}.*\d{2}:\d{2}:\d{2}$/),
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
  await expect(mirror).toHaveTitle(/Orçamento #\d+ - Conveniência da Esquina/);
  await expect(mirror.getByText('Conveniência da Esquina MEI')).toBeVisible();
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

test('espelho interno mostra custo e margem, e o vendedor não tem acesso', async ({ page }) => {
  const path = await createQuote(page);
  const popup = page.waitForEvent('popup');
  await openMenuItem(page, 'Espelho interno');
  const mirror = await popup;

  await expect(mirror.getByRole('note')).toHaveText('Uso interno: não enviar ao cliente');
  await expect(mirror).toHaveTitle(/USO INTERNO - Orçamento #\d+/);
  await expect(mirror.getByRole('cell', { name: SERVICE })).toBeVisible();
  // Entrega em domicílio: preço R$ 8, custo R$ 3.
  await expect(mirror.getByRole('cell', { name: 'R$ 3,00' }).first()).toBeVisible();
  await expect(mirror.locator('.mirror-total')).toContainText('62,5%');
  await capture(mirror, 'espelho-interno');
  await mirror.close();

  // Quem não tem a permissão não vê a opção, e a página não abre os dados.
  const context = await page.context().browser()?.newContext();
  if (!context) throw new Error('Sem navegador.');
  const seller = await context.newPage();
  await login(seller, SELLER);
  await seller.goto(path);
  await seller.getByRole('button', { name: /^Ações:/ }).click();
  await expect(seller.getByRole('menuitem', { name: 'Espelho do cliente', exact: true })).toBeVisible();
  await expect(seller.getByRole('menuitem', { name: 'Espelho interno', exact: true })).toHaveCount(0);
  await seller.goto(`/espelho/orcamento/${path.split('/').pop()}/interno`);
  await expect(seller.getByRole('alert')).toBeVisible();
  await expect(seller.getByText('Uso interno')).toHaveCount(0);
  await context.close();
});

test('grupo e parcelas saem no espelho, e a soma precisa fechar com o total', async ({ page }) => {
  await createQuote(page);
  await page.locator('input[name="items.0.quantity"]:visible').fill('3');
  await page.locator('input[name="items.0.groupName"]:visible').fill('Cozinha');

  await page.getByText('Parcelas', { exact: true }).click();
  await page.getByLabel('Número de parcelas').fill('2');
  await page.getByLabel('Forma de pagamento').fill('Pix');
  await page.getByRole('button', { name: 'Gerar parcelas' }).click();
  await expect(page.getByText(/Soma das parcelas: R\$\s24,00 de R\$\s24,00/)).toBeVisible();

  // Valor diferente do total: o servidor recusa e o formulário mostra o motivo.
  await page.locator('input[name="installments.1.amount"]').fill('1');
  await expect(page.getByText('Ajuste os valores para salvar.')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('alert')).toContainText('A soma das parcelas');

  await page.locator('input[name="installments.1.amount"]').fill('12');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toast(page, 'Orçamento salvo.')).toBeVisible();

  const popup = page.waitForEvent('popup');
  await openMenuItem(page, 'Espelho do cliente');
  const mirror = await popup;
  await expect(mirror.getByRole('cell', { name: 'Cozinha', exact: true })).toBeVisible();
  await expect(mirror.getByRole('cell', { name: 'Subtotal de Cozinha' })).toBeVisible();
  await expect(mirror.getByRole('heading', { name: 'Condição de pagamento' })).toBeVisible();
  await expect(mirror.getByRole('cell', { name: 'Pix' })).toHaveCount(2);
  await capture(mirror, 'espelho-grupos-parcelas');
  await mirror.close();
});

test('medidas: duas caixas na unidade escolhida em Configurações, e a quantidade vira m²', async ({
  page,
}) => {
  const settings = async (enabled: boolean, unit?: string) => {
    await page.goto('/configuracoes');
    const box = page.getByLabel('Usar largura e comprimento nos itens do orçamento');
    await box.setChecked(enabled);
    if (unit) await page.getByLabel('Digitar as medidas em').selectOption(unit);
    const saved = page.waitForResponse(
      (response) => response.url().endsWith('/company') && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    expect((await saved).status()).toBe(200);
  };

  // Desligado: sem as caixas, e a unidade nem aparece em Configurações.
  await page.goto('/orcamentos/novo');
  await expect(page.getByLabel(/^Largura/)).toHaveCount(0);
  await page.goto('/configuracoes');
  await expect(page.getByLabel('Digitar as medidas em')).toHaveCount(0);

  await settings(true, 'cm');
  await createQuote(page);
  const width = page.locator('input[name="items.0.width"]:visible');
  const length = page.locator('input[name="items.0.length"]:visible');
  await expect(page.getByLabel('Largura (cm)')).toBeVisible();
  await expect(page.getByLabel('Comprimento (cm)')).toBeVisible();
  await width.fill('250');
  await length.fill('150');
  const quantity = page.locator('input[name="items.0.quantity"]:visible');
  await expect(quantity).toHaveValue('3.75');
  await expect(quantity).toHaveJSProperty('readOnly', true);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toast(page, 'Orçamento salvo.')).toBeVisible();
  const path = new URL(page.url()).pathname;

  const popup = page.waitForEvent('popup');
  await openMenuItem(page, 'Espelho do cliente');
  const mirror = await popup;
  await expect(mirror.getByText('250 × 150 cm')).toBeVisible();
  await expect(mirror.getByRole('cell', { name: '3,75 m²' })).toBeVisible();
  await capture(mirror, 'espelho-medidas');
  await mirror.close();

  // Mudar a unidade vale para itens novos: o item salvo continua como foi digitado.
  await settings(true, 'mm');
  await page.goto(path);
  await expect(page.getByLabel('Largura (cm)')).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar item' }).click();
  await expect(page.getByLabel('Largura (mm)')).toBeVisible();
  await page.locator('input[name="items.1.width"]:visible').fill('2000');
  await page.locator('input[name="items.1.length"]:visible').fill('500');
  await expect(page.locator('input[name="items.1.quantity"]:visible')).toHaveValue('1');

  await settings(false);
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

test('reabrir volta para rascunho, permite alterar e exige novo envio', async ({ page }) => {
  await createQuote(page);
  await sendQuote(page);
  await expect(page.getByText('Para alterar, use "Reabrir para alterar"')).toBeVisible();
  await expect(page.getByLabel('Desconto (R$)')).toBeDisabled();

  await openMenuItem(page, 'Reabrir para alterar');
  await confirmWithReason(page, 'Reabrir orçamento', 'Cliente pediu alteração');
  await expect(page.getByRole('heading', { name: /Orçamento #\d+ Rascunho/ })).toBeVisible();

  await page.getByLabel('Desconto (R$)').fill('5');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toast(page, 'Orçamento salvo.')).toBeVisible();
  await sendQuote(page);

  await openHistory(page);
  await expect(historyRow(page, /Reabriu para alterar.*Motivo: Cliente pediu alteração/)).toBeVisible();
  await expect(historyRow(page, /Alterou desconto/)).toBeVisible();
});

test('proprietário pode excluir orçamento reaberto, com aviso de que já foi enviado', async ({ page }) => {
  await createQuote(page);
  await sendQuote(page);
  await openMenuItem(page, 'Reabrir para alterar');
  await confirmWithReason(page, 'Reabrir orçamento', 'Erro no orçamento');
  await expect(page.getByRole('heading', { name: /Orçamento #\d+ Rascunho/ })).toBeVisible();

  let question = '';
  page.once('dialog', (dialog) => {
    question = dialog.message();
    return dialog.accept();
  });
  await openMenuItem(page, 'Excluir');
  await expect(toast(page, 'excluído.')).toBeVisible();
  expect(question).toContain('já foi enviado ao cliente');
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
