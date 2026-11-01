// Matriz de permissões (RBAC) — fonte única usada pelo backend (para negar)
// e pelo frontend (só para esconder menus e botões).

export const ROLES = ['owner', 'seller', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

export const MODULES = [
  'customers',
  'suppliers',
  'products',
  'sales',
  'crm',
  'finance',
  'analytics',
  'users',
  'assistant',
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ['read', 'create', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

const ALL: readonly Action[] = ACTIONS;
const READ: readonly Action[] = ['read'];
const EDIT: readonly Action[] = ['read', 'create', 'update'];
const NONE: readonly Action[] = [];

const MATRIX: Record<Role, Record<Module, readonly Action[]>> = {
  owner: {
    customers: ALL,
    suppliers: ALL,
    products: ALL,
    sales: ALL,
    crm: ALL,
    finance: ALL,
    analytics: ALL,
    users: ALL,
    assistant: ALL,
  },
  seller: {
    customers: EDIT,
    suppliers: READ,
    products: READ,
    sales: EDIT,
    crm: EDIT,
    finance: NONE,
    analytics: NONE,
    users: NONE,
    assistant: EDIT,
  },
  accountant: {
    customers: READ,
    suppliers: READ,
    products: READ,
    sales: READ,
    crm: NONE,
    finance: READ,
    analytics: READ,
    users: NONE,
    assistant: READ,
  },
};

export function can(role: Role, module: Module, action: Action): boolean {
  return MATRIX[role][module].includes(action);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Proprietário',
  seller: 'Vendedor',
  accountant: 'Contador',
};
