import { Plus } from 'lucide-react';

export function EmptyState({
  text,
  action,
  onClick,
}: {
  text: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="empty-state">
      <p>{text}</p>
      {action && onClick && (
        <button type="button" className="button secondary" onClick={onClick}>
          <Plus size={15} /> {action}
        </button>
      )}
    </div>
  );
}
