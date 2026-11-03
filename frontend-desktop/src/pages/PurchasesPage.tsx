import React, { useEffect, useState } from 'react';
import { statusChip } from '../lib/status';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { SuppliersPanel } from '../components/SuppliersPanel';
import {
  Truck,
  Plus,
  Building,
  Loader2,
} from 'lucide-react';

export const PurchasesPage: React.FC = () => {
  const { user, isOwner } = useAuth();
  const [activeTab, setActiveTab] = useState<'orders' | 'suppliers'>('orders');

  // Data states
  const [purchases, setPurchases] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [stalls, setStalls] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [supplierVersion, setSupplierVersion] = useState(0);

  // Modals
  const [showPoModal, setShowPoModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [isReceivingId, setIsReceivingId] = useState<number | null>(null);

  // New PO Form State
  const [poStallId, setPoStallId] = useState<number | ''>('');
  const [poSupplierId, setPoSupplierId] = useState<number | ''>('');
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [poNotes, setPoNotes] = useState('');
  const [poItems, setPoItems] = useState<
    { inventory_item_id: number; quantity: number; unit_price: number }[]
  >([]);

  // New Supplier Form State
  const [supStallId, setSupStallId] = useState<number | ''>('');
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supAddress, setSupAddress] = useState('');

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      const [poRes, supRes, stallsRes, invRes] = await Promise.all([
        apiClient.get('/purchases'),
        apiClient.get('/suppliers'),
        apiClient.get('/stalls'),
        apiClient.get('/inventory'),
      ]);

      setPurchases(poRes.data.data.data || poRes.data.data || []);
      setSuppliers(supRes.data.data || []);
      setStalls(stallsRes.data.data || []);
      setInventoryItems(invRes.data.data || []);

      if (stallsRes.data.data.length > 0) {
        const defaultStall = user?.stall_id || stallsRes.data.data[0].id;
        setPoStallId(defaultStall);
        setSupStallId(defaultStall);
      }
    } catch (err) {
      console.error('Failed to load purchases data', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddPoItemRow = () => {
    const availableItems = inventoryItems.filter(
      (it) => poStallId === '' || it.stall_id === Number(poStallId)
    );
    if (availableItems.length === 0) {
      alert('No raw materials found for this stall. Add items in Stall Inventory first.');
      return;
    }
    const defaultItem = availableItems[0];
    setPoItems((prev) => [
      ...prev,
      {
        inventory_item_id: defaultItem.id,
        quantity: 10,
        unit_price: Number(defaultItem.unit_cost) || 100,
      },
    ]);
  };

  const handleRemovePoItemRow = (index: number) => {
    setPoItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poStallId || !poSupplierId) {
      alert('Please select both stall and supplier');
      return;
    }
    if (poItems.length === 0) {
      alert('Please add at least one inventory item to the purchase order');
      return;
    }

    try {
      const res = await apiClient.post('/purchases', {
        stall_id: poStallId,
        supplier_id: poSupplierId,
        order_date: poDate,
        notes: poNotes,
        items: poItems,
      });

      if (res.data.success) {
        alert('Purchase Order created successfully!');
        setShowPoModal(false);
        setPoNotes('');
        setPoItems([]);
        fetchInitialData();
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to create purchase order');
    }
  };

  const handleReceivePo = async (poId: number) => {
    if (!confirm('Confirm goods delivery receipt? This will automatically update inventory stock and generate stock movement audit entries.')) {
      return;
    }

    setIsReceivingId(poId);
    try {
      const res = await apiClient.post(`/purchases/${poId}/receive`);
      if (res.data.success) {
        alert('Goods received! Inventory stock successfully updated.');
        fetchInitialData();
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to receive purchase order');
    } finally {
      setIsReceivingId(null);
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supStallId || !supName) {
      alert('Stall and Supplier name are required');
      return;
    }

    try {
      const res = await apiClient.post('/suppliers', {
        stall_id: supStallId,
        name: supName,
        contact_person: supContact,
        phone: supPhone,
        email: supEmail,
        address: supAddress,
      });

      if (res.data.success) {
        alert('Supplier added successfully!');
        setShowSupplierModal(false);
        setSupName('');
        setSupContact('');
        setSupPhone('');
        setSupEmail('');
        setSupAddress('');
        setSupplierVersion((v) => v + 1);
        fetchInitialData();
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to add supplier');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-fg tracking-tight">
            Procurement & Supplier Management
          </h2>
          <p className="text-sm text-muted mt-1">
            Independent purchase orders, supplier directories, and stock receipt for stalls
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {activeTab === 'orders' ? (
            <button
              onClick={() => {
                setShowPoModal(true);
                if (poItems.length === 0) handleAddPoItemRow();
              }}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-fg font-bold text-xs rounded-lg shadow-sm transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>New Purchase Order</span>
            </button>
          ) : (
            <button
              onClick={() => setShowSupplierModal(true)}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-fg font-bold text-xs rounded-lg shadow-sm transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Supplier</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center space-x-2 border-b border-line pb-3">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center space-x-2 ${
            activeTab === 'orders'
              ? 'bg-primary text-primary-fg shadow-sm'
              : 'text-muted hover:text-fg hover:bg-surface-2'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>Purchase Orders ({purchases.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('suppliers')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center space-x-2 ${
            activeTab === 'suppliers'
              ? 'bg-primary text-primary-fg shadow-sm'
              : 'text-muted hover:text-fg hover:bg-surface-2'
          }`}
        >
          <Building className="w-4 h-4" />
          <span>Suppliers Directory ({suppliers.length})</span>
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-16 text-muted">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* TAB 1: PURCHASE ORDERS */}
          {activeTab === 'orders' && (
        <div className="bg-surface rounded-lg border border-line overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="py-2 px-3">PO Number</th>
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Stall</th>
                <th className="py-2 px-3">Supplier</th>
                <th className="py-2 px-3">Items Ordered</th>
                <th className="py-2 px-3">Total Amount</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted text-xs">
                    No purchase orders recorded. Click "New Purchase Order" to procure inventory.
                  </td>
                </tr>
              ) : (
                purchases.map((po) => (
                  <tr key={po.id} className="hover:bg-surface-2 transition">
                    <td className="py-2 px-3 font-mono font-bold text-fg text-xs">
                      #{po.purchase_number}
                    </td>
                    <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">{po.order_date}</td>
                    <td className="py-2 px-3 text-xs font-bold text-fg">
                      {po.stall?.name}
                    </td>
                    <td className="py-2 px-3 text-xs text-muted">
                      {po.supplier?.name || 'Standard Supplier'}
                    </td>
                    <td className="py-2 px-3 text-xs text-muted">
                      {po.items?.length || 0} materials
                    </td>
                    <td className="py-2 px-3 font-bold text-fg text-xs">
                      ₹{Number(po.total_amount).toFixed(2)}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-bold uppercase ${statusChip(po.status)}`}
                      >
                        {po.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {po.status === 'ordered' && (
                        <button
                          onClick={() => handleReceivePo(po.id)}
                          disabled={isReceivingId === po.id}
                          className="px-3 py-1.5 bg-success-fg hover:opacity-90 text-surface rounded-lg text-xs font-bold transition shadow-sm disabled:opacity-50"
                        >
                          {isReceivingId === po.id ? 'Receiving...' : 'Receive Stock ✓'}
                        </button>
                      )}
                      {po.status === 'received' && (
                        <span className="text-xs text-success-fg font-bold">In Stock ✓</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 2: SUPPLIERS DIRECTORY */}
      {activeTab === 'suppliers' && (
        <SuppliersPanel
          stalls={isOwner ? stalls : stalls.filter((s) => s.id === user?.stall_id)}
          version={supplierVersion}
          canManage={isOwner || user?.role === 'stall_manager'}
        />
      )}
        </>
      )}

      {/* CREATE PO MODAL */}
      {showPoModal && (
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg max-w-lg w-full p-4 shadow-2xl border border-line space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-semibold text-base text-fg">New Purchase Order</h3>
              <button
                onClick={() => setShowPoModal(false)}
                className="text-muted hover:text-fg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePo} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {isOwner && (
                  <div>
                    <label className="block text-xs font-bold text-fg mb-1">Stall</label>
                    <select
                      value={poStallId}
                      onChange={(e) => setPoStallId(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-line rounded-lg text-xs font-medium"
                      required
                    >
                      {stalls.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={!isOwner ? 'col-span-2' : ''}>
                  <label className="block text-xs font-bold text-fg mb-1">Supplier</label>
                  <select
                    value={poSupplierId}
                    onChange={(e) => setPoSupplierId(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-line rounded-lg text-xs font-medium"
                    required
                  >
                    <option value="">Select Vendor</option>
                    {suppliers
                      .filter((s) => !poStallId || s.stall_id === Number(poStallId))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-fg mb-1">Order Date</label>
                <input
                  type="date"
                  value={poDate}
                  onChange={(e) => setPoDate(e.target.value)}
                  className="w-full px-3 py-2 border border-line rounded-lg text-xs font-medium"
                  required
                />
              </div>

              {/* Items Line Items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-fg">Order Materials</label>
                  <button
                    type="button"
                    onClick={handleAddPoItemRow}
                    className="text-xs font-bold text-primary hover:text-primary/80"
                  >
                    + Add Item
                  </button>
                </div>

                {poItems.map((row, idx) => (
                  <div key={idx} className="flex items-center space-x-2 bg-canvas p-2.5 rounded-lg border border-line">
                    <select
                      value={row.inventory_item_id}
                      onChange={(e) => {
                        const newId = Number(e.target.value);
                        const inv = inventoryItems.find((i) => i.id === newId);
                        setPoItems((prev) =>
                          prev.map((r, i) =>
                            i === idx
                              ? {
                                  ...r,
                                  inventory_item_id: newId,
                                  unit_price: Number(inv?.unit_cost) || r.unit_price,
                                }
                              : r
                          )
                        );
                      }}
                      className="flex-1 px-2 py-1.5 border border-line rounded-lg text-xs"
                    >
                      {inventoryItems
                        .filter((i) => !poStallId || i.stall_id === Number(poStallId))
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({i.unit})
                          </option>
                        ))}
                    </select>

                    <input
                      type="number"
                      step="0.01"
                      min="0.1"
                      value={row.quantity}
                      onChange={(e) =>
                        setPoItems((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, quantity: Number(e.target.value) } : r
                          )
                        )
                      }
                      placeholder="Qty"
                      className="w-20 px-2 py-1.5 border border-line rounded-lg text-xs font-bold"
                    />

                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={row.unit_price}
                      onChange={(e) =>
                        setPoItems((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, unit_price: Number(e.target.value) } : r
                          )
                        )
                      }
                      placeholder="Rate ₹"
                      className="w-24 px-2 py-1.5 border border-line rounded-lg text-xs font-bold"
                    />

                    <button
                      type="button"
                      onClick={() => handleRemovePoItemRow(idx)}
                      className="text-muted hover:text-danger-fg px-1 font-bold text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-bold text-fg mb-1">Notes</label>
                <input
                  type="text"
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                  placeholder="Optional delivery or vendor reference"
                  className="w-full px-3 py-2 border border-line rounded-lg text-xs"
                />
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPoModal(false)}
                  className="flex-1 py-2 rounded-lg border border-line text-xs font-semibold text-muted hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-fg text-xs font-bold shadow-md shadow-primary/20"
                >
                  Create Purchase Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE SUPPLIER MODAL */}
      {showSupplierModal && (
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg max-w-md w-full p-4 shadow-2xl border border-line space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-semibold text-base text-fg">Register Vendor / Supplier</h3>
              <button
                onClick={() => setShowSupplierModal(false)}
                className="text-muted hover:text-fg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSupplier} className="space-y-3">
              {isOwner && (
                <div>
                  <label className="block text-xs font-bold text-fg mb-1">Stall</label>
                  <select
                    value={supStallId}
                    onChange={(e) => setSupStallId(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-line rounded-lg text-xs font-medium"
                    required
                  >
                    {stalls.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-fg mb-1">Company / Vendor Name</label>
                <input
                  type="text"
                  required
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  placeholder="e.g. Metro Wholesale Foods"
                  className="w-full px-3 py-2 border border-line rounded-lg text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-fg mb-1">Contact Person</label>
                <input
                  type="text"
                  value={supContact}
                  onChange={(e) => setSupContact(e.target.value)}
                  placeholder="e.g. Rajesh Kumar"
                  className="w-full px-3 py-2 border border-line rounded-lg text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-fg mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full px-3 py-2 border border-line rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-fg mb-1">Email</label>
                  <input
                    type="email"
                    value={supEmail}
                    onChange={(e) => setSupEmail(e.target.value)}
                    placeholder="vendor@email.com"
                    className="w-full px-3 py-2 border border-line rounded-lg text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-fg mb-1">Address</label>
                <input
                  type="text"
                  value={supAddress}
                  onChange={(e) => setSupAddress(e.target.value)}
                  placeholder="Warehouse / Market location"
                  className="w-full px-3 py-2 border border-line rounded-lg text-xs"
                />
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="flex-1 py-2 rounded-lg border border-line text-xs font-semibold text-muted hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-fg text-xs font-bold shadow-md shadow-primary/20"
                >
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
