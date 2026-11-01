import type { Role } from '@arandue/shared/rbac';
import type { LoginInput, RegisterInput } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api.ts';

export interface Profile {
  id: number;
  name: string;
  email: string;
  role: Role;
  company: { id: number; name: string; cnpj: string | null };
}

const ME_KEY = ['auth', 'me'] as const;

// null = sem sessão.
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api<Profile>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api<Profile>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (profile) => client.setQueryData(ME_KEY, profile),
  });
}

export function useRegister() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api<Profile>('/auth/register', { method: 'POST', body: input }),
    onSuccess: (profile) => client.setQueryData(ME_KEY, profile),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<null>('/auth/logout', { method: 'POST' }),
    // Limpa todo o cache: nada da sessão anterior pode aparecer para o próximo usuário.
    onSettled: () => {
      client.clear();
      client.setQueryData(ME_KEY, null);
    },
  });
}
