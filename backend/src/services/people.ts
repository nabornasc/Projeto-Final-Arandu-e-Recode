import { can, type Permission } from '@arandue/shared/permissions';
import { type PersonInput, type PersonRole, personSchema } from '@arandue/shared/schemas';
import { and, asc, eq, ilike, ne, or, type SQL, sql } from 'drizzle-orm';
import { type DbOrTx, db, type Transaction } from '../db/client.ts';
import {
  opportunities,
  orders,
  people,
  personAddresses,
  personContacts,
  quotes,
  users,
} from '../db/schema.ts';
import { diffFields, initialFields, pick, removedFields } from '../lib/changes.ts';
import { authorize, authorizeAny, type Ctx } from '../lib/context.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { audit, personName, userName } from './audit.ts';

// Cada papel usa as permissões de uma área: cliente → customers; fornecedor, transportadora e
// representante → suppliers. Mexer numa pessoa exige a permissão de todos os papéis envolvidos.
const ROLE_FLAG = {
  customer: 'isCustomer',
  supplier: 'isSupplier',
  carrier: 'isCarrier',
  sales_rep: 'isSalesRep',
} as const satisfies Record<PersonRole, string>;
const ROLE_AREA: Record<PersonRole, 'customers' | 'suppliers'> = {
  customer: 'customers',
  supplier: 'suppliers',
  carrier: 'suppliers',
  sales_rep: 'suppliers',
};
const ROLES = Object.keys(ROLE_FLAG) as PersonRole[];
const ROLE_COLUMN = {
  customer: people.isCustomer,
  supplier: people.isSupplier,
  carrier: people.isCarrier,
  sales_rep: people.isSalesRep,
};

type Flags = Record<(typeof ROLE_FLAG)[PersonRole], boolean>;
const rolesOf = (flags: Flags) => ROLES.filter((role) => flags[ROLE_FLAG[role]]);
const requireFor = (ctx: Ctx, roles: PersonRole[], action: 'create' | 'update' | 'delete') => {
  for (const area of new Set(roles.map((role) => ROLE_AREA[role])))
    authorize(ctx, `${area}.${action}` as Permission);
};

const scoped = (ctx: Ctx, id: number) => and(eq(people.id, id), eq(people.companyId, ctx.companyId));

const summary = {
  id: people.id,
  kind: people.kind,
  document: people.document,
  name: people.name,
  legalName: people.legalName,
  isCustomer: people.isCustomer,
  isSupplier: people.isSupplier,
  isCarrier: people.isCarrier,
  isSalesRep: people.isSalesRep,
  email: people.email,
  phone: people.phone,
  mobile: people.mobile,
  city: people.city,
  state: people.state,
  active: people.active,
};

export interface ListFilter {
  role?: PersonRole;
  q?: string;
}

export async function listPeople(ctx: Ctx, filter: ListFilter = {}) {
  let roleFilter: SQL | undefined;
  if (filter.role) {
    authorize(ctx, `${ROLE_AREA[filter.role]}.read` as Permission);
    roleFilter = eq(ROLE_COLUMN[filter.role], true);
  } else {
    // Sem papel: só as pessoas de papéis que o grupo pode ver.
    const visible = ROLES.filter((role) => can(ctx.permissions, `${ROLE_AREA[role]}.read` as Permission));
    if (!visible.length) throw forbidden();
    roleFilter = or(...visible.map((role) => eq(ROLE_COLUMN[role], true)));
  }

  const term = filter.q?.trim();
  const digits = term?.replace(/\D/g, '');
  const search = term
    ? or(
        ilike(people.name, `%${term}%`),
        ilike(people.legalName, `%${term}%`),
        ilike(people.email, `%${term}%`),
        ilike(people.city, `%${term}%`),
        digits && digits.length >= 3
          ? or(
              ilike(people.document, `%${digits}%`),
              sql`regexp_replace(coalesce(${people.phone}, '') || coalesce(${people.mobile}, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}`,
            )
          : undefined,
      )
    : undefined;

  return db
    .select(summary)
    .from(people)
    .where(and(eq(people.companyId, ctx.companyId), eq(people.active, true), roleFilter, search))
    .orderBy(asc(people.name))
    .limit(500);
}

export async function getPerson(ctx: Ctx, id: number) {
  const [person] = await db.select().from(people).where(scoped(ctx, id));
  if (!person) throw notFound('Cadastro não encontrado.');
  authorizeAny(
    ctx,
    rolesOf(person).map((role) => `${ROLE_AREA[role]}.read` as Permission),
  );
  const [contacts, addresses, seller, carrier] = await Promise.all([
    db.select().from(personContacts).where(eq(personContacts.personId, id)).orderBy(asc(personContacts.id)),
    db
      .select()
      .from(personAddresses)
      .where(eq(personAddresses.personId, id))
      .orderBy(asc(personAddresses.id)),
    person.sellerId
      ? db.select({ name: users.name }).from(users).where(eq(users.id, person.sellerId))
      : Promise.resolve([]),
    person.carrierId
      ? db.select({ name: people.name }).from(people).where(eq(people.id, person.carrierId))
      : Promise.resolve([]),
  ]);
  return {
    ...person,
    sellerName: seller[0]?.name ?? null,
    carrierName: carrier[0]?.name ?? null,
    contacts: contacts.map(({ personId: _, ...contact }) => contact),
    addresses: addresses.map(({ personId: _, ...address }) => address),
  };
}

type Data = ReturnType<typeof personSchema.parse>;

async function assertUniqueDocument(tx: DbOrTx, ctx: Ctx, document: string | null, exceptId?: number) {
  if (!document) return;
  const [existing] = await tx
    .select({ name: people.name })
    .from(people)
    .where(
      and(
        eq(people.companyId, ctx.companyId),
        eq(people.document, document),
        exceptId ? ne(people.id, exceptId) : undefined,
      ),
    );
  if (existing) throw conflict(`Já existe um cadastro com este documento: ${existing.name}.`);
}

async function assertRelations(tx: DbOrTx, ctx: Ctx, data: Data) {
  if (data.sellerId) {
    const [seller] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, data.sellerId), eq(users.companyId, ctx.companyId), eq(users.active, true)));
    if (!seller) throw badRequest('Vendedor não encontrado.');
  }
  if (data.carrierId) {
    const [carrier] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(scoped(ctx, data.carrierId), eq(people.isCarrier, true)));
    if (!carrier) throw badRequest('Transportadora não encontrada.');
  }
}

async function replaceChildren(tx: Transaction, personId: number, data: Data) {
  if (data.contacts) {
    await tx.delete(personContacts).where(eq(personContacts.personId, personId));
    if (data.contacts.length) {
      await tx.insert(personContacts).values(data.contacts.map((contact) => ({ ...contact, personId })));
    }
  }
  if (data.addresses) {
    await tx.delete(personAddresses).where(eq(personAddresses.personId, personId));
    if (data.addresses.length) {
      await tx.insert(personAddresses).values(data.addresses.map((address) => ({ ...address, personId })));
    }
  }
}

const columnsOf = ({ contacts: _c, addresses: _a, ...data }: Data) => data;

const TRACKED = [
  'kind',
  'document',
  'name',
  'legalName',
  'email',
  'phone',
  'mobile',
  'stateRegistration',
  'taxpayer',
  'finalConsumer',
  'taxRegime',
  'zip',
  'street',
  'number',
  'complement',
  'district',
  'city',
  'state',
  'country',
  'paymentMethod',
  'paymentTerms',
  'freightType',
  'category',
  'region',
  'creditLimit',
  'notes',
] as const;
const ROLE_NAMES: Record<PersonRole, string> = {
  customer: 'Cliente',
  supplier: 'Fornecedor',
  carrier: 'Transportadora',
  sales_rep: 'Representante',
};

const trackedPerson = async (tx: Transaction, row: typeof people.$inferSelect) => ({
  ...pick(row, TRACKED),
  roles: rolesOf(row)
    .map((role) => ROLE_NAMES[role])
    .join(', '),
  carrier: await personName(tx, row.carrierId),
  seller: await userName(tx, row.sellerId),
});

// Contatos e endereços adicionais são dados pessoais: o registro guarda só que mudaram.
async function childrenOf(tx: Transaction, personId: number) {
  const contacts = await tx.select().from(personContacts).where(eq(personContacts.personId, personId));
  const addresses = await tx.select().from(personAddresses).where(eq(personAddresses.personId, personId));
  const clean = <T extends { id: number }>(rows: T[]) =>
    JSON.stringify(rows.map(({ id: _id, ...row }) => row));
  return { contacts: clean(contacts), addresses: clean(addresses) };
}

export async function createPerson(ctx: Ctx, input: PersonInput) {
  const data = parse(personSchema, input);
  const flags: Flags = {
    isCustomer: data.isCustomer ?? false,
    isSupplier: data.isSupplier ?? false,
    isCarrier: data.isCarrier ?? false,
    isSalesRep: data.isSalesRep ?? false,
  };
  const roles = rolesOf(flags);
  if (!roles.length)
    throw badRequest('Marque ao menos um papel (cliente, fornecedor, transportadora ou representante).');
  requireFor(ctx, roles, 'create');

  // Carteira: sem permissão para escolher o vendedor, o cliente fica com quem cadastrou.
  const canAssign = can(ctx.permissions, 'customers.assign');
  if (!canAssign && data.sellerId && data.sellerId !== ctx.userId) {
    throw forbidden('Você não pode definir o vendedor da carteira.');
  }
  const sellerId =
    data.sellerId !== undefined && canAssign ? data.sellerId : flags.isCustomer ? ctx.userId : null;

  const id = await db.transaction(async (tx) => {
    await assertUniqueDocument(tx, ctx, data.document);
    await assertRelations(tx, ctx, { ...data, sellerId });
    const [person] = await tx
      .insert(people)
      .values({ ...columnsOf(data), ...flags, sellerId, companyId: ctx.companyId })
      .returning();
    if (!person) throw new Error('Falha ao criar cadastro.');
    await replaceChildren(tx, person.id, data);
    await audit(tx, ctx, 'create', 'person', person.id, {
      label: person.name,
      changes: initialFields(await trackedPerson(tx, person)),
    });
    return person.id;
  });
  return getPerson(ctx, id);
}

export async function updatePerson(ctx: Ctx, id: number, input: PersonInput) {
  const data = parse(personSchema, input);
  await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(people).where(scoped(ctx, id)).for('update');
    if (!previous) throw notFound('Cadastro não encontrado.');
    const flags: Flags = {
      isCustomer: data.isCustomer ?? previous.isCustomer,
      isSupplier: data.isSupplier ?? previous.isSupplier,
      isCarrier: data.isCarrier ?? previous.isCarrier,
      isSalesRep: data.isSalesRep ?? previous.isSalesRep,
    };
    const roles = rolesOf(flags);
    if (!roles.length)
      throw badRequest('Marque ao menos um papel (cliente, fornecedor, transportadora ou representante).');
    requireFor(ctx, [...new Set([...rolesOf(previous), ...roles])], 'update');

    const sellerId = data.sellerId === undefined ? previous.sellerId : data.sellerId;
    if (sellerId !== previous.sellerId) authorize(ctx, 'customers.assign');
    if (data.carrierId === id) throw badRequest('A pessoa não pode ser a própria transportadora.');

    await assertUniqueDocument(tx, ctx, data.document, id);
    await assertRelations(tx, ctx, { ...data, sellerId });
    const before = { ...(await trackedPerson(tx, previous)), ...(await childrenOf(tx, id)) };
    const [row] = await tx
      .update(people)
      .set({ ...columnsOf(data), ...flags, sellerId })
      .where(scoped(ctx, id))
      .returning();
    if (!row) throw notFound('Cadastro não encontrado.');
    await replaceChildren(tx, id, data);
    const changes = diffFields(before, {
      ...(await trackedPerson(tx, row)),
      ...(await childrenOf(tx, id)),
    });
    if (changes.length) await audit(tx, ctx, 'update', 'person', id, { label: row.name, changes });
  });
  return getPerson(ctx, id);
}

// Pessoa usada em orçamento, pedido, oportunidade ou como transportadora de outra é arquivada (preserva o
// histórico); senão, é excluída.
export async function deletePerson(ctx: Ctx, id: number) {
  await db.transaction(async (tx) => {
    const [person] = await tx.select().from(people).where(scoped(ctx, id)).for('update');
    if (!person) throw notFound('Cadastro não encontrado.');
    requireFor(ctx, rolesOf(person), 'delete');

    const [{ used } = { used: false }] = await tx.execute<{ used: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM ${quotes} WHERE ${quotes.customerId} = ${id})
          OR EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.customerId} = ${id})
          OR EXISTS (SELECT 1 FROM ${opportunities} WHERE ${opportunities.customerId} = ${id})
          OR EXISTS (SELECT 1 FROM ${people} WHERE ${people.carrierId} = ${id}) AS used`);

    if (used) {
      await tx.update(people).set({ active: false }).where(scoped(ctx, id));
      await audit(tx, ctx, 'archive', 'person', id, {
        label: person.name,
        changes: diffFields({ active: true }, { active: false }),
      });
    } else {
      const snapshot = await trackedPerson(tx, person);
      await tx.delete(people).where(scoped(ctx, id));
      await audit(tx, ctx, 'delete', 'person', id, {
        label: person.name,
        changes: removedFields(snapshot),
      });
    }
  });
}

// Garante que a pessoa exista como cliente (oportunidade ganha, orçamento a partir de oportunidade).
// Reaproveita cadastro com o mesmo e-mail ou telefone; se ainda não for cliente, ganha o papel.
// `system`: efeito automático (ex.: baixa do financeiro ganha a oportunidade), sem exigir permissão.
export async function ensureCustomer(
  tx: Transaction,
  ctx: Ctx,
  contact: { name: string; email: string | null; phone: string | null; sellerId: number | null },
  { system = false }: { system?: boolean } = {},
): Promise<number> {
  const matches = [
    contact.email ? eq(sql`lower(${people.email})`, contact.email.toLowerCase()) : undefined,
    contact.phone ? eq(people.phone, contact.phone) : undefined,
  ].filter(Boolean);
  if (matches.length) {
    const [existing] = await tx
      .select({ id: people.id, isCustomer: people.isCustomer, name: people.name })
      .from(people)
      .where(and(eq(people.companyId, ctx.companyId), eq(people.active, true), or(...matches)))
      .orderBy(sql`${people.isCustomer} DESC`, asc(people.id))
      .limit(1);
    if (existing?.isCustomer) return existing.id;
    if (existing) {
      if (!system) authorize(ctx, 'customers.create');
      await tx.update(people).set({ isCustomer: true }).where(eq(people.id, existing.id));
      await audit(tx, ctx, 'update', 'person', existing.id, {
        label: existing.name,
        changes: diffFields({ isCustomer: false }, { isCustomer: true }),
      });
      return existing.id;
    }
  }
  if (!system) authorize(ctx, 'customers.create');
  const [person] = await tx
    .insert(people)
    .values({
      companyId: ctx.companyId,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      isCustomer: true,
      sellerId: contact.sellerId,
    })
    .returning();
  if (!person) throw new Error('Falha ao criar cliente.');
  await audit(tx, ctx, 'create', 'person', person.id, {
    label: person.name,
    changes: initialFields(await trackedPerson(tx, person)),
  });
  return person.id;
}

// Vendedores possíveis para a carteira (usuários ativos da empresa).
export async function listSellerOptions(ctx: Ctx) {
  authorizeAny(ctx, ['customers.read', 'suppliers.read']);
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.companyId, ctx.companyId), eq(users.active, true)))
    .orderBy(asc(users.name));
}
