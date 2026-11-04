import { expect, type Page, test } from '@playwright/test';
import {
  confirmWithReason,
  createOrder,
  historyRow,
  itemSelect,
  login,
  OWNER,
  openHistory,
  openMenuItem,
  STOCK_PRODUCT,
  toast,
} from './helpers.ts';

test.beforeEach(({ page }) => login(page, OWNER));

async function stockInForm(page: Page) {
  await page.goto('/pedidos/novo');
  const label = (await itemSelect(page, 0).locator('option', { hasText: STOCK_PRODUCT }).textContent()) ?? '';
  return Number(label.match(/estoque: (\d+)/)?.[1]);
}

test('baixa, cancelamento com motivo e reativação ficam no histórico, e o estoque acompanha', async ({
  page,
}) => {
  const before = await stockInForm(page);
  const path = await createOrder(page, '2');
  expect(await stockInForm(page)).toBe(before - 2);

  await page.goto(path);
  await openMenuItem(page, 'Dar baixa (recebido)');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(page.getByRole('heading', { name: /Pago/ })).toBeVisible();

  await openMenuItem(page, 'Cancelar pedido');
  await confirmWithReason(page, 'Cancelar pedido', 'Falta de estoque');
  await expect(page.getByRole('heading', { name: /Cancelado/ })).toBeVisible();
  expect(await stockInForm(page)).toBe(before);

  await page.goto(path);
  await openMenuItem(page, 'Reativar pedido');
  await expect(page.getByRole('heading', { name: /Pendente/ })).toBeVisible();
  expect(await stockInForm(page)).toBe(before - 2);

  await page.goto(path);
  await openHistory(page);
  await expect(historyRow(page, /Criou o pedido/)).toBeVisible();
  await expect(historyRow(page, /Deu baixa no recebimento/)).toBeVisible();
  await expect(historyRow(page, /Cancelou.*Motivo: Falta de estoque/)).toBeVisible();
  await expect(historyRow(page, /Reativou/)).toBeVisible();

  await historyRow(page, /Deu baixa no recebimento/).click();
  await expect(page.getByRole('row', { name: /Status\s+Pendente\s+Pago/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Conta\s+—/ })).toBeVisible();
});

test('edição do pedido registra o campo alterado', async ({ page }) => {
  await createOrder(page);
  await page.getByLabel('Observações').fill('Entregar na sexta');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toast(page, 'Pedido salvo.')).toBeVisible();

  await openHistory(page);
  const line = historyRow(page, /Alterou observações/);
  await line.click();
  await expect(page.getByRole('row', { name: /Observações\s+—\s+Entregar na sexta/ })).toBeVisible();
});
