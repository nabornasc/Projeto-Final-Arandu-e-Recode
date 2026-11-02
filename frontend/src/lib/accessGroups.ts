import type { Permission } from '@arandue/shared/permissions';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';

export interface AccessGroup {
  id: number;
  name: string;
  description: string | null;
  ownOnly: boolean;
  isOwner: boolean;
  permissions: Permission[];
  userCount: number;
}

export function useAccessGroups(enabled = true) {
  return useQuery({
    queryKey: ['/access-groups'],
    queryFn: () => api<AccessGroup[]>('/access-groups'),
    enabled,
  });
}
