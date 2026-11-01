import { Menu } from 'lucide-react';
import { getTodayFormatted } from '../utils/formatters';

export function Topbar({ title, menuOpen, setMenuOpen }) {
  const formattedToday = getTodayFormatted();

  return (
    <header className="topbar">
      <button
        className="mobile-menu"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="Abrir menu de navegação"
      >
        <Menu size={21} />
      </button>

      <div>
        <p className="eyebrow">{formattedToday}</p>
        <h1>{title}</h1>
      </div>

      <div className="profile">
        <div className="avatar">ME</div>
        <div>
          <strong>Meu negócio</strong>
          <small>MEI · Protótipo</small>
        </div>
      </div>
    </header>
  );
}

