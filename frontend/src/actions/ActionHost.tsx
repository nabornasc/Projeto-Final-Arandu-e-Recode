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
import type { Opportunity, Order, Quote } from '../lib/documents.ts';
import { formatCode, todayIso } from '../lib/format.ts';
import type { ReasonRequest } from './ReasonModal.tsx';
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
const LostOpportunityModal = lazy(async () => ({
  default: (await import('./LostOpportunityModal.tsx')).LostOpportunityModal,
}));
const LinkOpportunityModal = lazy(async () => ({
  default: (await import('./LinkOpportunityModal.tsx')).LinkOpportunityModal,
}));
const DuplicateModal = lazy(async () => ({ default: (await import('./DuplicateModal.tsx')).DuplicateModal }));
const SettleModal = lazy(async () => ({ default: (await import('./SettleModal.tsx')).SettleModal }));
const ReasonModal = lazy(async () => ({ default: (await import('./ReasonModal.tsx')).ReasonModal }));

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
  const [losing, setLosing] = useState<Opportunity | null>(null);
  const [askingReason, setAskingReason] = useState<ReasonRequest | null>(null);
  const [linking, setLinking] = useState<{ type: 'quote' | 'order'; document: Quote | Order } | null>(null);
  const [duplicating, setDuplicating] = useState<{ type: 'quote' | 'order'; document: Quote | Order } | null>(
    null,
  );

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
      askReason: setAskingReason,
      loseOpportunity: setLosing,
      linkOpportunity: (type, document) => setLinking({ type, document }),
      duplicate: (type, document) => setDuplicating({ type, document }),
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
            title={`Dar baixa no pedido ${formatCode(settling.number)}`}
            customerName={settling.customerName}
            amount={settling.receivables
              .filter((item) => item.status === 'open')
              .reduce((sum, item) => sum + item.amount - item.paidAmount, 0)}
            endpoint={`/orders/${settling.id}/settle`}
            onClose={() => setSettling(null)}
            onSettled={() => {
              setSettling(null);
              done(`Baixa do pedido ${formatCode(settling.number)} registrada no caixa.`);
            }}
          />
        )}
        {askingReason && (
          <ReasonModal
            request={askingReason}
            onClose={() => setAskingReason(null)}
            onDone={() => {
              setAskingReason(null);
              done(askingReason.message);
            }}
          />
        )}
        {losing && (
          <LostOpportunityModal
            opportunity={losing}
            onClose={() => setLosing(null)}
            onLost={() => {
              setLosing(null);
              done(`${losing.title}: perdida.`);
            }}
          />
        )}
        {linking && (
          <LinkOpportunityModal
            type={linking.type}
            document={linking.document}
            onClose={() => setLinking(null)}
            onLinked={() => {
              setLinking(null);
              done('Documento vinculado à oportunidade.');
            }}
          />
        )}
        {duplicating && (
          <DuplicateModal
            type={duplicating.type}
            document={duplicating.document}
            onClose={() => setDuplicating(null)}
            onDuplicated={(path, message) => {
              setDuplicating(null);
              done(message);
              navigate(path);
            }}
          />
        )}
      </Suspense>
    </ActionContext>
  );
}
