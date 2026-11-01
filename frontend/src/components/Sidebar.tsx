import { can } from '@arandue/shared/rbac';
import { ChevronRight } from 'lucide-react';
import { NavLink } from 'react-router';
import { navigation } from '../config/navigation.ts';
import type { Profile } from '../lib/auth.ts';

interface Props {
  profile: Profile;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ profile, open, onClose }: Props) {
  const items = navigation.filter((item) => can(profile.role, item.module, 'read'));
  return (
    <>
      {open && <div className="mobile-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <strong>aranduê</strong>
            <small>Gestão que gera futuro</small>
          </div>
        </div>

        <nav aria-label="Menu principal">
          <span className="nav-label">MENU PRINCIPAL</span>
          {items.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              onClick={onClose}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              {({ isActive }) => (
                <>
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                  {isActive && <ChevronRight size={16} className="nav-chevron" aria-hidden="true" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="help-icon">?</div>
          <div>
            <strong>{profile.company.name}</strong>
            <small>Organize seu negócio com calma.</small>
          </div>
        </div>
      </aside>
    </>
  );
}
