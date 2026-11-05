import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppLayout } from './components/AppLayout.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { startMonitoring } from './lib/monitoring.ts';
import { queryClient } from './lib/queryClient.ts';
import './styles.css';

startMonitoring();

const Loading = () => <div className="page-loading">Carregando...</div>;

const router = createBrowserRouter([
  {
    path: '/login',
    HydrateFallback: Loading,
    lazy: async () => ({ Component: (await import('./pages/AuthPages.tsx')).LoginPage }),
  },
  {
    path: '/cadastro',
    HydrateFallback: Loading,
    lazy: async () => ({ Component: (await import('./pages/AuthPages.tsx')).RegisterPage }),
  },
  // Área logada: as telas abrem em abas dentro do AppLayout (workspace/pages.ts), não como rotas filhas.
  { path: '/*', Component: AppLayout, HydrateFallback: Loading },
]);

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
