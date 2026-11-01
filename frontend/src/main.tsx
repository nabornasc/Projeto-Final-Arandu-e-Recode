import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppLayout } from './components/AppLayout.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { queryClient } from './lib/queryClient.ts';
import './styles.css';

const Loading = () => <div className="page-loading">Carregando...</div>;

// Cada tela interna é carregada só quando acessada (o JS inicial fica pequeno).
const resourcePage = (name: keyof typeof import('./pages/ResourcePages.tsx')) => async () => {
  const module = await import('./pages/ResourcePages.tsx');
  return { Component: module[name] };
};

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
  {
    path: '/',
    Component: AppLayout,
    HydrateFallback: Loading,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('./pages/DashboardPage.tsx')).default }) },
      {
        path: 'pedidos',
        lazy: async () => ({ Component: (await import('./pages/OrdersPage.tsx')).default }),
      },
      { path: 'produtos', lazy: resourcePage('ProductsPage') },
      { path: 'clientes', lazy: resourcePage('CustomersPage') },
      { path: 'despesas', lazy: resourcePage('ExpensesPage') },
      { path: 'contas', lazy: resourcePage('AccountsPage') },
      { path: 'movimentacoes', lazy: resourcePage('TransactionsPage') },
    ],
  },
  {
    path: '*',
    HydrateFallback: Loading,
    lazy: async () => ({ Component: (await import('./pages/NotFoundPage.tsx')).default }),
  },
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
