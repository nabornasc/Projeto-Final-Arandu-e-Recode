import type { Permission } from '@arandue/shared/permissions';
import type { PersonRole } from '@arandue/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

// Papéis do cadastro único: cada um tem a sua lista no menu e usa as permissões de uma área.
export const ROLE_CONFIG: Record<
  PersonRole,
  { path: string; label: string; singular: string; flag: RoleFlag; area: 'customers' | 'suppliers' }
> = {
  customer: {
    path: '/clientes',
    label: 'Clientes',
    singular: 'cliente',
    flag: 'isCustomer',
    area: 'customers',
  },
  supplier: {
    path: '/fornecedores',
    label: 'Fornecedores',
    singular: 'fornecedor',
    flag: 'isSupplier',
    area: 'suppliers',
  },
  carrier: {
    path: '/transportadoras',
    label: 'Transportadoras',
    singular: 'transportadora',
    flag: 'isCarrier',
    area: 'suppliers',
  },
  sales_rep: {
    path: '/representantes',
    label: 'Representantes',
    singular: 'representante',
    flag: 'isSalesRep',
    area: 'suppliers',
  },
};
export type RoleFlag = 'isCustomer' | 'isSupplier' | 'isCarrier' | 'isSalesRep';
export const ROLE_LIST = Object.keys(ROLE_CONFIG) as PersonRole[];

export const roleFromPath = (path: string): PersonRole =>
  ROLE_LIST.find((role) => path.startsWith(ROLE_CONFIG[role].path)) ?? 'customer';

export const permissionFor = (role: PersonRole, action: 'read' | 'create' | 'update' | 'delete') =>
  `${ROLE_CONFIG[role].area}.${action}` as Permission;

export interface PersonSummary {
  id: number;
  kind: 'individual' | 'company';
  document: string | null;
  name: string;
  legalName: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
  isCarrier: boolean;
  isSalesRep: boolean;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  city: string | null;
  state: string | null;
  active: boolean;
}

export interface PersonContact {
  id?: number;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

export interface PersonAddress {
  id?: number;
  kind: 'delivery' | 'billing';
  zip: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
}

export interface Person extends PersonSummary {
  stateRegistration: string | null;
  taxpayer: 'contributor' | 'exempt' | 'non_contributor';
  finalConsumer: boolean;
  taxRegime: string | null;
  zip: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  country: string | null;
  paymentMethod: string | null;
  paymentTerms: string | null;
  freightType: string | null;
  carrierId: number | null;
  carrierName: string | null;
  category: string | null;
  region: string | null;
  sellerId: number | null;
  sellerName: string | null;
  creditLimit: number | null;
  notes: string | null;
  contacts: PersonContact[];
  addresses: PersonAddress[];
}

export const usePeople = (role: PersonRole, q = '', enabled = true) =>
  useQuery({
    queryKey: ['/people', role, q],
    queryFn: () => api<PersonSummary[]>(`/people?role=${role}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    enabled,
  });

export const usePerson = (id: number | null) =>
  useQuery({ queryKey: ['/people', id], queryFn: () => api<Person>(`/people/${id}`), enabled: id !== null });
