export const ORDER_STATUSES = ['pending', 'approved', 'rejected', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export type SortDirection = 'asc' | 'desc';

export interface OrderDto {
  id: string;
  supplier_id: string;
  supplier_name?: string | null;
  product_id: string;
  product_name?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  status: OrderStatus;
  priority: OrderPriority;
  created_at: string;
  updated_at: string;
  warehouse: string | null;
  notes: string | null;
  flagged?: boolean;
  version: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface OrderFilters {
  status?: string;
  priority?: string;
  supplier_id?: string;
  warehouse?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}

export interface OrdersQuery extends OrderFilters {
  limit: number;
  offset: number;
  sort: string;
  order: SortDirection;
}

export interface OrdersStats {
  total_orders: number;
  total_revenue: number;
  avg_order_value: number;
  by_status: Record<string, { count: number; total_value: number }>;
  top_suppliers: Array<{ supplier_id: string; supplier_name: string; total_revenue: number }>;
}

export interface AnomalyDto {
  order_id: string;
  anomaly_types: string[];
  severity: 'low' | 'medium' | 'high';
}

export interface SupplierDto {
  id: string;
  name: string;
  email: string | null;
  rating: number | null;
  country: string | null;
  active: boolean;
  order_count?: number;
  total_revenue?: number;
}

export interface SupplierPerformanceDto {
  avg_delivery_days: number;
  rejection_rate: number;
  avg_order_value: number;
  price_consistency: number;
}

export interface JobDto {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: { total: number; completed: number; failed: number };
}

export interface ServerEventDto {
  type: string;
  data: Record<string, unknown>;
}