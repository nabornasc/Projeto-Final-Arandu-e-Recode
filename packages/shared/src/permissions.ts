// Catálogo de permissões — fonte única usada pelo backend (para negar) e pelo frontend
// (só para esconder menus e botões). Cada empresa combina estas permissões em grupos de acesso.

export const ACTION_LABELS = {
  read: 'Ver',
  create: 'Criar',
  update: 'Editar',
  delete: 'Excluir',
  send: 'Enviar',
  approve: 'Aprovar ou recusar',
  convert: 'Converter em pedido',
  cancel: 'Cancelar ou reativar',
  settle: 'Dar baixa (marcar como pago)',
  pay: 'Marcar como paga',
  manage: 'Gerenciar',
  assign: 'Definir vendedor da carteira',
  configure: 'Configurar etapas do funil',
} as const;
type ActionKey = keyof typeof ACTION_LABELS;

interface AreaDefinition {
  label: string;
  actions: readonly ActionKey[];
  // Áreas em que o grupo pode ficar restrito aos registros que o próprio usuário criou.
  scoped?: boolean;
}

const CRUD = ['read', 'create', 'update', 'delete'] as const;

export const AREAS = {
  quotes: {
    label: 'Orçamentos',
    actions: ['read', 'create', 'update', 'send', 'approve', 'convert', 'cancel', 'delete'],
    scoped: true,
  },
  orders: { label: 'Pedidos', actions: ['read', 'create', 'update', 'cancel', 'delete'], scoped: true },
  opportunities: {
    label: 'CRM (oportunidades e atendimentos)',
    actions: [...CRUD, 'configure'],
    scoped: true,
  },
  receivables: { label: 'Contas a receber', actions: ['read', 'settle'] },
  payables: { label: 'Contas a pagar (despesas)', actions: ['read', 'create', 'update', 'pay', 'delete'] },
  cash: { label: 'Movimentações de caixa', actions: CRUD },
  bank_accounts: { label: 'Contas bancárias', actions: CRUD },
  customers: { label: 'Clientes', actions: [...CRUD, 'assign'] },
  suppliers: { label: 'Fornecedores, transportadoras e representantes', actions: CRUD },
  products: { label: 'Produtos e serviços', actions: CRUD },
  costs: { label: 'Custos e margem', actions: ['read'] },
  analytics: { label: 'Visão geral (indicadores)', actions: ['read'] },
  users: { label: 'Usuários', actions: ['read', 'manage'] },
  access: { label: 'Grupos de acesso', actions: ['manage'] },
  settings: { label: 'Configurações da empresa', actions: ['read', 'update'] },
  audit: { label: 'Auditoria', actions: ['read'] },
} as const satisfies Record<string, AreaDefinition>;

export type Area = keyof typeof AREAS;
export type Permission = { [A in Area]: `${A}.${(typeof AREAS)[A]['actions'][number]}` }[Area];

export const PERMISSIONS = (Object.keys(AREAS) as Area[]).flatMap((area) =>
  AREAS[area].actions.map((action) => `${area}.${action}` as Permission),
);

const KNOWN = new Set<string>(PERMISSIONS);
export const isPermission = (value: string): value is Permission => KNOWN.has(value);

// Pré-requisitos: qualquer ação implica ver a área; algumas dependem de outra área
// (ex.: montar orçamento ou pedido exige ver produtos e clientes para escolhê-los).
const PICK_ITEMS: Permission[] = ['products.read', 'customers.read'];
const EXTRA_REQUIREMENTS: Partial<Record<Permission, Permission[]>> = {
  'quotes.create': PICK_ITEMS,
  'quotes.update': PICK_ITEMS,
  'quotes.convert': ['orders.create'],
  'orders.create': PICK_ITEMS,
  'orders.update': ['customers.read'],
  'opportunities.create': PICK_ITEMS,
  'opportunities.update': PICK_ITEMS,
  'access.manage': ['users.read'],
  'costs.read': ['products.read'],
};

export function requirementsOf(permission: Permission): Permission[] {
  const [area, action] = permission.split('.') as [Area, string];
  const read = `${area}.read` as Permission;
  const base = action !== 'read' && KNOWN.has(read) ? [read] : [];
  return [...base, ...(EXTRA_REQUIREMENTS[permission] ?? [])];
}

// Completa a lista com os pré-requisitos (recursivamente) e remove repetições, na ordem do catálogo.
export function withRequirements(permissions: Iterable<Permission>): Permission[] {
  const result = new Set<Permission>();
  const visit = (permission: Permission) => {
    if (result.has(permission)) return;
    result.add(permission);
    for (const required of requirementsOf(permission)) visit(required);
  };
  for (const permission of permissions) visit(permission);
  return PERMISSIONS.filter((permission) => result.has(permission));
}

export function can(granted: ReadonlySet<string> | readonly string[], permission: Permission): boolean {
  return 'has' in granted ? granted.has(permission) : granted.includes(permission);
}

export const canAny = (granted: ReadonlySet<string> | readonly string[], permissions: Permission[]) =>
  permissions.some((permission) => can(granted, permission));

// Grupos criados em toda empresa nova. Equivalem aos papéis fixos anteriores (ninguém ganha nem
// perde acesso na migração). O Proprietário tem tudo por definição e não é editável.
export const OWNER_GROUP_NAME = 'Proprietário';

export const DEFAULT_GROUPS: { name: string; description: string; permissions: Permission[] }[] = [
  {
    name: 'Vendedor',
    description: 'Vende, cadastra clientes e monta orçamentos.',
    permissions: withRequirements([
      'customers.create',
      'customers.update',
      'suppliers.read',
      'products.read',
      'quotes.create',
      'quotes.update',
      'quotes.send',
      'quotes.convert',
      'quotes.cancel',
      'orders.create',
      'orders.update',
      'orders.cancel',
      'receivables.settle',
      'opportunities.create',
      'opportunities.update',
    ]),
  },
  {
    name: 'Contador',
    description: 'Consulta vendas, financeiro e indicadores, sem alterar.',
    permissions: [
      'customers.read',
      'suppliers.read',
      'products.read',
      'costs.read',
      'quotes.read',
      'orders.read',
      'receivables.read',
      'payables.read',
      'cash.read',
      'bank_accounts.read',
      'analytics.read',
      'settings.read',
    ],
  },
];
