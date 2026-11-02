import { createContext, useContext, useEffect } from 'react';

// O que cada tela sabe sobre a aba em que está aberta.
export interface TabApi {
  path: string;
  params: Record<string, string | undefined>;
  active: boolean;
  setTitle(title: string): void;
  setDirty(dirty: boolean): void;
  // Troca o endereço da própria aba (ex.: rascunho salvo vira /orcamentos/12) sem abrir outra.
  replaceWith(path: string): void;
  close(): void;
}

export const TabContext = createContext<TabApi | null>(null);

export function useTab(): TabApi {
  const tab = useContext(TabContext);
  if (!tab) throw new Error('useTab fora de uma aba.');
  return tab;
}

export function useTabTitle(title: string | null | undefined): void {
  const { setTitle } = useTab();
  useEffect(() => {
    if (title) setTitle(title);
  }, [title, setTitle]);
}

// Marca a aba com alterações não salvas (pede confirmação ao fechar).
export function useTabDirty(dirty: boolean): void {
  const { setDirty } = useTab();
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
}
