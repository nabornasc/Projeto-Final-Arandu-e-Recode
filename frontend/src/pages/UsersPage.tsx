import { ROLE_LABELS, ROLES, type Role } from '@arandue/shared/rbac';
import { userCreateSchema, userUpdateSchema } from '@arandue/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useOutletContext } from 'react-router';
import { EmptyState } from '../components/EmptyState.tsx';
import { Modal } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import type { Profile } from '../lib/auth.ts';

interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

// Só o proprietário chega aqui (módulo "users"); o backend confere de novo.
export default function UsersPage() {
  const profile = useOutletContext<Profile>();
  const notify = useToast();
  const client = useQueryClient();
  const [editing, setEditing] = useState<User | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const users = useQuery({ queryKey: ['/users'], queryFn: () => api<User[]>('/users') });

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
        <button type="button" className="button primary" onClick={() => open(null)}>
          <Plus size={17} /> Convidar usuário
        </button>
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
                  <th>Papel</th>
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
                    <td>{ROLE_LABELS[user.role]}</td>
                    <td>
                      <span className={`status ${user.active ? 'active' : 'inactive'}`}>
                        {user.active ? 'Ativo' : 'Desativado'}
                      </span>
                    </td>
                    <td className="actions">
                      <button type="button" onClick={() => open(user)}>
                        Editar
                      </button>
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
  onClose: () => void;
  onSaved: (message: string) => void;
}

function UserForm({ user, isSelf, onClose, onSaved }: FormProps) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'seller');
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
    const payload = user ? { name, role, active, password } : { name, email, role, password };
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
            Papel
            <select
              name="role"
              value={role}
              disabled={isSelf}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
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
          <p className="read-only-note">Você não pode alterar o seu próprio papel nem se desativar.</p>
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
