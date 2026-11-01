import { Plus } from 'lucide-react';

export function EmptyState({ text, action, onClick }) {
  return (
    <div className="empty-state">
      <p>{text}</p>
      {action && (
        <button className="button secondary" onClick={onClick}>
          <Plus size={15} /> {action}
        </button>
      )}
    </div>
  );
}

