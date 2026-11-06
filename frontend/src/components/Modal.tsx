import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';

interface Props {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

// <dialog> nativo: prende o foco dentro do modal, fecha com Esc e é anunciado por leitores de tela.
export function Modal({ eyebrow, title, onClose, children, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: o equivalente de teclado é o Esc nativo do <dialog> (onCancel).
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Clique no fundo escurecido (fora do conteúdo) fecha o modal.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal-body">
        <div className="modal-header">
          <button type="button" onClick={onClose} aria-label="Fechar janela">
            <X size={19} />
          </button>
          <div>
            <span className="welcome-label">{eyebrow}</span>
            <h3 id={titleId}>{title}</h3>
          </div>
        </div>
        {children}
      </div>
    </dialog>
  );
}
