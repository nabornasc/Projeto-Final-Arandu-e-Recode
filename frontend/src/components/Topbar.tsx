import { LogOut, Menu } from 'lucide-react';
import { useNavigate } from 'react-router';
import { type Profile, useLogout } from '../lib/auth.ts';
import { formatToday } from '../lib/format.ts';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

export function Topbar({ title, profile, onMenu }: { title: string; profile: Profile; onMenu: () => void }) {
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <header className="topbar">
      <button type="button" className="mobile-menu" onClick={onMenu} aria-label="Abrir menu de navegação">
        <Menu size={21} />
      </button>

      <div>
        <p className="eyebrow">{formatToday()}</p>
        <h1>{title}</h1>
      </div>

      <div className="topbar-actions">
        <div className="profile">
          <div className="avatar" aria-hidden="true">
            {initials(profile.name)}
          </div>
          <div>
            <strong>{profile.name}</strong>
            <small>
              {profile.group.name} · {profile.company.name}
            </small>
          </div>
        </div>
        <button
          type="button"
          className="logout"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })}
        >
          <LogOut size={14} aria-hidden="true" /> Sair
        </button>
      </div>
    </header>
  );
}
