import { formatDocument } from '@arandue/shared/br';
import { Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router';
import { ActionMenu } from '../actions/ActionMenu.tsx';
import { personActions } from '../actions/registry.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { can, useProfile } from '../lib/auth.ts';
import { permissionFor, ROLE_CONFIG, ROLE_LIST, roleFromPath, usePeople } from '../lib/people.ts';
import { useTab } from '../workspace/tab.ts';

// Lista do cadastro único filtrada pelo papel da aba (Clientes, Fornecedores, Transportadoras...).
export default function PeopleListPage() {
  const profile = useProfile();
  const navigate = useNavigate();
  const { path } = useTab();
  const role = roleFromPath(path);
  const config = ROLE_CONFIG[role];
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const list = usePeople(role, q.length >= 2 ? q : '');
  const canCreate = can(profile, permissionFor(role, 'create'));

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">CADASTROS</span>
          <h2>{config.label}</h2>
          <p>Cadastro único: a mesma pessoa pode ser cliente, fornecedor, transportadora e representante.</p>
        </div>
        {canCreate && (
          <button type="button" className="button primary" onClick={() => navigate(`${config.path}/novo`)}>
            <Plus size={17} /> Novo {config.singular}
          </button>
        )}
      </div>

      <div className="list-toolbar">
        <fieldset className="role-chips">
          <legend className="sr-only">Papel</legend>
          {ROLE_LIST.filter((item) => can(profile, permissionFor(item, 'read'))).map((item) => (
            <button
              key={item}
              type="button"
              className={item === role ? 'chip active' : 'chip'}
              aria-pressed={item === role}
              onClick={() => navigate(ROLE_CONFIG[item].path)}
            >
              {ROLE_CONFIG[item].label}
            </button>
          ))}
        </fieldset>
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            name="q"
            aria-label={`Buscar ${config.label.toLowerCase()}`}
            placeholder="Nome, CPF/CNPJ, telefone, e-mail ou cidade"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="panel table-panel">
        {list.isPending ? (
          <div className="loading">Carregando...</div>
        ) : list.isError ? (
          <EmptyState text={list.error.message} />
        ) : list.data.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>CPF/CNPJ</th>
                  <th>Telefone</th>
                  <th>Cidade</th>
                  <th>Papéis</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <button
                        type="button"
                        className="link-cell"
                        onClick={() => navigate(`/pessoas/${person.id}`)}
                      >
                        {person.name}
                      </button>
                      {person.legalName && person.legalName !== person.name && (
                        <small className="muted block">{person.legalName}</small>
                      )}
                    </td>
                    <td>{formatDocument(person.document) || '—'}</td>
                    <td>{person.mobile ?? person.phone ?? '—'}</td>
                    <td>{person.city ? `${person.city}${person.state ? `/${person.state}` : ''}` : '—'}</td>
                    <td>
                      {ROLE_LIST.filter((item) => person[ROLE_CONFIG[item].flag]).map((item) => (
                        <span key={item} className="role-tag">
                          {ROLE_CONFIG[item].singular}
                        </span>
                      ))}
                    </td>
                    <td className="actions">
                      <ActionMenu actions={personActions} record={person} label={person.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            text={q ? 'Nada encontrado para essa busca.' : `Nenhum ${config.singular} cadastrado ainda.`}
            action={canCreate && !q ? `Cadastrar ${config.singular}` : undefined}
            onClick={() => navigate(`${config.path}/novo`)}
          />
        )}
      </div>
    </section>
  );
}
