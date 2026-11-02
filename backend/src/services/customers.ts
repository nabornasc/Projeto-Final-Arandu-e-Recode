import type { PersonInput } from '@arandue/shared/schemas';
import type { Ctx } from '../lib/context.ts';
import { createPerson, deletePerson, getPerson, listPeople, updatePerson } from './people.ts';

// Clientes = pessoas com o papel de cliente (cadastro único em people.ts). Mantém a API /customers.
export const listCustomers = (ctx: Ctx) => listPeople(ctx, { role: 'customer' });
export const getCustomer = getPerson;
export const createCustomer = (ctx: Ctx, input: PersonInput) =>
  createPerson(ctx, { ...input, isCustomer: true });
export const updateCustomer = (ctx: Ctx, id: number, input: PersonInput) =>
  updatePerson(ctx, id, { ...input, isCustomer: true });
export const deleteCustomer = deletePerson;
