import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BriefcaseBusiness,
  CircleDollarSign,
  ClipboardList,
} from 'lucide-react';
import { Link, Navigate, useOutletContext } from 'react-router';
import { EmptyState } from '../components/EmptyState.tsx';
import { MetricCard } from '../components/MetricCard.tsx';
import { navigation } from '../config/navigation.ts';
import { api } from '../lib/api.ts';
import { can, type Profile } from '../lib/auth.ts';
import { formatCode, formatDate, formatMoney, label } from '../lib/format.ts';

interface Dashboard {
  revenueMonth: number;
  expensesMonth: number;
  balance: number;
  pendingOrders: number;
  revenueYear: number;
  meiAnnualLimit: number | null;
  recentOrders: {
    id: number;
    number: number;
    orderDate: string;
    total: number;
    status: string;
    customerName: string | null;
  }[];
}

export default function DashboardPage() {
  const profile = useOutletContext<Profile>();
  const allowed = can(profile, 'analytics.read');
  const query = useQuery({
    queryKey: ['/dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
    enabled: allowed,
  });

  // Quem não vê a análise gerencial (vendedor) começa pela primeira tela permitida.
  if (!allowed) {
    const first = navigation.find((item) => can(profile, item.permission));
    return <Navigate to={first?.path ?? '/pedidos'} replace />;
  }

  const data = query.data;
  const result = (data?.revenueMonth ?? 0) - (data?.expensesMonth ?? 0);
  const limitUsed = data?.meiAnnualLimit ? data.revenueYear / data.meiAnnualLimit : null;

  return (
    <div className="dashboard">
      <section className="welcome-card">
        <div>
          <span className="welcome-label">BOM TE VER POR AQUI! 👋</span>
          <h2>Seu negócio, no seu ritmo.</h2>
          <p>Acompanhe o que importa e tome decisões com mais tranquilidade.</p>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <BriefcaseBusiness size={70} />
        </div>
      </section>

      <div className="section-heading">
        <div>
          <h2>Visão financeira do mês</h2>
          <p>Um resumo consolidado para você saber como o negócio está andando.</p>
        </div>
      </div>

      {query.isError ? (
        <div className="panel">
          <EmptyState text={`Não foi possível carregar o resumo: ${query.error.message}`} />
        </div>
      ) : (
        <section className="metric-grid">
          <MetricCard
            icon={ArrowUpCircle}
            label="Faturamento do mês"
            value={formatMoney(data?.revenueMonth)}
            tone="green"
            helper="Pedidos pagos ou concluídos"
          />
          <MetricCard
            icon={ArrowDownCircle}
            label="Despesas pagas no mês"
            value={formatMoney(data?.expensesMonth)}
            tone="red"
            helper="Saídas confirmadas"
          />
          <MetricCard
            icon={CircleDollarSign}
            label="Saldo atual"
            value={formatMoney(data?.balance)}
            tone="purple"
            helper="Contas ativas + movimentações"
          />
          <MetricCard
            icon={ClipboardList}
            label="Pedidos pendentes"
            value={data?.pendingOrders ?? 0}
            tone="yellow"
            helper="Aguardando recebimento"
          />
        </section>
      )}

      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Últimos pedidos</h3>
              <p>Veja os pedidos mais recentes e acompanhe o status.</p>
            </div>
            <Link className="link-button" to="/pedidos">
              Ver todos
            </Link>
          </div>
          {data?.recentOrders.length ? (
            <div className="order-list">
              {data.recentOrders.map((order) => (
                <div className="order-row" key={order.id}>
                  <div className="order-symbol">{formatCode(order.number)}</div>
                  <div className="order-info">
                    <strong>{order.customerName ?? 'Cliente não informado'}</strong>
                    <small>{formatDate(order.orderDate)}</small>
                  </div>
                  <span className={`status ${order.status}`}>{label(order.status)}</span>
                  <strong>{formatMoney(order.total)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text={query.isPending ? 'Carregando...' : 'Nenhum pedido cadastrado ainda.'} />
          )}
        </section>

        <section className="panel impact-panel">
          <div className="impact-icon" aria-hidden="true">
            🌱
          </div>
          <span className="welcome-label">ODS 1 · ERRADICAÇÃO DA POBREZA</span>
          <h3>Pequenas decisões, grandes caminhos.</h3>
          <p>
            Quando o microempreendedor organiza seu caixa e precifica com clareza, ganha sustentabilidade e
            renda para prosperar a longo prazo.
          </p>
          <div className="result-line">
            <span>Resultado do mês (faturamento − despesas)</span>
            <strong className={result >= 0 ? 'positive' : 'negative'}>{formatMoney(result)}</strong>
          </div>
          {data && (
            <div className="result-line mei-limit">
              <span>Faturamento do ano em relação ao limite do MEI</span>
              {limitUsed === null ? (
                <strong>Limite não configurado</strong>
              ) : (
                <>
                  <strong className={limitUsed >= 1 ? 'negative' : undefined}>
                    {Math.round(limitUsed * 100)}% · {formatMoney(data.revenueYear)} de{' '}
                    {formatMoney(data.meiAnnualLimit)}
                  </strong>
                  <meter min={0} max={1} low={0.6} high={0.8} optimum={0} value={Math.min(limitUsed, 1)}>
                    {Math.round(limitUsed * 100)}%
                  </meter>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
