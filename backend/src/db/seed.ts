// Dados de demonstração. APAGA o banco de desenvolvimento antes de inserir.
// Usa os próprios serviços, então os dados respeitam as mesmas regras da aplicação.
import { sql as rawSql } from 'drizzle-orm';
import { config } from '../config.ts';
import type { Ctx } from '../lib/context.ts';
import { listAccessGroups } from '../services/accessGroups.ts';
import { register } from '../services/auth.ts';
import { createBankAccount } from '../services/bankAccounts.ts';
import { updateCompanySettings } from '../services/company.ts';
import { createCustomer } from '../services/customers.ts';
import { createExpense } from '../services/expenses.ts';
import { addInteraction, createOpportunity, setStatus } from '../services/opportunities.ts';
import { createOrder } from '../services/orders.ts';
import { createProduct } from '../services/products.ts';
import { convertQuote, createQuote, transitionQuote } from '../services/quotes.ts';
import { createSupplier } from '../services/suppliers.ts';
import { createUser } from '../services/users.ts';
import { db, sql } from './client.ts';

if (config.NODE_ENV === 'production') throw new Error('Seed não pode rodar em produção.');

export const DEMO_PASSWORD = 'senha-demo-123';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function truncateAll() {
  await db.execute(rawSql`
    TRUNCATE companies, users, sessions, people, person_contacts, person_addresses, products, opportunities, opportunity_items, pipeline_stages, interactions,
             quotes, quote_items, orders, order_items, bank_accounts, expenses, cash_transactions,
             audit_logs, events, access_groups, access_group_permissions RESTART IDENTITY CASCADE`);
}

// Convida pelo mesmo serviço da tela de usuários, usando um dos grupos padrão da empresa.
async function addUser(owner: Ctx, name: string, email: string, groupName: 'Vendedor' | 'Contador') {
  const group = (await listAccessGroups(owner)).find((item) => item.name === groupName);
  if (!group) throw new Error(`Grupo padrão "${groupName}" não encontrado.`);
  await createUser(owner, { name, email, groupId: group.id, password: DEMO_PASSWORD });
}

async function registerCompany(company: {
  name: string;
  prefix: string;
  owner: string;
  seller: string;
  accountant: string;
  quoteTerms: string;
}) {
  const { ctx: owner } = await register({
    companyName: company.name,
    name: company.owner,
    email: `dono@${company.prefix}.test`,
    password: DEMO_PASSWORD,
  });
  // Valor só de demonstração: cada empresa informa o limite vigente em Configurações.
  await updateCompanySettings(owner, {
    name: company.name,
    meiAnnualLimit: 81000,
    legalName: `${company.name} MEI`,
    address: 'Rua das Flores, 120 - Centro - Cuiabá/MT',
    phone: '(65) 3000-0000',
    email: `contato@${company.prefix}.test`,
    quoteTerms: company.quoteTerms,
  });
  await addUser(owner, company.seller, `vendedor@${company.prefix}.test`, 'Vendedor');
  await addUser(owner, company.accountant, `contador@${company.prefix}.test`, 'Contador');
  return owner;
}

// Empresa padrão: mini conveniência de bebidas, com o ciclo completo em situações diferentes.
async function seedConvenience() {
  const owner = await registerCompany({
    name: 'Conveniência da Esquina',
    prefix: 'conveniencia',
    owner: 'Marina Rocha',
    seller: 'Caio Lima',
    accountant: 'Rita Alves',
    quoteTerms:
      'Entrega em até 2 horas na região central. Pagamento em Pix, dinheiro ou cartão. Venda de bebida alcoólica proibida para menores de 18 anos.',
  });

  const product = (name: string, price: number, cost: number, stock: number) =>
    createProduct(owner, { name, type: 'product', price, cost, stock });
  const pilsen = await product('Cerveja Pilsen lata 350 ml', 4.5, 2.9, 240);
  const longNeck = await product('Cerveja Pilsen long neck 330 ml', 6.5, 4.2, 120);
  const pureMalt = await product('Cerveja Puro Malte lata 350 ml', 6, 3.8, 96);
  const cola = await product('Refrigerante cola 2 L', 11, 7.2, 48);
  const guarana = await product('Refrigerante guaraná 2 L', 9.5, 6, 36);
  const water = await product('Água mineral 500 ml', 3, 1.1, 120);
  await product('Água com gás 500 ml', 3.5, 1.4, 48);
  const energy = await product('Energético 250 ml', 12, 7.5, 40);
  const juice = await product('Suco de uva integral 1 L', 18, 11, 18);
  const wine = await product('Vinho tinto seco 750 ml', 45, 28, 12);
  await product('Vodka 1 L', 49.9, 31, 10);
  const ice = await product('Gelo 5 kg', 14, 6, 25);
  const charcoal = await product('Carvão 3 kg', 22, 13, 15);
  const peanuts = await product('Amendoim salgado 150 g', 7, 3.8, 30);
  const delivery = await createProduct(owner, {
    name: 'Entrega em domicílio',
    type: 'service',
    price: 8,
    cost: 3,
  });
  const bar = await createProduct(owner, {
    name: 'Montagem de bar para eventos',
    type: 'service',
    price: 250,
    cost: 90,
  });

  const barDoZe = await createCustomer(owner, {
    kind: 'company',
    name: 'Bar do Zé',
    legalName: 'José Almeida Bar Ltda',
    // CNPJs fictícios com dígitos verificadores válidos.
    document: '11.222.333/0001-81',
    zip: '78005300',
    street: 'Avenida Getúlio Vargas',
    number: '500',
    district: 'Centro',
    city: 'Cuiabá',
    state: 'MT',
    phone: '(65) 99999-1111',
    email: 'contato@bardoze.test',
  });
  const ana = await createCustomer(owner, {
    name: 'Ana Souza',
    phone: '(65) 98888-2222',
    email: 'ana@exemplo.test',
  });
  const joao = await createCustomer(owner, {
    name: 'João Pedro Martins',
    phone: '(65) 98777-3333',
  });
  const condo = await createCustomer(owner, {
    kind: 'company',
    name: 'Condomínio Jardim das Palmeiras',
    document: '11.444.777/0001-61',
    phone: '(65) 3111-4444',
    email: 'sindico@palmeiras.test',
  });

  await createSupplier(owner, {
    kind: 'company',
    name: 'Distribuidora Rio Claro Bebidas',
    phone: '(65) 3222-5555',
    email: 'vendas@rioclaro.test',
  });
  await createSupplier(owner, {
    kind: 'company',
    name: 'Gelo Polar',
    phone: '(65) 3222-6666',
  });

  const cash = await createBankAccount(owner, {
    bankName: 'Caixa físico',
    accountName: 'Caixa da loja',
    accountType: 'cash',
    initialBalance: 450,
  });
  const main = await createBankAccount(owner, {
    bankName: 'Banco comunitário',
    accountName: 'Conta principal',
    accountType: 'checking',
    initialBalance: 1250,
  });

  // Vendas de balcão e entregas dos últimos dois meses, para os indicadores não ficarem vazios.
  const sales = [
    {
      days: 58,
      items: [
        { productId: pilsen.id, quantity: 12 },
        { productId: ice.id, quantity: 1 },
      ],
    },
    { days: 49, customerId: barDoZe.id, items: [{ productId: longNeck.id, quantity: 24 }] },
    {
      days: 41,
      items: [
        { productId: cola.id, quantity: 2 },
        { productId: peanuts.id, quantity: 3 },
      ],
    },
    {
      days: 33,
      customerId: ana.id,
      items: [
        { productId: wine.id, quantity: 2 },
        { productId: delivery.id, quantity: 1 },
      ],
    },
    {
      days: 24,
      items: [
        { productId: energy.id, quantity: 4 },
        { productId: water.id, quantity: 6 },
      ],
    },
    {
      days: 16,
      customerId: barDoZe.id,
      items: [
        { productId: pureMalt.id, quantity: 24 },
        { productId: ice.id, quantity: 3 },
      ],
    },
    {
      days: 9,
      items: [
        { productId: pilsen.id, quantity: 18 },
        { productId: charcoal.id, quantity: 1 },
      ],
    },
    {
      days: 4,
      customerId: joao.id,
      items: [
        { productId: guarana.id, quantity: 3 },
        { productId: delivery.id, quantity: 1 },
      ],
    },
    {
      days: 2,
      items: [
        { productId: juice.id, quantity: 1 },
        { productId: water.id, quantity: 4 },
      ],
    },
  ];
  for (const [index, sale] of sales.entries()) {
    await createOrder(owner, {
      customerId: sale.customerId,
      orderDate: daysAgo(sale.days),
      status: 'paid',
      bankAccountId: index % 2 ? main.id : cash.id,
      notes: sale.customerId ? 'Entrega realizada' : 'Venda de balcão',
      items: sale.items,
    });
  }
  // A receber: fiado do bar, para aparecer em contas a receber.
  await createOrder(owner, {
    customerId: barDoZe.id,
    orderDate: daysAgo(1),
    discount: 10,
    notes: 'Acerto na sexta-feira',
    items: [{ productId: pilsen.id, quantity: 48 }],
  });

  const expenses = [
    {
      description: 'Compra de bebidas: Distribuidora Rio Claro',
      category: 'Mercadorias',
      amount: 480,
      days: 45,
    },
    { description: 'Aluguel do ponto', category: 'Operacional', amount: 350, days: 35 },
    {
      description: 'Compra de bebidas: Distribuidora Rio Claro',
      category: 'Mercadorias',
      amount: 390,
      days: 12,
    },
    { description: 'Compra de gelo: Gelo Polar', category: 'Mercadorias', amount: 60, days: 6 },
    { description: 'Energia dos freezers', category: 'Operacional', amount: 120, days: 3 },
  ];
  for (const expense of expenses) {
    await createExpense(owner, {
      description: expense.description,
      category: expense.category,
      amount: expense.amount,
      expenseDate: daysAgo(expense.days),
      status: 'paid',
      bankAccountId: main.id,
    });
  }
  await createExpense(owner, {
    description: 'Aluguel do ponto',
    category: 'Operacional',
    amount: 350,
    expenseDate: daysAgo(-5),
    status: 'pending',
    bankAccountId: main.id,
  });

  // Funil: uma oportunidade em cada situação, com documentos vinculados para mostrar o rastreio.
  const wedding = await createOpportunity(owner, {
    title: 'Bebidas para o casamento de Carla e Rafael',
    contactName: 'Carla Nunes',
    contactPhone: '(65) 97777-3333',
    source: 'Indicação',
    estimatedValue: 2800,
    expectedCloseDate: daysAgo(-20),
    nextAction: 'Confirmar a quantidade de convidados',
    nextActionAt: daysAgo(-2),
    items: [
      { productId: pilsen.id, quantity: 200 },
      { productId: water.id, quantity: 100 },
      { productId: bar.id, quantity: 1 },
    ],
  });
  await addInteraction(owner, wedding.id, {
    kind: 'call',
    channel: 'whatsapp',
    description: 'Festa para 120 pessoas. Quer bar montado e entrega no salão.',
  });
  const weddingQuote = await createQuote(owner, {
    opportunityId: wedding.id,
    validUntil: daysAgo(-15),
    freight: 60,
    siteDescription: 'Salão de festas Bela Vista',
    notes: 'Bebidas consignadas: o que não for aberto pode ser devolvido.',
    internalNotes: 'Confirmar disponibilidade da distribuidora.',
    items: [
      { productId: pilsen.id, quantity: 200 },
      { productId: water.id, quantity: 100 },
      { productId: bar.id, quantity: 1 },
    ],
  });
  await transitionQuote(owner, weddingQuote.id, 'send');

  const party = await createOpportunity(owner, {
    title: 'Confraternização do Condomínio Jardim das Palmeiras',
    customerId: condo.id,
    source: 'Instagram',
    estimatedValue: 690,
    nextAction: 'Combinar o horário da entrega',
    nextActionAt: daysAgo(-1),
  });
  const partyQuote = await createQuote(owner, {
    customerId: condo.id,
    opportunityId: party.id,
    validUntil: daysAgo(-10),
    freight: 25,
    items: [
      { productId: pureMalt.id, quantity: 60 },
      { productId: guarana.id, quantity: 12 },
      { productId: ice.id, quantity: 8 },
    ],
  });
  await transitionQuote(owner, partyQuote.id, 'send');
  await transitionQuote(owner, partyQuote.id, 'approve');
  await convertQuote(owner, partyQuote.id, {
    orderDate: daysAgo(1),
    status: 'paid',
    bankAccountId: main.id,
  });

  await createOpportunity(owner, {
    title: 'Reposição semanal do Bar do Zé',
    customerId: barDoZe.id,
    source: 'Cliente da casa',
    estimatedValue: 520,
    nextAction: 'Ligar para oferecer contrato semanal',
    nextActionAt: daysAgo(1),
  });
  const birthday = await createOpportunity(owner, {
    title: 'Aniversário de 40 anos do João Pedro',
    customerId: joao.id,
    source: 'Balcão',
    estimatedValue: 400,
  });
  const birthdayQuote = await createQuote(owner, {
    customerId: joao.id,
    opportunityId: birthday.id,
    validUntil: daysAgo(-3),
    items: [
      { productId: pilsen.id, quantity: 72 },
      { productId: charcoal.id, quantity: 4 },
    ],
  });
  await transitionQuote(owner, birthdayQuote.id, 'send');
  await transitionQuote(owner, birthdayQuote.id, 'reject', { reason: 'Achou o preço alto' });
  await setStatus(owner, birthday.id, { status: 'lost', lostReason: 'Preço' });

  // Rascunho avulso, sem oportunidade.
  await createQuote(owner, {
    customerId: ana.id,
    validUntil: daysAgo(-7),
    items: [
      { productId: wine.id, quantity: 6 },
      { productId: delivery.id, quantity: 1 },
    ],
  });
}

// Segunda empresa, para mostrar que os dados de uma não aparecem na outra.
async function seedOtherCompany() {
  const owner = await registerCompany({
    name: 'Doces da Vila',
    prefix: 'doces',
    owner: 'Helena Prado',
    seller: 'Bruno Dias',
    accountant: 'Sônia Reis',
    quoteTerms: 'Encomendas com 3 dias de antecedência.',
  });
  const cake = await createProduct(owner, {
    name: 'Bolo de pote',
    type: 'product',
    price: 12,
    cost: 5,
    stock: 30,
  });
  const customer = await createCustomer(owner, { name: 'Lúcia Campos', phone: '(65) 98666-7777' });
  const account = await createBankAccount(owner, {
    bankName: 'Caixa físico',
    accountName: 'Caixa',
    accountType: 'cash',
    initialBalance: 100,
  });
  await createOrder(owner, {
    customerId: customer.id,
    orderDate: daysAgo(1),
    status: 'paid',
    bankAccountId: account.id,
    items: [{ productId: cake.id, quantity: 6 }],
  });
}

await truncateAll();
await seedConvenience();
await seedOtherCompany();
await sql.end();

console.log(`Seed concluído. Usuários (senha "${DEMO_PASSWORD}"):`);
for (const prefix of ['conveniencia', 'doces']) {
  console.log(`  dono@${prefix}.test · vendedor@${prefix}.test · contador@${prefix}.test`);
}
