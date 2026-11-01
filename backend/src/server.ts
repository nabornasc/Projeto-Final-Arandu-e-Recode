import { buildApp } from './app.ts';
import { config, isProduction } from './config.ts';
import { sql } from './db/client.ts';

const app = await buildApp();
await app.listen({ port: config.PORT, host: isProduction ? '0.0.0.0' : '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await sql.end();
    process.exit(0);
  });
}
