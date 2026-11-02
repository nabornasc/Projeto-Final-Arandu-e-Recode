import { LEAD_STAGES } from '@arandue/shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ActionMenu } from '../actions/ActionMenu.tsx';
import { leadActions } from '../actions/registry.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';
import type { Lead } from '../lib/documents.ts';
import { formatDate, label, todayIso } from '../lib/format.ts';

// Funil de vendas em colunas. Os leads mudam de etapa pelo menu ⋯ (sem arrastar, de propósito).
export default function CrmPage() {
  const profile = useProfile();
  const navigate = useNavigate();
  const leads = useQuery({ queryKey: ['/leads'], queryFn: () => api<Lead[]>('/leads') });
  const today = todayIso();

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">CRM</span>
          <h2>Funil de vendas</h2>
          <p>
            Acompanhe cada contato até virar cliente.
            {profile.ownOnly && ' Você vê os leads de que é responsável.'}
          </p>
        </div>
        {can(profile, 'leads.create') && (
          <button type="button" className="button primary" onClick={() => navigate('/crm/novo')}>
            <Plus size={17} /> Novo lead
          </button>
        )}
      </div>

      {leads.isPending ? (
        <div className="loading">Carregando funil...</div>
      ) : leads.isError ? (
        <EmptyState text={leads.error.message} />
      ) : (
        <div className="kanban">
          {LEAD_STAGES.map((stage) => {
            const column = leads.data.filter((lead) => lead.stage === stage);
            return (
              <section key={stage} className={`kanban-column stage-${stage}`} aria-label={label(stage)}>
                <h3>
                  {label(stage)} <span className="kanban-count">{column.length}</span>
                </h3>
                {column.map((lead) => {
                  const overdue =
                    lead.nextActionAt !== null &&
                    lead.nextActionAt < today &&
                    stage !== 'won' &&
                    stage !== 'lost';
                  return (
                    <article key={lead.id} className="lead-card">
                      <div className="lead-card-head">
                        <button
                          type="button"
                          className="link-cell"
                          onClick={() => navigate(`/crm/${lead.id}`)}
                        >
                          {lead.name}
                        </button>
                        <ActionMenu actions={leadActions} record={lead} label={`lead ${lead.name}`} />
                      </div>
                      <small className="muted">
                        {lead.source}
                        {lead.ownerName && ` · ${lead.ownerName}`}
                      </small>
                      {stage === 'lost' && lead.lostReason && (
                        <small className="muted">Motivo: {lead.lostReason}</small>
                      )}
                      {lead.nextAction && stage !== 'won' && stage !== 'lost' && (
                        <small className={overdue ? 'overdue' : 'muted'}>
                          {overdue ? 'Atrasado: ' : 'Próximo: '}
                          {lead.nextAction}
                          {lead.nextActionAt && ` (${formatDate(lead.nextActionAt)})`}
                        </small>
                      )}
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
