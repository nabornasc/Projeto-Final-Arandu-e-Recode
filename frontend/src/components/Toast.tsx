import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

type ToastType = 'success' | 'error';
interface ToastState {
  id: number;
  message: string;
  type: ToastType;
}

const ToastContext = createContext<(message: string, type?: ToastType) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string, type: ToastType = 'success') => {
    // Cada aviso reinicia o temporizador (na v1, o timer de um aviso antigo apagava o novo).
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), message, type });
    timer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext value={notify}>
      {children}
      {toast && (
        <div
          key={toast.id}
          className={`toast ${toast.type}`}
          role={toast.type === 'error' ? 'alert' : 'status'}
        >
          <span aria-hidden="true">{toast.type === 'success' ? '✓' : '!'}</span>
          {toast.message}
        </div>
      )}
    </ToastContext>
  );
}

export const useToast = () => useContext(ToastContext);
