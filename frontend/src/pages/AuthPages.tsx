import { loginSchema, registerSchema } from '@arandue/shared/schemas';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useLogin, useMe, useRegister } from '../lib/auth.ts';

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">A</span>
      <div>
        <strong>aranduê</strong>
        <small>Gestão que gera futuro</small>
      </div>
    </div>
  );
}

const field = (form: FormData, name: string) => String(form.get(name) ?? '');

export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (me.data) return <Navigate to={from} replace />;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({ email: field(form, 'email'), password: field(form, 'password') });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    login.mutate(parsed.data, {
      onSuccess: () => navigate(from, { replace: true }),
      onError: (err) => setError(err.message),
    });
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Brand />
        <h1>Entrar</h1>
        <p>Acesse a gestão do seu negócio.</p>
        <div className="form-grid">
          <label>
            E-mail
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Senha
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" type="submit" disabled={login.isPending}>
          {login.isPending ? 'Entrando...' : 'Entrar'}
        </button>
        <p className="auth-switch">
          Ainda não tem conta? <Link to="/cadastro">Cadastre sua empresa</Link>
        </p>
      </form>
    </main>
  );
}

export function RegisterPage() {
  const me = useMe();
  const register = useRegister();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  if (me.data) return <Navigate to="/" replace />;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse({
      companyName: field(form, 'companyName'),
      cnpj: field(form, 'cnpj'),
      name: field(form, 'name'),
      email: field(form, 'email'),
      password: field(form, 'password'),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    register.mutate(parsed.data, {
      onSuccess: () => navigate('/', { replace: true }),
      onError: (err) => setError(err.message),
    });
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Brand />
        <h1>Cadastre sua empresa</h1>
        <p>Você será o proprietário da conta e poderá convidar sua equipe depois.</p>
        <div className="form-grid">
          <label>
            Nome da empresa
            <input name="companyName" autoComplete="organization" required />
          </label>
          <label>
            CNPJ (opcional)
            <input name="cnpj" inputMode="numeric" />
          </label>
          <label>
            Seu nome
            <input name="name" autoComplete="name" required />
          </label>
          <label>
            E-mail
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Senha (mínimo 10 caracteres)
            <input name="password" type="password" autoComplete="new-password" minLength={10} required />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" type="submit" disabled={register.isPending}>
          {register.isPending ? 'Criando conta...' : 'Criar conta'}
        </button>
        <p className="auth-switch">
          Já tem conta? <Link to="/login">Entrar</Link>
        </p>
      </form>
    </main>
  );
}
