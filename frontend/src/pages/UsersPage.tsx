import { userCreateSchema, userUpdateSchema } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { EmptyState } from '../components/EmptyState.tsx';
import { Modal } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { type AccessGroup, useAccessGroups } from '../lib/accessGroups.ts';
import { api } from '../lib/api.ts';
import { can, useProfile } from '../lib/auth.ts';

interface User {
  id: number;
  name: string;
  email: string;
  groupId: number;
  groupName: string;
  active: boolean;
}

// Quem vê usuários (users.read) chega aqui; convidar e editar exigem users.manage. O backend confere de novo.
export default function UsersPage() {
  const profile = useProfile();
  const notify = useToast();
  const client = useQueryClient();
  const [editing, setEditing] = useState<User | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const users = useQuery({ queryKey: ['/users'], queryFn: () => api<User[]>('/users') });
  const groups = useAccessGroups();
  const canManage = can(profile, 'users.manage');
  // Sem escalada: só aparecem os grupos que o administrador pode atribuir (o servidor recusa os demais).
  const grantable = (groups.data ?? []).filter(
    (group) =>
      profile.group.isOwner ||
      (!group.isOwner && group.permissions.every((permission) => profile.permissions.includes(permission))),
  );
  const canEdit = (user: User) =>
    canManage && (profile.group.isOwner || grantable.some((group) => group.id === user.groupId));

  const open = (user: User | null) => {
    setEditing(user);
    setModalOpen(true);
  };

  return (
    <section>
      <div className="section-heading page-heading">
        <div>
          <span className="welcome-label">EQUIPE</span>
          <h2>Usuários</h2>
          <p>Convide a equipe e defina o que cada pessoa pode fazer.</p>
        </div>
        {canManage ? (
          <button type="button" className="button primary" onClick={() => open(null)}>
            <Plus size={17} /> Convidar usuário
          </button>
        ) : (
          <span className="read-only-note">Somente leitura</span>
        )}
      </div>

      <div className="panel table-panel">
        {users.isPending ? (
          <div className="loading">Carregando usuários...</div>
        ) : users.isError ? (
          <EmptyState text={users.error.message} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Grupo de acesso</th>
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {users.data.map((user) => (
                  <tr key={user.id}>
                    <td>
                      {user.name}
                      {user.id === profile.id && ' (você)'}
                    </td>
                    <td>{user.email}</td>
                    <td>{user.groupName}</td>
                    <td>
                      <span className={`status ${user.active ? 'active' : 'inactive'}`}>
                        {user.active ? 'Ativo' : 'Desativado'}
                      </span>
                    </td>
                    <td className="actions">
                      {canEdit(user) && (
                        <button type="button" onClick={() => open(user)}>
                          Editar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <UserForm
          user={editing}
          isSelf={editing?.id === profile.id}
          groups={grantable}
          onClose={() => setModalOpen(false)}
          onSaved={(message) => {
            setModalOpen(false);
            void client.invalidateQueries();
            notify(message);
          }}
        />
      )}
    </section>
  );
}

interface FormProps {
  user: User | null;
  isSelf: boolean;
  groups: AccessGroup[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

function UserForm({ user, isSelf, groups, onClose, onSaved }: FormProps) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [groupId, setGroupId] = useState(user ? String(user.groupId) : '');
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      user ? api(`/users/${user.id}`, { method: 'PUT', body }) : api('/users', { method: 'POST', body }),
    onSuccess: () => onSaved(user ? 'Usuário atualizado.' : 'Usuário convidado. Repasse a senha inicial.'),
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const group = Number(groupId) || undefined;
    const payload = user
      ? { name, groupId: group, active, password }
      : { name, email, groupId: group, password };
    const parsed = (user ? userUpdateSchema : userCreateSchema).safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Verifique os campos.');
    setError(null);
    save.mutate(payload);
  }

  return (
    <Modal eyebrow="EQUIPE" title={user ? 'Editar usuário' : 'Convidar usuário'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label>
            Nome
            <input name="name" required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            E-mail (login)
            <input
              name="email"
              type="email"
              required
              disabled={Boolean(user)}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Grupo de acesso
            <select
              name="groupId"
              value={groupId}
              disabled={isSelf}
              onChange={(event) => setGroupId(event.target.value)}
            >
              <option value="">Selecione</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {user ? 'Nova senha (vazio mantém a atual)' : 'Senha inicial'}
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required={!user}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {user && (
            <label className="full-row checkbox">
              <input
                name="active"
                type="checkbox"
                disabled={isSelf}
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Acesso ativo (desativar encerra as sessões abertas)
            </label>
          )}
        </div>
        {isSelf && (
          <p className="read-only-note">Você não pode mudar o seu próprio grupo nem se desativar.</p>
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
            {save.isPending ? 'Salvando...' : user ? 'Salvar alterações' : 'Convidar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
