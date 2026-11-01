// Erro de negócio com status HTTP. Mensagens são mostradas ao usuário final.
export class AppError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export const badRequest = (message: string) => new AppError(400, message);
export const unauthorized = (message = 'Faça login para continuar.') => new AppError(401, message);
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(403, message);
export const notFound = (message = 'Registro não encontrado.') => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);
