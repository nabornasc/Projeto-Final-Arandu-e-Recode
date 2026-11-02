import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addMember, type Client, createApp, signupCompany } from './helpers.ts';

let app: FastifyInstance;
let owner: Client;

beforeAll(async () => {
  app = await createApp();
  owner = await signupCompany(app);
});
afterAll(() => app.close());
afterEach(() => vi.restoreAllMocks());

// CNPJ e CPF fictícios com dígitos verificadores válidos.
const CNPJ = '11.222.333/0001-81';
const CPF = '529.982.247-25';

const company = (overrides: Record<string, unknown> = {}) => ({
  kind: 'company',
  document: CNPJ,
  name: 'Pedras do Vale',
  legalName: 'Pedras do Vale Ltda',
  isCustomer: true,
  ...overrides,
});

describe('cadastro único de pessoas', () => {
  it('valida CPF/CNPJ, guarda só dígitos e não repete documento na mesma empresa', async () => {
    expect((await owner.post('/people', company({ document: '12.345.678/0001-90' }))).body.message).toBe(
      'CNPJ inválido',
    );
    expect(
      (
        await owner.post('/people', {
          name: 'X',
          kind: 'individual',
          document: '111.111.111-11',
          isCustomer: true,
        })
      ).status,
    ).toBe(400);
    expect((await owner.post('/people', { name: 'Sem papel' })).status).toBe(400);

    const created = await owner.post('/people', company());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ document: '11222333000181', kind: 'company', isCustomer: true });

    const dup = await owner.post('/people', company({ name: 'Outro' }));
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/Pedras do Vale/);
    // Em outra empresa, o mesmo CNPJ é permitido.
    const other = await signupCompany(app);
    expect((await other.post('/people', company())).status).toBe(201);
  });

  it('uma pessoa com vários papéis aparece em cada lista e a busca acha por nome, documento e telefone', async () => {
    const both = (
      await owner.post('/people', {
        kind: 'individual',
        document: CPF,
        name: 'Carlos Marceneiro',
        phone: '(66) 99876-5432',
        city: 'Rondonópolis',
        state: 'MT',
        isCustomer: true,
        isSupplier: true,
      })
    ).body;
    const ids = async (path: string) => (await owner.get(path)).body.map((p: { id: number }) => p.id);
    expect(await ids('/customers')).toContain(both.id);
    expect(await ids('/suppliers')).toContain(both.id);
    expect(await ids('/people?role=carrier')).not.toContain(both.id);
    expect(await ids('/people?q=marceneiro')).toEqual([both.id]);
    expect(await ids('/people?q=529982')).toEqual([both.id]);
    expect(await ids('/people?q=98765')).toEqual([both.id]);
    expect(await ids('/people?q=rondon')).toEqual([both.id]);
  });

  it('salva contatos, endereços extras e dados comerciais; transportadora precisa ter o papel', async () => {
    const carrier = (
      await owner.post('/people', { name: 'Transportes Rápidos', kind: 'company', isCarrier: true })
    ).body;
    const notCarrier = (await owner.post('/people', { name: 'Cliente comum', isCustomer: true })).body;
    expect(
      (await owner.post('/people', { name: 'Y', isCustomer: true, carrierId: notCarrier.id })).status,
    ).toBe(400);

    const person = (
      await owner.post('/people', {
        name: 'Construtora Horizonte',
        kind: 'company',
        isCustomer: true,
        zip: '78700-000',
        freightType: 'recipient',
        carrierId: carrier.id,
        paymentTerms: 'Entrada + 30 dias',
        creditLimit: 5000,
        contacts: [{ name: 'Joana', role: 'Compras', phone: '(66) 3333-0000' }],
        addresses: [
          { kind: 'delivery', street: 'Rua da Obra', number: '10', city: 'Rondonópolis', state: 'MT' },
        ],
      })
    ).body;
    expect(person).toMatchObject({ zip: '78700000', carrierName: 'Transportes Rápidos', creditLimit: 5000 });
    expect(person.contacts).toHaveLength(1);
    expect(person.addresses[0]).toMatchObject({ kind: 'delivery', street: 'Rua da Obra' });

    // Sem as listas no corpo, contatos e endereços ficam como estavam.
    const kept = await owner.put(`/people/${person.id}`, {
      name: 'Construtora Horizonte S.A.',
      kind: 'company',
    });
    expect(kept.body.contacts).toHaveLength(1);
    expect(kept.body.isCustomer).toBe(true);
    const cleared = await owner.put(`/people/${person.id}`, {
      name: 'Construtora Horizonte',
      kind: 'company',
      contacts: [],
    });
    expect(cleared.body.contacts).toHaveLength(0);
  });

  it('permissões por papel e vendedor da carteira', async () => {
    const seller = await addMember(app, owner, 'seller');
    const sellerId = (await seller.get('/auth/me')).body.id;
    const ownerId = (await owner.get('/auth/me')).body.id;

    // Vendedor cadastra cliente (fica na carteira dele), mas não fornecedor.
    const mine = await seller.post('/people', { name: 'Cliente do vendedor', isCustomer: true });
    expect(mine.status).toBe(201);
    expect(mine.body.sellerId).toBe(sellerId);
    expect((await seller.post('/people', { name: 'F', isCustomer: true, isSupplier: true })).status).toBe(
      403,
    );
    expect((await seller.post('/people', { name: 'C', isCustomer: true, sellerId: ownerId })).status).toBe(
      403,
    );
    // Trocar o vendedor exige customers.assign; editar o resto não.
    expect(
      (await seller.put(`/people/${mine.body.id}`, { name: 'Renomeado', sellerId: ownerId })).status,
    ).toBe(403);
    expect((await seller.put(`/people/${mine.body.id}`, { name: 'Renomeado', sellerId })).status).toBe(200);
    expect(
      (await owner.put(`/people/${mine.body.id}`, { name: 'Renomeado', sellerId: ownerId })).body.sellerName,
    ).toBe('Dono');

    const accountant = await addMember(app, owner, 'accountant');
    expect((await accountant.get('/people?role=supplier')).status).toBe(200);
    expect((await accountant.post('/people', { name: 'Z', isCustomer: true })).status).toBe(403);
  });

  it('pessoa usada em documento é arquivada; sem uso, é excluída', async () => {
    const used = (await owner.post('/people', { name: 'Usado', isCustomer: true })).body;
    const productId = (await owner.post('/products', { name: 'Serviço', type: 'service', price: 10 })).body
      .id;
    await owner.post('/quotes', { customerId: used.id, items: [{ productId, quantity: 1 }] });
    expect((await owner.del(`/people/${used.id}`)).status).toBe(204);
    expect((await owner.get(`/people/${used.id}`)).body.active).toBe(false);
    expect((await owner.get('/customers')).body.map((p: { id: number }) => p.id)).not.toContain(used.id);

    const unused = (await owner.post('/people', { name: 'Sem uso', isCustomer: true })).body;
    expect((await owner.del(`/people/${unused.id}`)).status).toBe(204);
    expect((await owner.get(`/people/${unused.id}`)).status).toBe(404);
  });
});

describe('consulta de CNPJ e CEP', () => {
  const respond = (status: number, body: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('preenche dados do CNPJ e indica o regime', async () => {
    const fetchMock = respond(200, {
      razao_social: 'PEDRAS DO VALE LTDA',
      nome_fantasia: 'Pedras do Vale',
      cep: '78700000',
      logradouro: 'Rua A',
      numero: '1',
      bairro: 'Centro',
      municipio: 'Rondonópolis',
      uf: 'MT',
      opcao_pelo_simples: true,
    });
    const response = await owner.get('/lookup/cnpj/11222333000181');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'Pedras do Vale',
      legalName: 'PEDRAS DO VALE LTDA',
      city: 'Rondonópolis',
      taxRegime: 'simples',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://brasilapi.com.br/api/cnpj/v1/11222333000181');
  });

  it('recusa CNPJ inválido sem consultar, trata não encontrado e serviço fora do ar', async () => {
    const fetchMock = respond(404, {});
    expect((await owner.get('/lookup/cnpj/12345678000190')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await owner.get('/lookup/cnpj/11222333000181')).status).toBe(404);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    const down = await owner.get('/lookup/cnpj/11222333000181');
    expect(down.status).toBe(502);
    expect(down.body.message).toMatch(/Preencha manualmente/);
  });

  it('consulta CEP e informa CEP inexistente', async () => {
    respond(200, { logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' });
    expect((await owner.get('/lookup/cep/01310-100')).body).toMatchObject({
      zip: '01310100',
      city: 'São Paulo',
      state: 'SP',
    });
    vi.restoreAllMocks();
    respond(200, { erro: 'true' });
    expect((await owner.get('/lookup/cep/99999999')).status).toBe(404);
    expect((await owner.get('/lookup/cep/123')).status).toBe(400);
  });
});
