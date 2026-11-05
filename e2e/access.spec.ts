import { expect, test } from '@playwright/test';
import {
  ACCOUNTANT,
  createQuote,
  historyRow,
  login,
  OTHER_COMPANY_OWNER,
  OWNER,
  openHistory,
  PASSWORD,
  SELLER,
  sendQuote,
} from './helpers.ts';

test('senha errada não entra, e a mensagem não revela se o e-mail existe', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(OWNER);
  await page.locator('input[name="password"]').fill(`${PASSWORD}-errada`);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const wrongPassword = (await page.getByRole('alert').textContent()) ?? '';

  await page.locator('input[name="email"]').fill('ninguem@conveniencia.test');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(wrongPassword);
  await expect(page).toHaveURL(/\/login/);
});

test('sem sessão, as telas levam ao login', async ({ page }) => {
  await page.goto('/orcamentos');
  await expect(page).toHaveURL(/\/login/);
});

test('outra empresa não abre o documento nem o histórico', async ({ page, context }) => {
  await login(page, OWNER);
  const path = await createQuote(page);
  await openHistory(page);
  await historyRow(page, /Criou o orçamento/).click();
  await expect(page).toHaveURL(/\/historico\/\d+$/);
  const entry = new URL(page.url()).pathname;

  await context.clearCookies();
  await login(page, OTHER_COMPANY_OWNER);
  await page.goto(path);
  await expect(page.getByText('Orçamento não encontrado.')).toBeVisible();
  await page.goto(entry);
  await expect(page.getByText('Registro não encontrado.')).toBeVisible();
});

test('vendedor cancela, mas não aprova', async ({ page }) => {
  await login(page, SELLER);
  await createQuote(page);
  await sendQuote(page);
  await page.getByRole('button', { name: /^Ações:/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Cancelar orçamento' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Aprovar' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Recusar' })).toHaveCount(0);
});

test('contador consulta o histórico, mas não altera', async ({ page, context, baseURL }) => {
  await login(page, OWNER);
  const path = await createQuote(page);
  await sendQuote(page);

  await context.clearCookies();
  await login(page, ACCOUNTANT);
  await page.goto('/orcamentos');
  await expect(page.getByRole('heading', { name: 'Orçamentos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo orçamento' })).toHaveCount(0);

  await page.goto(path);
  await expect(page.getByRole('button', { name: 'Salvar' })).toHaveCount(0);
  await openHistory(page);
  await expect(historyRow(page, /Enviou ao cliente/)).toBeVisible();

  // O servidor nega mesmo sem passar pela tela.
  const id = path.split('/').at(-1);
  const response = await page.request.post(`/api/quotes/${id}/cancel`, {
    data: { reason: 'tentativa' },
    headers: { origin: baseURL ?? '' },
  });
  expect(response.status()).toBe(403);
});
