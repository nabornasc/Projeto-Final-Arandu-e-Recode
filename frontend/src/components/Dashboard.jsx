import { useEffect, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BriefcaseBusiness,
  CircleDollarSign,
  ClipboardList,
  Plus,
} from 'lucide-react';
import { request } from '../services/api';
import { formatCell, formatMoney } from '../utils/formatters';
import { MetricCard } from './MetricCard';
import { EmptyState } from './EmptyState';

export function Dashboard({ onNavigate }) {
  const [data, setData] = useState({
    revenue: 0,
    expenses: 0,
    balance: 0,
    pending_orders: 0,
    recentOrders: [],
  });

  useEffect(() => {
    request('/dashboard')
      .then(setData)
      .catch(() => {});
  }, []);

  const result = Number(data.revenue) - Number(data.expenses);

  return (
    <div className="dashboard">
      <section className="welcome-card">
        <div>
          <span className="welcome-label">BOM TE VER POR AQUI! 👋</span>
          <h2>Seu negócio, no seu ritmo.</h2>
          <p>Acompanhe o que importa e tome decisões com mais tranquilidade.</p>
        </div>
        <div className="welcome-art">
          <BriefcaseBusiness size={70} />
        </div>
      </section>

      <div className="section-heading">
        <div>
          <h2>Visão financeira</h2>
          <p>Um resumo consolidado para você saber como o negócio está andando.</p>
        </div>
        <button className="button secondary" onClick={() => onNavigate('transactions')}>
          <Plus size={16} /> Lançar movimentação
        </button>
      </div>

      <section className="metric-grid">
        <MetricCard
          icon={ArrowUpCircle}
          label="Faturamento"
          value={formatMoney(data.revenue)}
          tone="green"
          helper="Total de vendas ativas"
        />
        <MetricCard
          icon={ArrowDownCircle}
          label="Despesas pagas"
          value={formatMoney(data.expenses)}
          tone="red"
          helper="Saídas confirmadas"
        />
        <MetricCard
          icon={CircleDollarSign}
          label="Saldo estimado"
          value={formatMoney(data.balance)}
          tone="purple"
          helper="Caixas + contas bancárias"
        />
        <MetricCard
          icon={ClipboardList}
          label="Pedidos pendentes"
          value={data.pending_orders}
          tone="yellow"
          helper="Aguardando recebimento"
        />
      </section>

      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Últimos pedidos</h3>
              <p>Veja os pedidos mais recentes e acompanhe o status.</p>
            </div>
            <button className="link-button" onClick={() => onNavigate('orders')}>
              Ver todos
            </button>
          </div>

          {data.recentOrders.length ? (
            <div className="order-list">
              {data.recentOrders.map((order) => (
                <div className="order-row" key={order.id}>
                  <div className="order-symbol">#{String(order.id).padStart(3, '0')}</div>
                  <div className="order-info">
                    <strong>{order.customer_name}</strong>
                    <small>{formatCell('order_date', order.order_date)}</small>
                  </div>
                  <span className={`status ${order.status}`}>{formatCell('status', order.status)}</span>
                  <strong>{formatMoney(order.total)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              text="Nenhum pedido cadastrado ainda."
              action="Criar pedido"
              onClick={() => onNavigate('orders')}
            />
          )}
        </section>

        <section className="panel impact-panel">
          <div className="impact-icon">🌱</div>
          <span className="welcome-label">ODS 1 · ERRADICAÇÃO DA POBREZA</span>
          <h3>Pequenas decisões, grandes caminhos.</h3>
          <p>
            Quando o microempreendedor organiza seu caixa e precifica com clareza, ganha sustentabilidade
            e renda para prosperar a longo prazo.
          </p>
          <div className="progress">
            <span style={{ width: '75%' }} />
          </div>
          <small>Seu negócio está construindo uma base de controle sólida.</small>
          <div className="result-line">
            <span>Resultado estimado (Faturamento - Despesas)</span>
            <strong className={result >= 0 ? 'positive' : 'negative'}>
              {formatMoney(result)}
            </strong>
          </div>
        </section>
      </div>
    </div>
  );
}

