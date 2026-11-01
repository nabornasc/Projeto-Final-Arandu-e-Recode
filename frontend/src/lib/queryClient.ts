import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dados ficam "frescos" por 30 s: voltar a uma tela não refaz a requisição na hora.
      staleTime: 30_000,
      // Erros de permissão ou de sessão não melhoram tentando de novo.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});
