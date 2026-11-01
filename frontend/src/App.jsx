import { useState } from 'react';
import { navigation } from './config/resources';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { Dashboard } from './components/Dashboard';
import { Orders } from './components/Orders';
import { ResourcePage } from './components/ResourcePage';
import { Toast } from './components/Toast';

export function App() {
  const [active, setActive] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);

  function notify(message, type = 'success') {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3500);
  }

  const current = navigation.find((item) => item.key === active);
  const title = current?.label || 'Visão geral';

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        setActive={setActive}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
      />

      <main className="main-content">
        <Topbar
          title={title}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
        />

        <div className="content">
          {active === 'dashboard' ? (
            <Dashboard onNavigate={setActive} />
          ) : active === 'orders' ? (
            <Orders notify={notify} />
          ) : (
            <ResourcePage resource={active} notify={notify} />
          )}
        </div>
      </main>

      <Toast toast={toast} />
    </div>
  );
}

export default App;
