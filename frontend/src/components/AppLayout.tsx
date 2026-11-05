import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ActionHost } from '../actions/ActionHost.tsx';
import { navigation, SETTINGS_PATH } from '../config/navigation.ts';
import { can, ProfileContext, useMe } from '../lib/auth.ts';
import { resolvePage } from '../workspace/pages.ts';
import { Workspace } from '../workspace/Workspace.tsx';
import { DemoNotice } from './DemoNotice.tsx';
import { Sidebar } from './Sidebar.tsx';
import { Topbar } from './Topbar.tsx';

export function AppLayout() {
  const me = useMe();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  if (me.isPending) return <div className="page-loading">Carregando...</div>;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  // O limite anual do MEI é obrigatório: o proprietário configura antes de usar o sistema.
  const limitMissing = me.data.company.meiAnnualLimit === null;
  const canConfigure = can(me.data, 'settings.update');
  if (limitMissing && canConfigure && location.pathname !== SETTINGS_PATH) {
    return <Navigate to={SETTINGS_PATH} replace />;
  }

  // Quem não vê a visão geral (ex.: vendedor) começa pela primeira tela permitida.
  const profile = me.data;
  const home = can(profile, 'analytics.read')
    ? '/'
    : (navigation.find((item) => can(profile, item.permission))?.path ?? SETTINGS_PATH);
  if (location.pathname === '/' && home !== '/') return <Navigate to={home} replace />;

  const current = navigation.find((item) =>
    item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path),
  );

  return (
    <ProfileContext value={me.data}>
      <ActionHost>
        <div className="app-shell">
          <Sidebar profile={me.data} open={menuOpen} onClose={() => setMenuOpen(false)} />
          <main className="main-content">
            <Topbar
              title={current?.label ?? resolvePage(location.pathname).title}
              profile={me.data}
              onMenu={() => setMenuOpen((open) => !open)}
            />
            <div className="content">
              <DemoNotice />
              {limitMissing && !canConfigure && (
                <p className="notice" role="status">
                  O limite anual do MEI ainda não foi configurado. Peça ao proprietário para informá-lo em
                  Configurações.
                </p>
              )}
              <Workspace userId={me.data.id} home={home} />
            </div>
          </main>
        </div>
      </ActionHost>
    </ProfileContext>
  );
}
