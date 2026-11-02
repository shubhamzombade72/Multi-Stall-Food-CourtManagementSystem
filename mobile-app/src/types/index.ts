export type UserRole = 'owner' | 'cashier' | 'waiter' | 'stall_manager' | 'kitchen_staff';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  stall_id: number | null;
  phone?: string;
  stall?: Stall;
}

export interface Stall {
  id: number;
  name: string;
  stall_number: string;
  description?: string;
  cuisine_type?: string;
  is_active: boolean;
}

export interface DiningTable {
  id: number;
  table_number: string;
  qr_token: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved';
}

export interface MenuItem {
  id: number;
  stall_id: number;
  category_id: number;
  name: string;
  description?: string | null;
  price: string;
  is_veg: boolean;
  is_available: boolean;
  preparation_time_minutes: number;
  stall?: Stall;
}

export interface OrderItemInput {
  menu_item_id: number;
  stall_id: number;
  name: string;
  quantity: number;
  unit_price: number;
  special_instructions?: string;
}

export interface StallTicketItem {
  id: number;
  kitchen_ticket_id: number;
  menu_item_id: number;
  item_name: string;
  quantity: number;
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
  special_instructions?: string | null;
  prepared_at?: string | null;
}

export interface StallKitchenTicket {
  id: number;
  order_id: number;
  stall_id: number;
  ticket_number: string;
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
  notes?: string | null;
  created_at: string;
  order?: {
    id: number;
    order_number: string;
    order_type: 'dine_in' | 'takeaway';
    table?: {
      id: number;
      table_number: string;
    };
  };
  items: StallTicketItem[];
  stall?: Stall;
}

export interface ReadyItemAlert {
  ticket_item_id: number;
  order_id: number;
  order_number: string;
  table_number?: string;
  stall_name: string;
  item_name: string;
  quantity: number;
  status: 'ready' | 'served';
  ready_at: string;
}

export interface OfflineQueuedOrder {
  id: string; // client UUID
  client_timestamp: number;
  order_type: 'dine_in' | 'takeaway';
  table_id: number | null;
  customer_name?: string;
  customer_phone?: string;
  notes?: string;
  items: {
    menu_item_id: number;
    quantity: number;
    special_instructions?: string;
    name: string;
    unit_price: number;
  }[];
  sync_status: 'pending' | 'syncing' | 'failed' | 'synced';
  error_message?: string;
}

