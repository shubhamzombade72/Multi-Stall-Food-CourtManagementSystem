import React, { useEffect, useState } from 'react';
import { Search, Plus, Minus, Check, Tag } from 'lucide-react';
import { apiClient } from '../../api/client';
import { Modal } from '../ui';
import type { BoardOrder } from '../../lib/fulfillment';

interface MenuItem {
  id: number;
  stall_id: number;
  category_id?: number;
  name: string;
  price: string;
  is_veg: boolean;
  is_available: boolean;
  stall: {
    id: number;
    name: string;
    code: string;
  };
  category?: {
    id: number;
    name: string;
  };
}

interface Stall {
  id: number;
  name: string;
  code: string;
}

interface Category {
  id: number;
  name: string;
}

interface Props {
  order: BoardOrder;
  onClose: () => void;
  onAdd: (orderId: number, menuItemId: number, quantity: number, instructions?: string) => Promise<boolean>;
}

export const AddItemModal: React.FC<Props> = ({ order, onClose, onAdd }) => {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedStallId, setSelectedStallId] = useState<number | 'all'>('all');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [instructions, setInstructions] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [menuRes, stallsRes, catRes] = await Promise.all([
          apiClient.get('/menu?available_only=1'),
          apiClient.get('/stalls'),
          apiClient.get('/menu-categories').catch(() => ({ data: { data: [] } })),
        ]);
        if (active) {
          setMenuItems(menuRes.data.data || []);
          setStalls(stallsRes.data.data || []);
          setCategories(catRes.data.data || []);
        }
      } catch {
        if (active) setError('Could not load menu catalog.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const changeQty = (itemId: number, delta: number) => {
    setQuantities((prev) => {
      const cur = prev[itemId] ?? 1;
      const next = Math.max(1, cur + delta);
      return { ...prev, [itemId]: next };
    });
  };

  const handleAddItem = async (item: MenuItem) => {
    setError(null);
    setSuccessNotice(null);
    setSubmittingId(item.id);
    const qty = quantities[item.id] ?? 1;
    const note = instructions[item.id]?.trim() || undefined;

    const ok = await onAdd(order.id, item.id, qty, note);
    setSubmittingId(null);
    if (ok) {
      setSuccessNotice(`Added ${qty} × ${item.name} to order #${order.order_number}`);
      setQuantities((prev) => ({ ...prev, [item.id]: 1 }));
      setInstructions((prev) => ({ ...prev, [item.id]: '' }));
    }
  };

  const filtered = menuItems.filter((i) => {
    const matchStall = selectedStallId === 'all' || i.stall_id === selectedStallId;
    const matchCat = selectedCategoryId === 'all' || i.category?.id === selectedCategoryId || i.category_id === selectedCategoryId;
    const term = search.toLowerCase().trim();
    const matchTerm =
      !term ||
      i.name.toLowerCase().includes(term) ||
      i.stall?.name?.toLowerCase().includes(term) ||
      (i.category?.name && i.category.name.toLowerCase().includes(term));
    return matchStall && matchCat && matchTerm;
  });

  return (
    <Modal
      title={`Add Extra Items · Order #${order.order_number}`}
      onClose={onClose}
      wide={true}
      error={error}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted border-b border-line pb-2">
          <span>
            {order.table ? `Table ${order.table.table_number}` : 'Takeaway'} · {order.items.length} item(s) currently
          </span>
          {successNotice && (
            <span className="font-semibold text-success-fg flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-success-fg" />
              <span>{successNotice}</span>
            </span>
          )}
        </div>

        {/* Filter controls: Search, Stall tabs, Category tabs */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-muted absolute left-2.5 top-2.5" />
              <input
                type="text"
                data-testid="add-item-search"
                placeholder="Search dishes by name or category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-line text-xs bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-focus"
              />
            </div>

            {/* Stall filter */}
            <div className="flex items-center gap-1 overflow-x-auto max-w-full py-0.5">
              <button
                type="button"
                data-testid="filter-stall-all"
                onClick={() => setSelectedStallId('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                  selectedStallId === 'all'
                    ? 'bg-primary text-primary-fg'
                    : 'bg-surface-2 text-muted hover:text-fg'
                }`}
              >
                All Stalls
              </button>
              {stalls.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-testid={`filter-stall-${s.id}`}
                  onClick={() => setSelectedStallId(s.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                    selectedStallId === s.id
                      ? 'bg-primary text-primary-fg'
                      : 'bg-surface-2 text-muted hover:text-fg'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          {/* Category filter pills if available */}
          {categories.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto py-0.5 border-t border-line/60 pt-1.5 text-xs">
              <span className="text-muted text-[11px] font-medium flex items-center gap-1 shrink-0 mr-1">
                <Tag className="w-3 h-3" /> Category:
              </span>
              <button
                type="button"
                onClick={() => setSelectedCategoryId('all')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                  selectedCategoryId === 'all'
                    ? 'bg-surface-2 font-bold text-fg border border-line'
                    : 'text-muted hover:text-fg'
                }`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(c.id)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap transition ${
                    selectedCategoryId === c.id
                      ? 'bg-surface-2 font-bold text-fg border border-line'
                      : 'text-muted hover:text-fg'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dishes list */}
        {loading ? (
          <div className="py-12 text-center text-muted text-xs">Loading available menu dishes…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted text-xs">No matching dishes available.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto pr-1">
            {filtered.map((item) => {
              const qty = quantities[item.id] ?? 1;
              const isSubmitting = submittingId === item.id;
              const note = instructions[item.id] ?? '';

              return (
                <div
                  key={item.id}
                  data-testid={`menu-card-${item.id}`}
                  className="p-2.5 rounded-lg border border-line bg-surface hover:border-primary/50 transition flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            item.is_veg ? 'bg-success-fg' : 'bg-danger-fg'
                          }`}
                          title={item.is_veg ? 'Vegetarian' : 'Non-Vegetarian'}
                        />
                        <p className="font-semibold text-xs text-fg truncate">{item.name}</p>
                        {item.category?.name && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface-2 text-muted border border-line">
                            {item.category.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted">
                        <span>{item.stall?.name}</span>
                        <span>•</span>
                        <span className="text-success-fg font-medium">Available</span>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-fg shrink-0 tabular-nums">
                      ₹{Number(item.price).toFixed(2)}
                    </span>
                  </div>

                  {/* Special instruction / note */}
                  <div>
                    <input
                      type="text"
                      placeholder="Special instructions (optional)..."
                      value={note}
                      onChange={(e) =>
                        setInstructions((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="w-full px-2 py-1 rounded border border-line text-[11px] bg-surface-2 text-fg focus:outline-none focus:ring-1 focus:ring-focus placeholder:text-muted"
                    />
                  </div>

                  {/* Quantity selector and Add button */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-line/60">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        data-testid={`menu-qty-decrease-${item.id}`}
                        disabled={qty <= 1 || isSubmitting}
                        onClick={() => changeQty(item.id, -1)}
                        className="w-5 h-5 rounded flex items-center justify-center bg-surface-2 border border-line text-xs font-bold text-fg disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                      <span className="w-5 text-center text-xs font-bold tabular-nums text-fg">
                        {qty}
                      </span>
                      <button
                        type="button"
                        data-testid={`menu-qty-increase-${item.id}`}
                        disabled={isSubmitting}
                        onClick={() => changeQty(item.id, 1)}
                        className="w-5 h-5 rounded flex items-center justify-center bg-surface-2 border border-line text-xs font-bold text-fg disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      data-testid={`menu-add-btn-${item.id}`}
                      disabled={isSubmitting}
                      onClick={() => handleAddItem(item)}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-primary text-primary-fg hover:opacity-90 disabled:opacity-50 transition flex items-center gap-1 shadow-xs"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{isSubmitting ? 'Adding…' : 'Add Item'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};
