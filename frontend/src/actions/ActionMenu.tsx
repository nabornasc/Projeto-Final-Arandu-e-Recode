import { MoreHorizontal } from 'lucide-react';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { useProfile } from '../lib/auth.ts';
import { useActions } from './ActionHost.tsx';
import { availableActions, GROUP_LABELS, GROUP_ORDER, labelOf, type RecordAction } from './registry.ts';

interface Props<T> {
  actions: RecordAction<T>[];
  record: T;
  // Nome do registro para leitores de tela ("Ações do orçamento #012").
  label: string;
  exclude?: string[];
}

// Menu ⋯ com as ações que valem para o registro e o grupo do usuário. Usa a API nativa de popover:
// fica por cima de tabelas com rolagem e fecha com Esc ou clique fora.
export function ActionMenu<T>({ actions, record, label, exclude = [] }: Props<T>) {
  const profile = useProfile();
  const { run } = useActions();
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 0 });

  const items = availableActions(actions, record, profile.permissions).filter(
    (action) => !exclude.includes(action.id),
  );
  if (!items.length) return null;

  const open = () => {
    const rect = trigger.current?.getBoundingClientRect();
    menu.current?.showPopover();
    if (rect) {
      // Abre para cima quando não cabe abaixo do botão (linhas no fim da tela).
      const height = menu.current?.offsetHeight ?? 0;
      const below = rect.bottom + 4 + height <= window.innerHeight;
      setPosition({
        top: below ? rect.bottom + 4 : Math.max(8, rect.top - height - 4),
        right: window.innerWidth - rect.right,
      });
    }
    requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('button')?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move) {
      event.preventDefault();
      buttons[(index + move + buttons.length) % buttons.length]?.focus();
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? buttons[0] : buttons.at(-1))?.focus();
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="action-trigger"
        aria-label={`Ações: ${label}`}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={open}
      >
        <MoreHorizontal size={17} />
      </button>
      <div
        ref={menu}
        id={menuId}
        popover="auto"
        role="menu"
        aria-label={`Ações: ${label}`}
        className="action-menu"
        style={{ top: position.top, right: position.right }}
        onKeyDown={onKeyDown}
        onToggle={(event) => event.newState === 'closed' && trigger.current?.focus({ preventScroll: true })}
      >
        {GROUP_ORDER.map((group) => {
          const inGroup = items.filter((action) => (action.group ?? 'actions') === group);
          if (!inGroup.length) return null;
          return (
            <fieldset key={group} className="action-group">
              {GROUP_LABELS[group] && <legend className="action-group-label">{GROUP_LABELS[group]}</legend>}
              {inGroup.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  className={action.danger ? 'danger' : undefined}
                  onClick={() => {
                    menu.current?.hidePopover();
                    void run(action, record);
                  }}
                >
                  <action.icon size={15} aria-hidden="true" />
                  {labelOf(action, record)}
                </button>
              ))}
            </fieldset>
          );
        })}
      </div>
    </>
  );
}
