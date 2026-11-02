import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { useProfile } from '../lib/auth.ts';
import type { Lead, Order, Quote } from '../lib/documents.ts';
import { formatCode, todayIso } from '../lib/format.ts';
import type { ActionKit, GlobalAction, RecordAction } from './registry.ts';

interface Runner {
  kit: ActionKit;
  run<T>(action: RecordAction<T>, record: T): Promise<void>;
  runGlobal(action: GlobalAction): void;
}

const ActionContext = createContext<Runner | null>(null);

// Carregadas só quando abertas: trazem os schemas de validação, que ficam fora do pacote inicial.
const ConvertQuoteModal = lazy(async () => ({
  default: (await import('./ConvertQuoteModal.tsx')).ConvertQuoteModal,
}));
const LostLeadModal = lazy(async () => ({ default: (await import('./LostLeadModal.tsx')).LostLeadModal }));
const SettleModal = lazy(async () => ({ default: (await import('./SettleModal.tsx')).SettleModal }));

export function useActions(): Runner {
  const runner = useContext(ActionContext);
  if (!runner) throw new Error('useActions fora do ActionHost.');
  return runner;
}

// Executa as ações do registro e guarda as janelas que algumas delas abrem (converter, dar baixa).
export function ActionHost({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const notify = useToast();
  const profile = useProfile();
  const [converting, setConverting] = useState<Quote | null>(null);
  const [settling, setSettling] = useState<Order | null>(null);
  const [losing, setLosing] = useState<Lead | null>(null);

  const done = useCallback(
    (message: string) => {
      void client.invalidateQueries();
      notify(message);
    },
    [client, notify],
  );

  const kit = useMemo<ActionKit>(
    () => ({
      open: (path) => navigate(path),
      request: (path, options) => api(path, options),
      done,
      convert: setConverting,
      settle: setSettling,
      loseLead: setLosing,
      today: todayIso,
    }),
    [navigate, done],
  );

  const run = useCallback(
    async <T,>(action: RecordAction<T>, record: T) => {
      const question = action.confirm?.(record);
      if (question && !window.confirm(question)) return;
      try {
        await action.run(record, kit);
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Não foi possível concluir a ação.', 'error');
      }
    },
    [kit, notify],
  );

  const runner = useMemo<Runner>(() => ({ kit, run, runGlobal: (action) => action.run(kit) }), [kit, run]);

  return (
    <ActionContext value={runner}>
      {children}
      <Suspense>
        {converting && (
          <ConvertQuoteModal
            quote={converting}
            canSettle={profile.permissions.includes('receivables.settle')}
            onClose={() => setConverting(null)}
            onConverted={(order) => {
              setConverting(null);
              done(`Pedido ${formatCode(order.number)} criado e estoque atualizado.`);
              navigate(`/pedidos/${order.id}`);
            }}
          />
        )}
        {settling && (
          <SettleModal
            receivable={settling}
            onClose={() => setSettling(null)}
            onSettled={() => {
              setSettling(null);
              done(`Baixa do pedido ${formatCode(settling.number)} registrada no caixa.`);
            }}
          />
        )}
        {losing && (
          <LostLeadModal
            lead={losing}
            onClose={() => setLosing(null)}
            onLost={() => {
              setLosing(null);
              done(`${losing.name} marcado como perdido.`);
            }}
          />
        )}
      </Suspense>
    </ActionContext>
  );
}
