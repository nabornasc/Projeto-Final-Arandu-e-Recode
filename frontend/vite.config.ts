import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1 em vez de localhost: o Node pode resolver localhost para IPv6 (::1),
      // enquanto a API escuta em IPv4.
      // Os testes ponta a ponta apontam para a API deles, em outra porta.
      '/api': { target: loadEnv(mode, '.', 'E2E_').E2E_API_TARGET ?? 'http://127.0.0.1:3001' },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // React e roteador mudam pouco: ficam num arquivo separado que o navegador mantém em cache.
        manualChunks: (id) =>
          /node_modules\/(react|react-dom|react-router|scheduler|@tanstack)\//.test(id)
            ? 'vendor'
            : undefined,
      },
    },
  },
}));
