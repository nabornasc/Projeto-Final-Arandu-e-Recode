import { expect, type Locator, test } from '@playwright/test';
import { capture, createQuote, login, OWNER, openMenuItem, sendQuote } from './helpers.ts';

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error('Elemento sem posição na tela.');
  return value;
}

test.beforeEach(({ page }) => login(page, OWNER));

test('o "x" da aba fica à esquerda do título e fecha a aba', async ({ page }) => {
  await createQuote(page);
  const tab = page.getByRole('navigation', { name: 'Telas abertas' }).locator('.tab.active');
  const close = tab.getByRole('button', { name: /^Fechar/ });

  const closeBox = await box(close);
  const titleBox = await box(tab.locator('.tab-title'));
  expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(titleBox.x + 1);
  await capture(page, 'abas');

  const title = (await tab.locator('.tab-title').textContent()) ?? '';
  await close.click();
  await expect(page.getByRole('navigation', { name: 'Telas abertas' }).getByText(title)).toHaveCount(0);
});

test('o "x" da janela fica à esquerda do título e fecha a janela', async ({ page }) => {
  await createQuote(page);
  await sendQuote(page);
  await openMenuItem(page, 'Cancelar orçamento');

  const dialog = page.getByRole('dialog');
  const close = dialog.getByRole('button', { name: 'Fechar janela' });
  const closeBox = await box(close);
  const titleBox = await box(dialog.getByRole('heading'));
  expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(titleBox.x);

  await close.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: /Enviado/ })).toBeVisible();
});

test('aba de documento guarda o rascunho não salvo ao trocar de tela', async ({ page }) => {
  await createQuote(page);
  await page.getByLabel('Desconto (R$)').fill('7');

  const tabs = page.getByRole('navigation', { name: 'Telas abertas' });
  await expect(tabs.getByRole('img', { name: 'Alterações não salvas' })).toBeVisible();
  const code = (await tabs.locator('.tab.active .tab-title').textContent())?.match(/#\d+/)?.[0] ?? '';

  await page.getByRole('link', { name: 'Orçamentos', exact: true }).first().click();
  await expect(page).toHaveURL(/\/orcamentos$/);
  await tabs.locator('.tab-title', { hasText: code }).click();
  await expect(page.getByLabel('Desconto (R$)')).toHaveValue('7');
});
