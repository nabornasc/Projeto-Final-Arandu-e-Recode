import { ChevronRight } from 'lucide-react';
import { navigation } from '../config/resources';

export function Sidebar({ active, setActive, menuOpen, setMenuOpen }) {
  return (
    <>
      {menuOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <strong>aranduê</strong>
            <small>Gestão que gera futuro</small>
          </div>
        </div>

        <nav>
          <span className="nav-label">MENU PRINCIPAL</span>
          {navigation.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={active === key ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setActive(key);
                setMenuOpen(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {active === key && <ChevronRight size={16} className="nav-chevron" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="help-icon">?</div>
          <div>
            <strong>Precisa de ajuda?</strong>
            <small>Organize seu negócio com calma.</small>
          </div>
        </div>
      </aside>
    </>
  );
}

