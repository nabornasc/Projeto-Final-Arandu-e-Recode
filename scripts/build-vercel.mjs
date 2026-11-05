// Gera .vercel/output (Build Output API): a interface como arquivos estáticos e a API como uma função em
// São Paulo. O esbuild junta o backend em um arquivo: a Vercel não executa os imports .ts do projeto.
import { execSync } from 'node:child_process';
import { cpSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sentryEsbuildPlugin } from '@sentry/esbuild-plugin';
import { build } from 'esbuild';

const OUTPUT = '.vercel/output';
const FUNCTION = `${OUTPUT}/functions/api.func`;
const sentryToken = process.env.SENTRY_AUTH_TOKEN;

rmSync(OUTPUT, { recursive: true, force: true });
execSync('npm run build', { stdio: 'inherit' });

cpSync('frontend/dist', `${OUTPUT}/static`, { recursive: true });

await build({
  entryPoints: ['backend/src/vercel.ts'],
  outfile: `${FUNCTION}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  // Binário nativo: não entra no pacote e é copiado abaixo.
  external: ['@node-rs/argon2'],
  // Dependências em CommonJS usam require, __dirname e __filename, que não existem em módulos ES.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __dirnameOf } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __dirnameOf(__filename);',
    ].join('\n'),
  },
  logLevel: 'warning',
  // Com o token, os erros da API aparecem no Sentry apontando para o código original.
  sourcemap: sentryToken ? true : false,
  plugins: sentryToken
    ? [
        sentryEsbuildPlugin({
          org: 'nabornasc',
          project: 'arandu-gestao-api',
          authToken: sentryToken,
          sourcemaps: { filesToDeleteAfterUpload: [`${FUNCTION}/*.map`] },
          telemetry: false,
        }),
      ]
    : [],
});

// Copia o argon2 com os binários instalados para a plataforma atual.
const scope = 'node_modules/@node-rs';
for (const name of readdirSync(scope).filter((entry) => entry.startsWith('argon2'))) {
  cpSync(realpathSync(join(scope, name)), `${FUNCTION}/${scope}/${name}`, { recursive: true });
}

writeFileSync(`${FUNCTION}/package.json`, JSON.stringify({ type: 'module' }));
writeFileSync(
  `${FUNCTION}/.vc-config.json`,
  JSON.stringify({
    runtime: 'nodejs24.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    shouldAddSourcemapSupport: false,
    regions: ['gru1'],
    maxDuration: 30,
  }),
);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

writeFileSync(
  `${OUTPUT}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: '/(.*)',
          headers: {
            'Content-Security-Policy': CSP,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
          },
          continue: true,
        },
        {
          src: '/assets/(.*)',
          headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
          continue: true,
        },
        { src: '/api(/.*)?', dest: '/api' },
        { handle: 'filesystem' },
        // As rotas da interface são resolvidas no navegador.
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);

console.log('Saída gerada em .vercel/output');
