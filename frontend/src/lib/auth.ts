import { can as canWith, type Permission } from '@arandue/shared/permissions';
import type { LoginInput, RegisterInput } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { ApiError, api } from './api.ts';

export interface Profile {
  id: number;
  name: string;
  email: string;
  group: { id: number; name: string; isOwner: boolean };
  // Em orçamentos e pedidos, só vê os registros que criou.
  ownOnly: boolean;
  permissions: Permission[];
  company: { id: number; name: string; cnpj: string | null; meiAnnualLimit: number | null };
}

// Só para esconder menus e botões: quem decide é o backend.
export const can = (profile: Profile, permission: Permission) => canWith(profile.permissions, permission);

// Perfil de quem está logado, disponível para todas as telas abertas nas abas.
export const ProfileContext = createContext<Profile | null>(null);

export function useProfile(): Profile {
  const profile = useContext(ProfileContext);
  if (!profile) throw new Error('useProfile fora da área logada.');
  return profile;
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
