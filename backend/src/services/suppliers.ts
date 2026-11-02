import type { PersonInput } from '@arandue/shared/schemas';
import type { Ctx } from '../lib/context.ts';
import { createPerson, deletePerson, getPerson, listPeople, updatePerson } from './people.ts';

// Fornecedores e transportadoras = pessoas com o papel correspondente (cadastro único em people.ts).
export const listSuppliers = (ctx: Ctx) => listPeople(ctx, { role: 'supplier' });
export const getSupplier = getPerson;
export const createSupplier = (ctx: Ctx, input: PersonInput) =>
  createPerson(ctx, { kind: 'company', ...input, isSupplier: true });
export const updateSupplier = (ctx: Ctx, id: number, input: PersonInput) =>
  updatePerson(ctx, id, { kind: 'company', ...input, isSupplier: true });
export const deleteSupplier = deletePerson;

export const listCarriers = (ctx: Ctx) => listPeople(ctx, { role: 'carrier' });
