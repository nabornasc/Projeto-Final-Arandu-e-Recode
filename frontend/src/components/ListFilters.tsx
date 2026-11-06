import { Printer } from 'lucide-react';
import { formatDate, formatMoney } from '../lib/format.ts';
import { LIST_LIMIT, PERIODS, type PeriodKey, periodRange, type useListFilters } from '../lib/listFilters.ts';

const periodLabel = (key: PeriodKey) => PERIODS.find(([value]) => value === key)?.[1] ?? '';

interface FiltersProps {
  control: ReturnType<typeof useListFilters>;
  dateLabel: string;
  textLabel: string;
  statuses?: readonly (readonly [string, string])[];
}

export function ListFilters({ control, dateLabel, textLabel, statuses }: FiltersProps) {
  const { filters, setFilters, clear, active } = control;
  const update = (patch: Partial<typeof filters>) => setFilters((current) => ({ ...current, ...patch }));
  const statusName = statuses?.find(([value]) => value === filters.status)?.[1];
  const summary = [
    filters.from || filters.to
      ? `${dateLabel}: ${filters.from ? formatDate(filters.from) : 'início'} a ${filters.to ? formatDate(filters.to) : 'hoje em diante'}`
      : null,
    filters.period !== 'custom' && filters.period !== 'all' ? periodLabel(filters.period) : null,
    statusName ? `Status: ${statusName}` : null,
    filters.text ? `${textLabel}: ${filters.text}` : null,
  ].filter(Boolean);

  return (
    <>
      <details className="list-filters panel" open>
        <summary>Filtros</summary>
        <div className="form-grid list-filters-grid">
          <label>
            {dateLabel}
            <select
              name="period"
              value={filters.period}
              onChange={(event) => {
                const period = event.target.value as PeriodKey;
                update(period === 'custom' ? { period } : { period, ...periodRange(period) });
              }}
            >
              {PERIODS.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            De
            <input
              type="date"
              name="from"
              value={filters.from}
              onChange={(event) => update({ period: 'custom', from: event.target.value })}
            />
          </label>
          <label>
            Até
            <input
              type="date"
              name="to"
              value={filters.to}
              onChange={(event) => update({ period: 'custom', to: event.target.value })}
            />
          </label>
          {statuses && (
            <label>
              Status
              <select
                name="status"
                value={filters.status}
                onChange={(event) => update({ status: event.target.value })}
              >
                <option value="">Todos</option>
                {statuses.map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {textLabel}
            <input
              type="search"
              name="search"
              maxLength={120}
              value={filters.text}
              onChange={(event) => update({ text: event.target.value })}
            />
          </label>
          <div className="list-filters-clear">
            <button type="button" className="button secondary" disabled={!active} onClick={clear}>
              Limpar filtros
            </button>
          </div>
        </div>
      </details>
      {/* Na impressão, o formulário some e fica só o resumo do que foi aplicado. */}
      {summary.length > 0 && <p className="list-print-summary">{summary.join(' · ')}</p>}
    </>
  );
}

interface TotalsProps {
  count: number;
  // Quantos registros a API devolveu, antes dos filtros.
  loaded: number;
  totals: { label: string; value: number }[];
}

export function ListTotals({ count, loaded, totals }: TotalsProps) {
  return (
    <div className="list-totals">
      <dl>
        <div>
          <dt>Registros</dt>
          <dd>{count}</dd>
        </div>
        {totals.map((total) => (
          <div key={total.label}>
            <dt>{total.label}</dt>
            <dd>{formatMoney(total.value)}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="button secondary list-print" onClick={() => window.print()}>
        <Printer size={15} /> Imprimir lista
      </button>
      {loaded >= LIST_LIMIT && (
        <p className="list-limit">
          Mostrando os {LIST_LIMIT} registros mais recentes: filtros e totais consideram só esses.
        </p>
      )}
    </div>
  );
}
