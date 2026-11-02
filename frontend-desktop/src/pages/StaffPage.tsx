import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Users, Plus, KeyRound, Power } from 'lucide-react';

const ROLES = [
  { value: 'owner', label: 'Owner / Admin' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'stall_manager', label: 'Stall Manager' },
  { value: 'kitchen_staff', label: 'Kitchen Staff' },
  { value: 'waiter', label: 'Waiter' },
  { value: 'store_staff', label: 'Store Staff' },
];
const STALL_ROLES = ['stall_manager', 'kitchen_staff', 'store_staff'];
const roleLabel = (r: string) => ROLES.find((x) => x.value === r)?.label || r;

interface Staff {
  id: number;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  stall_id: number | null;
  stall: { id: number; name: string } | null;
  is_active: boolean;
}

const emptyForm = { name: '', email: '', password: '', role: 'cashier', stall_id: '' as string | number, phone: '' };

export const StaffPage: React.FC = () => {
  const { user } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [stalls, setStalls] = useState<any[]>([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [resetFor, setResetFor] = useState<Staff | null>(null);
  const [pw, setPw] = useState({ password: '', password_confirmation: '' });
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [s, st] = await Promise.all([apiClient.get('/staff', { params: roleFilter ? { role: roleFilter } : {} }), apiClient.get('/stalls')]);
    setStaff(s.data.data);
    setStalls(st.data.data);
  };

  useEffect(() => {
    load().catch((e) => setError(e.response?.data?.message || 'Failed to load staff'));
  }, [roleFilter]);

  const message = (err: any) => {
    const errors = err.response?.data?.errors;
    return errors ? Object.values(errors).flat().join(' ') : err.response?.data?.message || 'Request failed';
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError(null);
    try {
      await apiClient.post('/staff', { ...form, stall_id: form.stall_id === '' ? null : Number(form.stall_id) });
      setForm(null);
      await load();
    } catch (err: any) {
      setError(message(err));
    }
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    try {
      await apiClient.put(`/staff/${editing.id}`, {
        name: editing.name,
        role: editing.role,
        phone: editing.phone,
        stall_id: editing.stall_id,
      });
      setEditing(null);
      await load();
    } catch (err: any) {
      setError(message(err));
    }
  };

  const toggleActive = async (s: Staff) => {
    if (!confirm(`${s.is_active ? 'Deactivate' : 'Activate'} ${s.name}? ${s.is_active ? 'They will be signed out on every device.' : ''}`)) return;
    try {
      await apiClient.put(`/staff/${s.id}`, { is_active: !s.is_active });
      await load();
    } catch (err: any) {
      alert(message(err));
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetFor) return;
    setError(null);
    try {
      await apiClient.post(`/staff/${resetFor.id}/reset-password`, pw);
      setResetFor(null);
      setPw({ password: '', password_confirmation: '' });
      alert('Password reset. The user must sign in again.');
    } catch (err: any) {
      setError(message(err));
    }
  };

  const input = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm';

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <Users className="w-6 h-6" />
            <span>Staff & Permissions</span>
          </h2>
          <p className="text-sm text-slate-500 mt-1">Roles and stall access are enforced by the server on every request</p>
        </div>
        <div className="flex items-center space-x-2">
          <select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm">
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button onClick={() => { setError(null); setForm({ ...emptyForm }); }} className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-medium text-sm rounded-xl flex items-center space-x-1.5">
            <Plus className="w-4 h-4" />
            <span>Add Staff</span>
          </button>
        </div>
      </div>

      {error && !form && !editing && !resetFor && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Stall</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staff.map((s) => (
              <tr key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                <td className="px-4 py-3 font-semibold">{s.name}</td>
                <td className="px-4 py-3 text-slate-500">{s.email}</td>
                <td className="px-4 py-3">{roleLabel(s.role)}</td>
                <td className="px-4 py-3">{s.stall?.name || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${s.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  <button onClick={() => { setError(null); setEditing({ ...s }); }} className="text-xs font-bold text-brand-600">Edit</button>
                  <button onClick={() => { setError(null); setResetFor(s); }} className="text-xs font-bold text-slate-600 inline-flex items-center"><KeyRound className="w-3 h-3 mr-0.5" />Password</button>
                  {s.id !== user?.id && (
                    <button onClick={() => toggleActive(s)} className="text-xs font-bold text-rose-600 inline-flex items-center">
                      <Power className="w-3 h-3 mr-0.5" />
                      {s.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal title="Add Staff Account" onClose={() => setForm(null)} onSubmit={submitCreate} error={error} submitLabel="Create">
          <input required placeholder="Full name" className={input} value={form.name} onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))} />
          <input required type="email" placeholder="Email (login)" className={input} value={form.email} onChange={(e) => setForm((f) => (f ? { ...f, email: e.target.value } : f))} />
          <input required type="password" minLength={8} placeholder="Initial password (min 8 characters)" className={input} value={form.password} onChange={(e) => setForm((f) => (f ? { ...f, password: e.target.value } : f))} />
          <input placeholder="Phone (optional)" className={input} value={form.phone} onChange={(e) => setForm((f) => (f ? { ...f, phone: e.target.value } : f))} />
          <RoleStallFields role={form.role} stallId={form.stall_id} stalls={stalls} onChange={(role, stall_id) => setForm((f) => (f ? { ...f, role, stall_id } : f))} />
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)} onSubmit={submitEdit} error={error} submitLabel="Save">
          <input required className={input} value={editing.name} onChange={(e) => setEditing((s) => (s ? { ...s, name: e.target.value } : s))} />
          <input placeholder="Phone" className={input} value={editing.phone || ''} onChange={(e) => setEditing((s) => (s ? { ...s, phone: e.target.value } : s))} />
          <RoleStallFields
            role={editing.role}
            stallId={editing.stall_id ?? ''}
            stalls={stalls}
            onChange={(role, stall_id) => setEditing((s) => (s ? { ...s, role, stall_id: stall_id === '' ? null : Number(stall_id) } : s))}
          />
        </Modal>
      )}

      {resetFor && (
        <Modal title={`Reset password · ${resetFor.name}`} onClose={() => setResetFor(null)} onSubmit={submitReset} error={error} submitLabel="Reset">
          <input required type="password" minLength={8} placeholder="New password" className={input} value={pw.password} onChange={(e) => setPw((p) => ({ ...p, password: e.target.value }))} />
          <input required type="password" minLength={8} placeholder="Confirm new password" className={input} value={pw.password_confirmation} onChange={(e) => setPw((p) => ({ ...p, password_confirmation: e.target.value }))} />
          <p className="text-xs text-slate-500">All of this user's sessions are signed out.</p>
        </Modal>
      )}
    </div>
  );
};

const RoleStallFields: React.FC<{ role: string; stallId: string | number; stalls: any[]; onChange: (role: string, stallId: string | number) => void }> = ({ role, stallId, stalls, onChange }) => (
  <>
    <select aria-label="Role" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" value={role} onChange={(e) => onChange(e.target.value, stallId)}>
      {ROLES.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
    </select>
    <select
      aria-label="Stall"
      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
      value={stallId}
      required={STALL_ROLES.includes(role)}
      onChange={(e) => onChange(role, e.target.value)}
    >
      <option value="">{STALL_ROLES.includes(role) ? 'Select stall (required)' : 'No stall (food court wide)'}</option>
      {stalls.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  </>
);

const Modal: React.FC<{ title: string; onClose: () => void; onSubmit: (e: React.FormEvent) => void; error: string | null; submitLabel: string; children: React.ReactNode }> = ({
  title,
  onClose,
  onSubmit,
  error,
  submitLabel,
  children,
}) => (
  <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4">
    <form onSubmit={onSubmit} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-3">
      <h3 className="font-bold text-slate-900 text-lg">{title}</h3>
      {children}
      {error && <div role="alert" className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>}
      <div className="flex space-x-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 py-2 text-xs font-bold text-slate-600 rounded-xl border border-slate-200">Cancel</button>
        <button type="submit" className="flex-1 py-2 text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-xl">{submitLabel}</button>
      </div>
    </form>
  </div>
);
