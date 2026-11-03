import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { AlertTriangle } from 'lucide-react';

export const InventoryPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [newStock, setNewStock] = useState<number>(0);
  const [reason, setReason] = useState<string>('');
  const [movementType, setMovementType] = useState<string>('manual_adjustment');
  const [lowOnly, setLowOnly] = useState(false);
  const [outItem, setOutItem] = useState<any | null>(null);
  const [outQty, setOutQty] = useState('');
  const [outType, setOutType] = useState('consumption');
  const [outReason, setOutReason] = useState('');
  const [movements, setMovements] = useState<any[]>([]);

  const fetchInventory = async () => {
    try {
      const [res, mv] = await Promise.all([
        apiClient.get('/inventory', { params: lowOnly ? { low_stock_only: 1 } : {} }),
        apiClient.get('/inventory/movements', { params: { per_page: 30 } }),
      ]);
      if (res.data.success) {
        setItems(res.data.data);
      }
      setMovements(mv.data.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [lowOnly]);

  const handleStockOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!outItem) return;
    try {
      await apiClient.post(`/inventory/${outItem.id}/stock-out`, { quantity: outQty, movement_type: outType, reason: outReason });
      setOutItem(null);
      setOutQty('');
      setOutReason('');
      fetchInventory();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to issue stock');
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    try {
      const res = await apiClient.post(`/inventory/${selectedItem.id}/adjust`, {
        new_stock: newStock,
        reason,
        movement_type: movementType,
      });

      if (res.data.success) {
        setSelectedItem(null);
        setReason('');
        fetchInventory();
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to adjust stock');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-fg tracking-tight">Stall-Wise Inventory & Raw Materials</h2>
          <p className="text-sm text-muted mt-1">Independent stock tracking and inward goods for each stall</p>
        </div>
        <label className="flex items-center space-x-2 text-sm font-semibold text-muted">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          <span>Low stock only</span>
        </label>
      </div>

      <div className="bg-surface rounded-lg border border-line overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas text-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="py-2 px-3">Ingredient / Item</th>
              <th className="py-2 px-3">Stall Owner</th>
              <th className="py-2 px-3">Current Stock</th>
              <th className="py-2 px-3">Unit Cost</th>
              <th className="py-2 px-3">Alert Level</th>
              <th className="py-2 px-3 text-right">Adjustment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((item) => {
              const isLow = Number(item.current_stock) <= Number(item.minimum_alert_stock);
              return (
                <tr key={item.id} className="hover:bg-surface-2 transition">
                  <td className="py-2 px-3 font-bold text-fg">{item.name}</td>
                  <td className="py-2 px-3 text-xs text-primary font-semibold">{item.stall?.name}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center space-x-2">
                      <span className="font-extrabold text-fg text-base">{Number(item.current_stock).toFixed(2)}</span>
                      <span className="text-xs text-muted font-medium uppercase">{item.unit}</span>
                      {isLow && (
                        <span className="p-1 bg-st-ready-soft text-st-ready-fg rounded-md" title="Low Stock Warning">
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3 font-semibold text-fg">₹{Number(item.unit_cost).toFixed(2)}</td>
                  <td className="py-2 px-3 text-xs text-muted">{item.minimum_alert_stock} {item.unit}</td>
                  <td className="py-2 px-3 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => {
                        setOutItem(item);
                        setOutReason('Issued to kitchen');
                      }}
                      className="px-3 py-1.5 rounded-lg border border-line hover:bg-surface-2 text-fg text-xs font-semibold transition"
                    >
                      Stock Out
                    </button>
                    <button
                      onClick={() => {
                        setSelectedItem(item);
                        setNewStock(Number(item.current_stock));
                        setReason('Routine physical audit update');
                      }}
                      className="px-3 py-1.5 rounded-lg border border-line hover:bg-surface-2 text-fg text-xs font-semibold transition"
                    >
                      Audit / Adjust
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-surface rounded-lg border border-line overflow-hidden shadow-sm">
        <div className="p-4 border-b border-line font-bold text-fg">Stock Movement Ledger (latest 30)</div>
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas text-muted text-xs uppercase">
            <tr>
              <th className="py-2 px-3">Time</th>
              <th className="py-2 px-3">Item</th>
              <th className="py-2 px-3">Stall</th>
              <th className="py-2 px-3">Type</th>
              <th className="py-2 px-3 text-right">Qty</th>
              <th className="py-2 px-3 text-right">Stock after</th>
              <th className="py-2 px-3">By / Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {movements.map((m) => (
              <tr key={m.id}>
                <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                <td className="py-2 px-3">{m.inventory_item?.name}</td>
                <td className="py-2 px-3 text-xs">{m.stall?.name}</td>
                <td className="py-2 px-3 text-xs font-semibold">{String(m.movement_type).replace(/_/g, ' ')}</td>
                <td className={`py-2 px-3 text-right font-bold ${Number(m.quantity) < 0 ? 'text-danger-fg' : 'text-success-fg'}`}>{Number(m.quantity)}</td>
                <td className="py-2 px-3 text-right">{Number(m.new_stock)}</td>
                <td className="py-2 px-3 text-xs text-muted">
                  {m.performed_by?.name} · {m.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {outItem && (
        <div className="fixed inset-0 !m-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleStockOut} className="bg-surface rounded-lg max-w-md w-full p-4 shadow-2xl space-y-3">
            <h3 className="font-semibold text-base text-fg">Stock Out: {outItem.name}</h3>
            <p className="text-xs text-muted">
              {outItem.stall?.name} · available {Number(outItem.current_stock)} {outItem.unit}
            </p>
            <input aria-label="Quantity" required type="number" min="0.001" step="0.001" value={outQty} onChange={(e) => setOutQty(e.target.value)} placeholder={`Quantity (${outItem.unit})`} className="w-full px-3 py-2 rounded-lg border border-line text-sm" />
            <select aria-label="Type" value={outType} onChange={(e) => setOutType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-line text-sm">
              <option value="consumption">Issued to kitchen (consumption)</option>
              <option value="waste_loss">Waste / spoilage</option>
            </select>
            <input aria-label="Reason" required value={outReason} onChange={(e) => setOutReason(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-line text-sm" />
            <div className="flex space-x-2 pt-2">
              <button type="button" onClick={() => setOutItem(null)} className="flex-1 py-2 text-xs font-bold text-muted rounded-lg border border-line">Cancel</button>
              <button type="submit" className="flex-1 py-2 text-xs font-bold text-primary-fg bg-primary hover:bg-primary/90 rounded-lg">Issue Stock</button>
            </div>
          </form>
        </div>
      )}

      {selectedItem && (
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleAdjustStock} className="bg-surface rounded-lg max-w-md w-full p-4 shadow-2xl space-y-4">
            <h3 className="font-semibold text-base text-fg">Adjust Stock: {selectedItem.name}</h3>
            <p className="text-xs text-muted font-semibold">{selectedItem.stall?.name}</p>

            <div>
              <label className="block text-xs font-semibold text-fg mb-1">
                New Quantity ({selectedItem.unit})
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={newStock}
                onChange={(e) => setNewStock(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-line text-sm font-bold text-fg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-fg mb-1">Adjustment Reason</label>
              <select
                value={movementType}
                onChange={(e) => setMovementType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-line text-sm mb-2"
              >
                <option value="manual_adjustment">Manual Physical Audit Count</option>
                <option value="waste_loss">Spillage / Waste / Kitchen Loss</option>
                <option value="consumption">Unrecorded Preparation Consumption</option>
              </select>
              <input
                type="text"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Audit notes or explanation..."
                className="w-full px-3 py-2 rounded-lg border border-line text-sm"
              />
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="flex-1 py-2 text-xs font-bold text-muted rounded-lg border border-line"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-bold text-primary-fg bg-primary hover:bg-primary/90 rounded-lg"
              >
                Save Adjustment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
