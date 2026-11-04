import { expect, type Locator, type Page } from '@playwright/test';

// Usuários criados pelo seed (backend/src/db/seed.ts).
export const OWNER = 'dono@atelie.test';
export const SELLER = 'vendedor@atelie.test';
export const ACCOUNTANT = 'contador@atelie.test';
export const OTHER_COMPANY_OWNER = 'dono@doces.test';
export const PASSWORD = 'senha-demo-123';

export const SERVICE = 'Identidade visual';
export const STOCK_PRODUCT = 'Kit papelaria artesanal';
export const CUSTOMER = 'Ana Souza';

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

// O rótulo da opção inclui o estoque, que muda: escolhe pelo trecho do nome.
export async function chooseOption(select: Locator, text: string) {
  const option = select.locator('option', { hasText: text });
  await expect(option).toHaveCount(1);
  await select.selectOption((await option.getAttribute('value')) ?? '');
}

export const itemSelect = (page: Page, index: number) =>
  page.locator(`select[name="items.${index}.productId"]:visible`);

export async function openMenuItem(page: Page, item: string) {
  await page.getByRole('button', { name: /^Ações:/ }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

export const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

export async function createQuote(page: Page) {
  await page.goto('/orcamentos/novo');
  await chooseOption(page.getByLabel('Cliente'), CUSTOMER);
  await chooseOption(itemSelect(page, 0), SERVICE);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page).toHaveURL(/\/orcamentos\/\d+$/);
  await expect(page.getByRole('heading', { name: /Orçamento #\d+/ })).toBeVisible();
  return new URL(page.url()).pathname;
}

export async function createOrder(page: Page, quantity = '1') {
  await page.goto('/pedidos/novo');
  await chooseOption(page.getByLabel('Cliente'), CUSTOMER);
  await chooseOption(itemSelect(page, 0), STOCK_PRODUCT);
  await page.locator('input[name="items.0.quantity"]:visible').fill(quantity);
  await page.getByRole('button', { name: 'Criar pedido' }).click();
  await expect(page).toHaveURL(/\/pedidos\/\d+$/);
  await expect(page.getByRole('heading', { name: /Pedido #\d+/ })).toBeVisible();
  return new URL(page.url()).pathname;
}

export async function sendQuote(page: Page) {
  await openMenuItem(page, 'Enviar ao cliente');
  await expect(page.getByRole('heading', { name: /Orçamento #\d+ Enviado/ })).toBeVisible();
}

export const openHistory = (page: Page) => page.getByRole('tab', { name: 'Histórico' }).click();

export const historyRow = (page: Page, text: RegExp) =>
  page.getByRole('region', { name: 'Histórico de alterações' }).getByRole('link', { name: text });

// Motivo pedido na janela de recusar ou cancelar: sem ele, a janela não fecha.
export async function confirmWithReason(page: Page, confirm: string, reason: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: confirm }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Informe o motivo.');
  await dialog.getByLabel('Motivo').fill(reason);
  await dialog.getByRole('button', { name: confirm }).click();
  await expect(dialog).toBeHidden();
}

// Telas guardadas para conferência visual (pasta ignorada pelo Git).
export const capture = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/telas/${name}.png`, fullPage: true });
