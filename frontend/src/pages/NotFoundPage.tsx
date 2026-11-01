import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>Página não encontrada</h1>
        <p>O endereço acessado não existe.</p>
        <Link className="button primary" to="/">
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
