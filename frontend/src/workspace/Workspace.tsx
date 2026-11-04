import { Columns2, X } from 'lucide-react';
import { Activity, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { resolvePage } from './pages.ts';
import { type TabApi, TabContext } from './tab.ts';

interface Tab {
  path: string;
  title: string;
  dirty: boolean;
  lastUsed: number;
}

const MAX_TABS = 10;
const storageKey = (userId: number) => `arandue:abas:${userId}`;

// Abas abertas ficam no navegador (conveniência por usuário); falhar ao ler ou gravar não impede o uso.
function restore(userId: number): { tabs: Tab[]; split: string | null } {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(userId)) ?? 'null') as {
      tabs: { path: string; title: string }[];
      split: string | null;
    } | null;
    if (!saved) return { tabs: [], split: null };
    const tabs = saved.tabs
      .filter((tab) => resolvePage(tab.path).found)
      .map((tab, index) => ({ ...tab, dirty: false, lastUsed: index }));
    return { tabs, split: tabs.some((tab) => tab.path === saved.split) ? saved.split : null };
  } catch {
    return { tabs: [], split: null };
  }
}

const newTab = (path: string): Tab => ({
  path,
  title: resolvePage(path).title,
  dirty: false,
  lastUsed: Date.now(),
});

// Acima do limite, fecha a aba usada há mais tempo que não esteja visível nem com alterações.
function trim(tabs: Tab[], keep: (string | null)[]): Tab[] {
  if (tabs.length <= MAX_TABS) return tabs;
  const candidates = tabs.filter((tab) => !tab.dirty && !keep.includes(tab.path));
  const oldest = candidates.sort((a, b) => a.lastUsed - b.lastUsed)[0];
  return oldest ? tabs.filter((tab) => tab !== oldest) : tabs;
}

interface Props {
  userId: number;
  home: string;
}

// Área de trabalho: cada tela aberta vira uma aba que mantém o próprio estado ao alternar
// (<Activity>), com a opção de mostrar uma segunda aba ao lado. A URL acompanha a aba principal.
export function Workspace({ userId, home }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const active = location.pathname;
  const initial = useMemo(() => restore(userId), [userId]);
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs);
  const [split, setSplit] = useState<string | null>(initial.split);
  const previousActive = useRef<string | null>(null);

  // Abrir um endereço abre ou foca a aba correspondente; abrir a aba lateral troca os lados.
  useEffect(() => {
    setTabs((current) => {
      const exists = current.some((tab) => tab.path === active);
      const next = exists
        ? current.map((tab) => (tab.path === active ? { ...tab, lastUsed: Date.now() } : tab))
        : [...current, newTab(active)];
      return trim(next, [active, split]);
    });
    if (split === active) setSplit(previousActive.current !== active ? previousActive.current : null);
    previousActive.current = active;
  }, [active, split]);

  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey(userId),
        JSON.stringify({ tabs: tabs.map(({ path, title }) => ({ path, title })), split }),
      );
    } catch {
      // Sem armazenamento (navegação privada): as abas só não são lembradas.
    }
  }, [tabs, split, userId]);

  const hasDirty = tabs.some((tab) => tab.dirty);
  useEffect(() => {
    if (!hasDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDirty]);

  const setTitle = useCallback(
    (path: string, title: string) =>
      setTabs((current) => current.map((tab) => (tab.path === path ? { ...tab, title } : tab))),
    [],
  );
  const setDirty = useCallback(
    (path: string, dirty: boolean) =>
      setTabs((current) =>
        current.map((tab) => (tab.path === path && tab.dirty !== dirty ? { ...tab, dirty } : tab)),
      ),
    [],
  );
  const replaceTab = useCallback(
    (from: string, to: string) => {
      setTabs((current) =>
        current.some((tab) => tab.path === to)
          ? current.filter((tab) => tab.path !== from)
          : current.map((tab) => (tab.path === from ? { ...tab, path: to, dirty: false } : tab)),
      );
      setSplit((current) => (current === from ? to : current));
      if (from === active) navigate(to, { replace: true });
    },
    [active, navigate],
  );

  const close = (path: string) => {
    const tab = tabs.find((item) => item.path === path);
    if (tab?.dirty && !window.confirm(`"${tab.title}" tem alterações não salvas. Fechar mesmo assim?`))
      return;
    const rest = tabs.filter((item) => item.path !== path);
    setTabs(rest);
    if (split === path) setSplit(null);
    if (path === active) {
      const next =
        split && split !== path ? split : [...rest].sort((a, b) => b.lastUsed - a.lastUsed)[0]?.path;
      if (next === split) setSplit(null);
      navigate(next ?? home);
    }
  };

  // A aba do endereço atual aparece já na primeira renderização, antes do efeito registrá-la.
  const visibleTabs = tabs.some((tab) => tab.path === active) ? tabs : [...tabs, newTab(active)];
  const sideTab = split && split !== active ? split : null;

  return (
    <div className="workspace">
      <nav className="tabbar" aria-label="Telas abertas">
        {visibleTabs.map((tab) => {
          const isActive = tab.path === active;
          const isSide = tab.path === sideTab;
          return (
            <div key={tab.path} className={`tab${isActive ? ' active' : ''}${isSide ? ' side' : ''}`}>
              <button
                type="button"
                className="tab-icon"
                aria-label={`Fechar ${tab.title}`}
                onClick={() => close(tab.path)}
              >
                <X size={13} />
              </button>
              <button
                type="button"
                className="tab-title"
                aria-current={isActive ? 'page' : undefined}
                title={tab.title}
                onClick={() => navigate(tab.path)}
                onAuxClick={(event) => event.button === 1 && close(tab.path)}
              >
                {tab.dirty && (
                  <span className="tab-dirty" role="img" aria-label="Alterações não salvas">
                    ●
                  </span>
                )}
                {tab.title}
              </button>
              {!isActive && !isSide && (
                <button
                  type="button"
                  className="tab-icon"
                  title="Abrir ao lado"
                  aria-label={`Abrir ${tab.title} ao lado`}
                  onClick={() => setSplit(tab.path)}
                >
                  <Columns2 size={13} />
                </button>
              )}
            </div>
          );
        })}
        {sideTab && (
          <button type="button" className="tab-unsplit" onClick={() => setSplit(null)}>
            Fechar divisão
          </button>
        )}
      </nav>

      <div className={`panes${sideTab ? ' split' : ''}`}>
        {visibleTabs.map((tab) => {
          const isActive = tab.path === active;
          const isSide = tab.path === sideTab;
          return (
            <Activity key={tab.path} mode={isActive || isSide ? 'visible' : 'hidden'}>
              <section className={`pane ${isSide ? 'pane-side' : 'pane-main'}`} aria-label={tab.title}>
                <TabHost
                  path={tab.path}
                  active={isActive}
                  onTitle={setTitle}
                  onDirty={setDirty}
                  onReplace={replaceTab}
                  onClose={close}
                />
              </section>
            </Activity>
          );
        })}
      </div>
    </div>
  );
}

interface TabHostProps {
  path: string;
  active: boolean;
  onTitle(path: string, title: string): void;
  onDirty(path: string, dirty: boolean): void;
  onReplace(from: string, to: string): void;
  onClose(path: string): void;
}

function TabHost({ path, active, onTitle, onDirty, onReplace, onClose }: TabHostProps) {
  const page = useMemo(() => resolvePage(path), [path]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const api = useMemo<TabApi>(
    () => ({
      path,
      params: page.params,
      active,
      setTitle: (title) => onTitle(path, title),
      setDirty: (dirty) => onDirty(path, dirty),
      replaceWith: (to) => onReplace(path, to),
      close: () => closeRef.current(path),
    }),
    [path, page.params, active, onTitle, onDirty, onReplace],
  );

  return (
    <TabContext value={api}>
      <Suspense fallback={<div className="loading">Carregando...</div>}>
        <page.Component />
      </Suspense>
    </TabContext>
  );
}
