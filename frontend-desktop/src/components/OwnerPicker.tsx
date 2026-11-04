import React, { useState } from 'react';
import { apiClient } from '../api/client';
import { inputClass } from './ui';

/**
 * Picks the stall owner (the person settlement money is paid to) for a stall, with an inline "add owner" so the
 * owner never has to leave the stall form. Owners can hold several stalls; payouts can then be made per owner.
 */
export const OwnerPicker: React.FC<{
  owners: any[];
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  onOwnerAdded: (owner: any) => void;
}> = ({ owners, value, onChange, onOwnerAdded }) => {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) {
      setError('Enter the owner name.');
      return;
    }
    try {
      const res = await apiClient.post('/stall-owners', { name: name.trim(), phone: phone.trim() || null });
      onOwnerAdded(res.data.data);
      onChange(res.data.data.id);
      setAdding(false);
      setName('');
      setPhone('');
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not add the owner.');
    }
  };

  return (
    <div className="space-y-2">
      <select aria-label="Stall owner" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={inputClass}>
        <option value="">No owner assigned</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {adding ? (
        <div className="space-y-2 p-2 rounded-lg border border-line bg-canvas">
          <input aria-label="New owner name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Owner name" className={inputClass} />
          <input aria-label="New owner phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className={inputClass} />
          {error && <p role="alert" className="text-xs text-danger-fg">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className="flex-1 py-1 text-xs font-semibold text-muted rounded-lg border border-line">Cancel</button>
            <button type="button" onClick={add} className="flex-1 py-1 text-xs font-semibold text-primary-fg bg-primary rounded-lg">Add owner</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="text-xs font-semibold text-primary">
          + New owner
        </button>
      )}
    </div>
  );
};
