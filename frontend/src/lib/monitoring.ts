// Monitoramento de erros no navegador. Sem VITE_SENTRY_DSN, o Sentry nem é baixado.
export function startMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // Só erros: sem gravação de sessão nem rastreamento de desempenho.
      tracesSampleRate: 0,
    });
  });
}
