import { type Action, can, type Module, type Role } from '@arandue/shared/rbac';
import { forbidden } from './errors.ts';

// Quem está agindo. Vem da sessão (web) ou, futuramente, do vínculo do Telegram.
export interface Ctx {
  userId: number;
  companyId: number;
  role: Role;
  actor: 'web' | 'telegram' | 'assistant' | 'system';
}

export function authorize(ctx: Ctx, module: Module, action: Action): void {
  if (!can(ctx.role, module, action)) throw forbidden();
}
