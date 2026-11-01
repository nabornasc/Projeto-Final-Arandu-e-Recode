import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone: 'green' | 'red' | 'purple' | 'yellow';
  helper: string;
}

export function MetricCard({ icon: Icon, label, value, tone, helper }: Props) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>
        <Icon size={19} aria-hidden="true" />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}
