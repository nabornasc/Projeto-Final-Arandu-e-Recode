import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Client, createApp, PASSWORD, signupCompany, today } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;
let seller: Client & { userId: number };
let accountant: Client;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
  seller = await addMember(app, owner, 'seller');
  accountant = await addMember(app, owner, 'accountant');
});
afterAll(() => app.close());

const latest = async (module: string, client: Client = owner) => {
  const { rows } = (await client.get(`/history?module=${encodeURIComponent(module)}`)).body;
  return (await client.get(`/history/entry/${rows[0].id}`)).body;
};

interface Change {
  field: string;
  from: unknown;
  to: unknown;
}
const changeOf = (entry: { changes: Change[] }, field: string) =>
  entry.changes.find((change) => change.field === field);

describe('registro detalhado nos demais módulos', () => {
  it('produto: criar, alterar, salvar sem mudar, arquivar e excluir', async () => {
    const product = (await owner.post('/products', { name: 'Caneca', type: 'product', price: 30, stock: 5 }))
      .body;
    expect(await latest('Produtos e serviços')).toMatchObject({
      summary: 'Criou o produto',
      label: 'Caneca',
      path: '/produtos',
    });

    const body = { name: 'Caneca azul', type: 'product', price: 35, stock: 5 };
    await owner.put(`/products/${product.id}`, body);
    const edited = await latest('Produtos e serviços');
    expect(edited.summary).toBe('Alterou nome e preço');
    expect(changeOf(edited, 'price')).toMatchObject({ from: 30, to: 35, label: 'Preço', kind: 'money' });

    const before = (await owner.get('/history?module=Produtos%20e%20servi%C3%A7os')).body.total;
    await owner.put(`/products/${product.id}`, body);
    expect((await owner.get('/history?module=Produtos%20e%20servi%C3%A7os')).body.total).toBe(before);

    await owner.post('/orders', {
      orderDate: today(),
      items: [{ productId: product.id, quantity: 1 }],
    });
    await owner.del(`/products/${product.id}`);
    const archived = await latest('Produtos e serviços');
    expect(archived.summary).toBe('Arquivou o produto');
    expect(changeOf(archived, 'active')).toMatchObject({ from: true, to: false, kind: 'boolean' });

    const unused = (await owner.post('/products', { name: 'Temporário', type: 'service', price: 1 })).body;
    await owner.del(`/products/${unused.id}`);
    expect(await latest('Produtos e serviços')).toMatchObject({
      summary: 'Excluiu o produto',
      label: 'Temporário',
      documentExists: false,
      path: null,
    });
  });

  it('financeiro: despesa e movimentação guardam valores e a conta pelo nome', async () => {
    const account = (
      await owner.post('/bank-accounts', {
        bankName: 'Banco',
        accountName: 'Principal',
        accountType: 'checking',
        initialBalance: 100,
      })
    ).body;
    const base = {
      description: 'Aluguel',
      category: 'Fixas',
      amount: 500,
      expenseDate: today(),
      status: 'pending',
      bankAccountId: account.id,
    };
    const expense = (await owner.post('/expenses', base)).body;
    await owner.put(`/expenses/${expense.id}`, { ...base, amount: 550, status: 'paid' });
    const entry = await latest('Contas a pagar');
    expect(changeOf(entry, 'amount')).toMatchObject({ from: 500, to: 550 });
    expect(changeOf(entry, 'status')).toMatchObject({ from: 'pending', to: 'paid', kind: 'status' });

    await owner.post('/transactions', {
      type: 'income',
      category: 'Outros',
      description: 'Aporte',
      amount: 10,
      transactionDate: today(),
      bankAccountId: account.id,
    });
    expect(changeOf(await latest('Movimentações'), 'bankAccount')).toMatchObject({
      to: 'Banco — Principal',
    });
  });

  it('oportunidade: perda com motivo e mudança de etapa com os nomes', async () => {
    const stages = (await owner.get('/pipeline-stages')).body;
    const opportunity = (
      await owner.post('/opportunities', { title: 'Venda grande', contactName: 'Ana', source: 'Site' })
    ).body;
    await owner.post(`/opportunities/${opportunity.id}/stage`, { stageId: stages[1].id });
    const moved = await latest('CRM');
    expect(moved.summary).toBe('Mudou a etapa');
    expect(changeOf(moved, 'stage')).toMatchObject({ from: stages[0].name, to: stages[1].name });

    await owner.post(`/opportunities/${opportunity.id}/status`, { status: 'lost', lostReason: 'Preço' });
    expect(await latest('CRM')).toMatchObject({
      summary: 'Marcou como perdida',
      reason: 'Preço',
      path: `/crm/${opportunity.id}`,
    });
  });

  it('grupo de acesso mostra as permissões concedidas e retiradas pelo nome', async () => {
    const group = (await owner.post('/access-groups', { name: 'Caixa', permissions: ['cash.read'] })).body;
    await owner.put(`/access-groups/${group.id}`, { name: 'Caixa', permissions: ['payables.read'] });
    const entry = await latest('Grupos de acesso');
    expect(changeOf(entry, 'permissionsAdded')?.to).toMatch(/Contas a pagar \(despesas\): Ver/);
    expect(changeOf(entry, 'permissionsRemoved')?.from).toMatch(/Movimentações de caixa: Ver/);
  });
});

describe('dados protegidos', () => {
  it('cadastro registra que CPF, e-mail e telefone mudaram, sem guardar os valores', async () => {
    const person = (
      await owner.post('/customers', {
        name: 'Maria',
        kind: 'individual',
        document: '52998224725',
        email: 'maria@exemplo.test',
        phone: '66999990000',
      })
    ).body;
    const created = await latest('Pessoas');
    expect(JSON.stringify(created)).not.toMatch(/52998224725|maria@exemplo|66999990000/);

    await owner.put(`/people/${person.id}`, {
      name: 'Maria Souza',
      kind: 'individual',
      isCustomer: true,
      document: '11144477735',
      email: 'outra@exemplo.test',
      phone: '66988880000',
    });
    const edited = await latest('Pessoas');
    const text = JSON.stringify(edited);
    expect(text).not.toMatch(/11144477735|52998224725|outra@exemplo|maria@exemplo|6698888/);
    expect(changeOf(edited, 'name')).toMatchObject({ from: 'Maria', to: 'Maria Souza' });
    for (const field of ['document', 'email', 'phone']) {
      expect(changeOf(edited, field)).toMatchObject({ masked: true, from: null, to: null });
    }
  });

  it('troca de senha aparece como alterada, sem nenhum valor', async () => {
    const list = (await owner.get('/users')).body;
    const target = list.find((user: { id: number }) => user.id === seller.userId);
    await owner.put(`/users/${seller.userId}`, {
      name: target.name,
      groupId: target.groupId,
      active: true,
      password: `${PASSWORD}-nova`,
    });
    const entry = await latest('Usuários');
    expect(changeOf(entry, 'password')).toMatchObject({ masked: true, from: null, to: null });
    expect(JSON.stringify(entry)).not.toMatch(/senha-de-teste|argon2|mantida|alterada/);
  });
});

describe('tela geral de auditoria', () => {
  it('filtra por usuário, módulo, ação e período, com paginação', async () => {
    const other = await signupCompany(app);
    for (let index = 0; index < 55; index++) {
      await other.post('/products', { name: `P${index}`, type: 'service', price: 1 });
    }
    const first = (await other.get('/history?module=Produtos%20e%20servi%C3%A7os')).body;
    expect(first.total).toBe(55);
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0].label).toBe('P54');
    const second = (await other.get('/history?module=Produtos%20e%20servi%C3%A7os&page=2')).body;
    expect(second.rows).toHaveLength(5);

    expect((await other.get('/history?action=delete')).body.total).toBe(0);
    expect((await other.get('/history?action=create')).body.total).toBeGreaterThanOrEqual(55);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect((await other.get(`/history?from=${future}`)).body.total).toBe(0);
    expect((await other.get(`/history?to=${future}`)).body.total).toBeGreaterThan(0);

    const { actors } = (await other.get('/history/options')).body;
    expect(actors).toHaveLength(1);
    expect((await other.get(`/history?userId=${actors[0].id}`)).body.total).toBeGreaterThan(0);
    expect((await other.get(`/history?userId=${seller.userId}`)).body.total).toBe(0);
    expect((await other.get('/history?action=inventada')).status).toBe(400);
  });

  it('login aparece na auditoria', async () => {
    const { rows } = (await owner.get(`/history?action=login&userId=${seller.userId}`)).body;
    expect(rows[0]).toMatchObject({ summary: 'Entrou no sistema', label: null });
  });

  it('não mistura empresas', async () => {
    const other = await signupCompany(app);
    const { rows } = (await owner.get('/history')).body;
    expect((await other.get(`/history/entry/${rows[0].id}`)).status).toBe(404);
    const theirs = (await other.get('/history')).body.rows;
    expect(theirs.map((row: { id: number }) => row.id)).not.toContain(rows[0].id);
  });

  it('exige audit.read: vendedor e contador não veem a tela nem outros módulos', async () => {
    const entry = (await owner.get('/history?module=Produtos%20e%20servi%C3%A7os')).body.rows[0];
    // A troca de senha acima encerrou a sessão do vendedor: entra um novo.
    for (const client of [await addMember(app, owner, 'seller'), accountant]) {
      expect((await client.get('/history')).status).toBe(403);
      expect((await client.get('/history/options')).status).toBe(403);
      expect((await client.get(`/history/entry/${entry.id}`)).status).toBe(403);
    }
  });

  it('grupo com audit.read vê tudo, inclusive documentos fora do escopo "só os próprios"', async () => {
    const auditors = (
      await owner.post('/access-groups', {
        name: 'Auditores',
        ownOnly: true,
        permissions: ['audit.read', 'quotes.read'],
      })
    ).body;
    const auditor = await addMember(app, owner, auditors.id);
    expect((await auditor.get('/history')).status).toBe(200);

    const product = (await owner.post('/products', { name: 'Item', type: 'service', price: 5 })).body;
    const quote = (await owner.post('/quotes', { items: [{ productId: product.id, quantity: 1 }] })).body;
    const [line] = (await owner.get(`/history/quote/${quote.id}`)).body;
    expect((await auditor.get(`/history/entry/${line.id}`)).status).toBe(200);
    // Na aba do documento, o escopo do grupo continua valendo.
    expect((await auditor.get(`/history/quote/${quote.id}`)).status).toBe(404);
  });
});
