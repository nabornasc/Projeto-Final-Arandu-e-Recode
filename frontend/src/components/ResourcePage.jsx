import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { request } from '../services/api';
import { resourceConfig } from '../config/resources';
import { formatCell } from '../utils/formatters';
import { EmptyState } from './EmptyState';
import { FormModal } from './FormModal';

export function ResourcePage({ resource, notify }) {
  const config = resourceConfig[resource];
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    request(`/${config.endpoint}`)
      .then(setRows)
      .catch((error) => notify(error.message, 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [resource]);

  async function remove(id) {
    if (!window.confirm('Excluir este registro?')) return;
    try {
      await request(`/${config.endpoint}/${id}`, { method: 'DELETE' });
      notify('Registro excluído com sucesso.');
      load();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">GESTÃO DO NEGÓCIO</span>
          <h2>{config.title}</h2>
          <p>Cadastre e acompanhe informações essenciais da sua rotina.</p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setEditing(null);
            setModal(true);
          }}
        >
          <Plus size={17} /> Novo registro
        </button>
      </div>

      <div className="panel table-panel">
        {loading ? (
          <div className="loading">Carregando dados...</div>
        ) : rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {config.columns.map(([, label]) => (
                    <th key={label}>{label}</th>
                  ))}
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {config.columns.map(([key]) => (
                      <td key={key}>{formatCell(key, row[key])}</td>
                    ))}
                    <td className="actions">
                      <button
                        title="Editar registro"
                        onClick={() => {
                          setEditing(row);
                          setModal(true);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="delete"
                        title="Excluir registro"
                        onClick={() => remove(row.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            text="Ainda não há registros cadastrados nesta seção."
            action="Adicionar primeiro"
            onClick={() => {
              setEditing(null);
              setModal(true);
            }}
          />
        )}
      </div>

      {modal && (
        <FormModal
          config={config}
          initial={editing}
          onClose={() => setModal(false)}
          onSaved={() => {
            setModal(false);
            load();
            notify(editing ? 'Registro atualizado com sucesso.' : 'Registro criado com sucesso.');
          }}
          onError={(error) => notify(error.message, 'error')}
        />
      )}
    </section>
  );
}

