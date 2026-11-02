import { Suspense, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { navigation, SETTINGS_PATH } from '../config/navigation.ts';
import { can, useMe } from '../lib/auth.ts';
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

  const current = navigation.find((item) =>
    item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path),
  );

  return (
    <div className="app-shell">
      <Sidebar profile={me.data} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main className="main-content">
        <Topbar
          title={current?.label ?? 'Aranduê'}
          profile={me.data}
          onMenu={() => setMenuOpen((open) => !open)}
        />
        <div className="content">
          {limitMissing && !canConfigure && (
            <p className="notice" role="status">
              O limite anual do MEI ainda não foi configurado. Peça ao proprietário para informá-lo em
              Configurações.
            </p>
          )}
          <Suspense fallback={<div className="loading">Carregando...</div>}>
            <Outlet context={me.data} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
