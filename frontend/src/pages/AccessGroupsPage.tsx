import {
  ACTION_LABELS,
  AREAS,
  type Area,
  PERMISSIONS,
  type Permission,
  requirementsOf,
  withRequirements,
} from '@arandue/shared/permissions';
import { accessGroupSchema } from '@arandue/shared/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { EmptyState } from '../components/EmptyState.tsx';
import { Modal } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { type AccessGroup, useAccessGroups } from '../lib/accessGroups.ts';
import { api } from '../lib/api.ts';
import { type Profile, useProfile } from '../lib/auth.ts';

const AREA_KEYS = Object.keys(AREAS) as Area[];
const permissionOf = (area: Area, action: string) => `${area}.${action}` as Permission;

// Desmarcar uma permissão também desmarca as que dependem dela (ex.: sem "Ver", nada mais na área).
function withoutDependents(current: Set<Permission>, removed: Permission): Set<Permission> {
  const next = new Set(current);
  const drop = (permission: Permission) => {
    next.delete(permission);
    for (const other of PERMISSIONS) {
      if (next.has(other) && requirementsOf(other).includes(permission)) drop(other);
    }
  };
  drop(removed);
  return next;
}

export default function AccessGroupsPage() {
  const profile = useProfile();
  const notify = useToast();
  const client = useQueryClient();
  const groups = useAccessGroups();
  const [editing, setEditing] = useState<{ group: AccessGroup | null } | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => api(`/access-groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries();
      notify('Grupo excluído.');
    },
    onError: (error) => notify(error.message, 'error'),
  });

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">EQUIPE</span>
          <h2>Grupos de acesso</h2>
          <p>Defina o que cada grupo pode ver e fazer. Cada usuário pertence a um grupo.</p>
        </div>
        <button type="button" className="button primary" onClick={() => setEditing({ group: null })}>
          <Plus size={17} /> Novo grupo
        </button>
      </div>

      <div className="panel table-panel">
        {groups.isPending ? (
          <div className="loading">Carregando grupos...</div>
        ) : groups.isError ? (
          <EmptyState text={groups.error.message} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Descrição</th>
                  <th>Permissões</th>
                  <th>Registros visíveis</th>
                  <th>Usuários</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {groups.data.map((group) => (
                  <tr key={group.id}>
                    <td>
                      <strong>{group.name}</strong>
                    </td>
                    <td>{group.description ?? '—'}</td>
                    <td>
                      {group.isOwner ? 'Todas' : `${group.permissions.length} de ${PERMISSIONS.length}`}
                    </td>
                    <td>{group.ownOnly ? 'Só os próprios' : 'Todos da empresa'}</td>
                    <td>{group.userCount}</td>
                    <td className="actions">
                      {group.isOwner ? (
                        <span className="read-only-note">Fixo</span>
                      ) : (
                        <>
                          <button type="button" onClick={() => setEditing({ group })}>
                            Editar
                          </button>
                          <button
                            type="button"
                            className="delete"
                            aria-label={`Excluir grupo ${group.name}`}
                            title={group.userCount ? 'Mova os usuários antes de excluir' : 'Excluir grupo'}
                            disabled={remove.isPending || group.userCount > 0}
                            onClick={() =>
                              window.confirm(`Excluir o grupo ${group.name}?`) && remove.mutate(group.id)
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <GroupForm
          group={editing.group}
          profile={profile}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void client.invalidateQueries();
            notify(editing.group ? 'Grupo atualizado. Vale imediatamente.' : 'Grupo criado.');
          }}
        />
      )}
    </section>
  );
}

interface GroupFormProps {
  group: AccessGroup | null;
  profile: Profile;
  onClose: () => void;
  onSaved: () => void;
}

function GroupForm({ group, profile, onClose, onSaved }: GroupFormProps) {
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [ownOnly, setOwnOnly] = useState(group?.ownOnly ?? false);
  const [selected, setSelected] = useState(() => new Set<Permission>(group?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);

  // Quem não é proprietário só concede o que tem (o que já estava no grupo pode ser mantido).
  const initial = new Set(group?.permissions ?? []);
  const grantable = (permission: Permission) =>
    profile.group.isOwner || profile.permissions.includes(permission) || initial.has(permission);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      group
        ? api(`/access-groups/${group.id}`, { method: 'PUT', body })
        : api('/access-groups', { method: 'POST', body }),
    onSuccess: onSaved,
    onError: (err) => setError(err.message),
  });

  const toggle = (permission: Permission, checked: boolean) =>
    setSelected((current) =>
      checked ? new Set(withRequirements([...current, permission])) : withoutDependents(current, permission),
    );

  const toggleArea = (area: Area, checked: boolean) =>
    setSelected((current) => {
      const permissions = AREAS[area].actions.map((action) => permissionOf(area, action)).filter(grantable);
      if (checked) return new Set(withRequirements([...current, ...permissions]));
      return permissions.reduce(withoutDependents, current);
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = { name, description, ownOnly, permissions: [...selected] };
    const parsed = accessGroupSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    save.mutate(payload);
  }

  return (
    <Modal
      eyebrow="GRUPOS DE ACESSO"
      title={group ? `Editar grupo ${group.name}` : 'Novo grupo de acesso'}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label>
            Nome do grupo
            <input
              name="name"
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Descrição
            <input
              name="description"
              maxLength={255}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="full-row checkbox">
            <input
              name="ownOnly"
              type="checkbox"
              checked={ownOnly}
              onChange={(event) => setOwnOnly(event.target.checked)}
            />
            Em orçamentos e pedidos, ver só os registros que o próprio usuário criou
          </label>
        </div>

        <fieldset className="permission-matrix">
          <legend>Permissões</legend>
          {AREA_KEYS.map((area) => {
            const permissions = AREAS[area].actions.map((action) => permissionOf(area, action));
            const all = permissions.every((permission) => selected.has(permission));
            return (
              <div key={area} className="permission-row">
                <label className="permission-area">
                  <input
                    type="checkbox"
                    checked={all}
                    aria-label={`Todas as permissões de ${AREAS[area].label}`}
                    onChange={(event) => toggleArea(area, event.target.checked)}
                  />
                  {AREAS[area].label}
                </label>
                <div className="permission-actions">
                  {AREAS[area].actions.map((action) => {
                    const permission = permissionOf(area, action);
                    return (
                      <label key={permission} className="checkbox">
                        <input
                          type="checkbox"
                          name={permission}
                          checked={selected.has(permission)}
                          disabled={!grantable(permission)}
                          onChange={(event) => toggle(permission, event.target.checked)}
                        />
                        {ACTION_LABELS[action]}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </fieldset>
        {!profile.group.isOwner && (
          <p className="read-only-note">Você só pode conceder as permissões que o seu grupo tem.</p>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Salvando...' : group ? 'Salvar grupo' : 'Criar grupo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
