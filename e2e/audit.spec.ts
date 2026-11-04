import { expect, test } from '@playwright/test';
import { capture, chooseOption, login, OWNER, SELLER, toast } from './helpers.ts';

test('proprietário filtra a auditoria e abre o detalhe da alteração', async ({ page }) => {
  await login(page, OWNER);

  // Altera um produto pela tela, para ter o que procurar.
  await page.goto('/produtos');
  const row = page.getByRole('row', { name: /Consultoria financeira/ });
  await row.getByRole('button', { name: /Editar/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Preço').fill('275');
  await dialog.getByRole('button', { name: /Salvar/ }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('link', { name: 'Auditoria', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Auditoria' }).first()).toBeVisible();
  const filters = page.getByRole('form', { name: 'Filtros da auditoria' });
  await chooseOption(filters.getByLabel('Módulo'), 'Produtos e serviços');
  await filters.getByLabel('Ação').selectOption('update');
  const line = page.getByRole('row', { name: /Consultoria financeira/ }).first();
  await expect(line).toContainText('Alterou preço');
  await expect(line).toContainText('Dona Ateliê Aranduê');
  await capture(page, 'auditoria');

  await line.getByRole('link', { name: 'Alterou preço' }).click();
  await expect(page).toHaveURL(/\/historico\/\d+$/);
  await expect(page.getByRole('row', { name: /Preço\s+R\$\s*260,00\s+R\$\s*275,00/ })).toBeVisible();
  await page.getByRole('link', { name: 'Abrir produtos e serviços' }).click();
  await expect(page).toHaveURL(/\/produtos$/);
});

test('dado pessoal alterado aparece como protegido', async ({ page }) => {
  await login(page, OWNER);
  const people = await (await page.request.get('/api/people?role=customer')).json();
  const ana = people.find((person: { name: string }) => person.name === 'Ana Souza');

  await page.goto(`/pessoas/${ana.id}`);
  await page.getByLabel('E-mail').first().fill('ana.nova@exemplo.test');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(toast(page, 'salvo')).toBeVisible();

  await page.goto('/auditoria');
  await chooseOption(
    page.getByRole('form', { name: 'Filtros da auditoria' }).getByLabel('Módulo'),
    'Pessoas',
  );
  await page
    .getByRole('row', { name: /Ana Souza/ })
    .first()
    .getByRole('link', { name: /Alterou/ })
    .click();
  await expect(page.getByRole('row', { name: /E-mail\s+Alterado \(valor protegido\)/ })).toBeVisible();
  await expect(page.getByText('ana.nova@exemplo.test')).toHaveCount(0);
});

test('vendedor não vê a auditoria no menu nem pela URL', async ({ page }) => {
  await login(page, SELLER);
  await expect(page.getByRole('link', { name: 'Auditoria', exact: true })).toHaveCount(0);
  await page.goto('/auditoria');
  await expect(page.getByRole('heading', { name: 'Filtros' })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Entrou no sistema/ })).toHaveCount(0);
});
