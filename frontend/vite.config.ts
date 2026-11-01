import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1 em vez de localhost: o Node pode resolver localhost para IPv6 (::1),
      // enquanto a API escuta em IPv4.
      '/api': { target: 'http://127.0.0.1:3001' },
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
});
