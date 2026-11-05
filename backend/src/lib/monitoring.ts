// Monitoramento de erros. Sem SENTRY_DSN (desenvolvimento e testes), nada é enviado.
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // Só erros, sem rastreamento de desempenho. O beforeSend tira cookies, IP e corpo da requisição.
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) event.request = { method: event.request.method, url: event.request.url };
      return event;
    },
  });
}

// Na Vercel a função pode congelar logo após responder: espera o envio terminar.
export async function reportError(error: unknown): Promise<void> {
  if (!dsn) return;
  Sentry.captureException(error);
  await Sentry.flush(2000);
}
