export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.type}`}>
      <span>{toast.type === 'success' ? '✓' : '!'}</span>
      {toast.message}
    </div>
  );
}

