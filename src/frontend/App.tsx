import { FormEvent, useEffect, useState } from 'react';
import { connectServerEvents } from './api/events.js';
import { createBulkJob, getJob } from './api/jobsApi.js';
import { getAnomalies, getOrder, getStats, listOrders, patchOrder } from './api/ordersApi.js';
import { getSupplierDetail } from './api/suppliersApi.js';
import type {
  AnomalyDto,
  JobDto,
  OrderDto,
  OrderFilters,
  OrderPriority,
  OrdersStats,
  OrderStatus,
  ServerEventDto,
  SupplierDto,
  SupplierPerformanceDto,
} from './types/api.js';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-US');
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const statuses: OrderStatus[] = ['pending', 'approved', 'rejected', 'shipped', 'delivered', 'cancelled'];
const priorities: OrderPriority[] = ['low', 'medium', 'high', 'critical'];

type SupplierDetail = { supplier: SupplierDto; performance: SupplierPerformanceDto; orders: OrderDto[] };
type FeedEvent = ServerEventDto & { receivedAt: Date };

function describeEvent(event: ServerEventDto) {
  if (event.type === 'order_updated') return `Order ${event.data.id} changed from ${event.data.old_status} to ${event.data.new_status}`;
  if (event.type === 'bulk_completed') return `Bulk job ${event.data.jobId ?? event.data.job_id} completed`;
  if (event.type === 'ui_patch_success') return `UI saved ${event.data.id}: ${event.data.status} / ${event.data.priority}`;
  return event.type;
}

function useDashboard(query: { filters: OrderFilters; limit: number; offset: number; sort: string; order: 'asc' | 'desc' }, refreshKey: number) {
  const [orders, setOrders] = useState<{ data: OrderDto[]; total: number; limit: number; offset: number } | null>(null);
  const [stats, setStats] = useState<OrdersStats | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      getStats(controller.signal),
      getAnomalies(controller.signal),
      listOrders({ ...query.filters, limit: query.limit, offset: query.offset, sort: query.sort, order: query.order }, controller.signal),
    ])
      .then(([statsResult, anomaliesResult, ordersResult]) => {
        setStats(statsResult);
        setAnomalies(anomaliesResult.data);
        setOrders(ordersResult);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Dashboard failed to load');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query.filters, query.limit, query.offset, query.sort, query.order, refreshKey]);

  return { orders, setOrders, stats, anomalies, loading, error };
}

export function App() {
  const [filters, setFilters] = useState<OrderFilters>({});
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedOrder, setSelectedOrder] = useState<OrderDto | null>(null);
  const [supplierDetail, setSupplierDetail] = useState<SupplierDetail | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [realtime, setRealtime] = useState({ text: 'Connecting to live events…', connected: false });
  const [job, setJob] = useState<{ id: string; result: JobDto } | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const dashboard = useDashboard({ filters, limit, offset, sort, order }, refreshKey);

  const totalPages = Math.max(1, Math.ceil((dashboard.orders?.total ?? 0) / limit));
  const page = Math.floor(offset / limit) + 1;
  const maxStatus = Math.max(1, ...Object.values(dashboard.stats?.by_status ?? {}).map((item) => item.count));

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return connectServerEvents(
      (event) => {
        setEvents((current) => [{ ...event, receivedAt: new Date() }, ...current].slice(0, 8));
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => setRefreshKey((value) => value + 1), 400);
      },
      (text, connected) => setRealtime({ text, connected }),
    );
  }, []);

  async function selectOrder(orderId: string) {
    try {
      setSelectedOrder(await getOrder(orderId));
    } catch (err) {
      setUiError(err instanceof Error ? err.message : 'Order detail failed to load');
    }
  }

  async function updateOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrder) return;
    const form = new FormData(event.currentTarget);
    try {
      const updated = await patchOrder(selectedOrder.id, {
        status: form.get('status') as OrderStatus,
        priority: form.get('priority') as OrderPriority,
        version: selectedOrder.version,
      });
      setSelectedOrder(updated);
      dashboard.setOrders((current) => current ? { ...current, data: current.data.map((item) => item.id === updated.id ? { ...item, ...updated } : item) } : current);
      setEvents((current) => [{ type: 'ui_patch_success', data: { id: updated.id, status: updated.status, priority: updated.priority }, receivedAt: new Date() }, ...current].slice(0, 8));
    } catch (err) {
      setUiError(err instanceof Error ? err.message : 'Order update failed');
    }
  }

  async function selectSupplier(supplierId: string) {
    try {
      setSupplierDetail(await getSupplierDetail(supplierId));
    } catch (err) {
      setUiError(err instanceof Error ? err.message : 'Supplier detail failed to load');
    }
  }

  async function runBulk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const orderIds = [...selectedIds];
    if (orderIds.length === 0) return setUiError('Select at least one order before running a bulk action.');
    try {
      const created = await createBulkJob({ orderIds, action: String(form.get('action')), reason: String(form.get('reason') ?? '') });
      const jobId = created.jobId ?? created.job_id;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const result = await getJob(jobId);
        setJob({ id: jobId, result });
        if (result.status === 'completed' || result.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      setSelectedIds(new Set());
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setUiError(err instanceof Error ? err.message : 'Bulk action failed');
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFilters: OrderFilters = {};
    new FormData(event.currentTarget).forEach((value, key) => {
      if (String(value).length > 0) {
        nextFilters[key as keyof OrderFilters] = String(value);
      }
    });
    setFilters(nextFilters);
    setOffset(0);
  }

  return <main className="shell">
    <header className="hero"><div><p className="eyebrow">Procurement operations</p><h1>Reeco Dashboard</h1><p className="lede">Monitor order health, revenue, anomalies, and supplier activity from the assignment API.</p></div><button className="button" onClick={() => setRefreshKey((v) => v + 1)}>Refresh</button></header>
    {(uiError || dashboard.error) && <section className="error">{uiError ?? dashboard.error}</section>}
    <section className="cards"><article className="card"><span>Total orders</span><strong>{number.format(dashboard.stats?.total_orders ?? 0)}</strong></article><article className="card"><span>Total revenue</span><strong>{currency.format(dashboard.stats?.total_revenue ?? 0)}</strong></article><article className="card"><span>Average order</span><strong>{currency.format(dashboard.stats?.avg_order_value ?? 0)}</strong></article><article className="card"><span>Anomalies flagged</span><strong>{number.format(dashboard.anomalies.length)}</strong></article></section>
    <section className="grid two-column"><article className="panel"><h2>Status mix</h2><div className="status-list">{Object.entries(dashboard.stats?.by_status ?? {}).map(([key, item]) => <div className="status-row" key={key}><span className={`pill ${key}`}>{key}</span><div className="bar"><span style={{ width: `${(item.count / maxStatus) * 100}%` }} /></div><strong>{number.format(item.count)}</strong></div>)}</div></article><article className="panel"><h2>Top suppliers</h2><ol className="supplier-list">{dashboard.stats?.top_suppliers.map((s) => <li key={s.supplier_id}><button className="supplier-button" onClick={() => selectSupplier(s.supplier_id)}><strong>{s.supplier_name}</strong><br /><span className="muted">{s.supplier_id} · {currency.format(s.total_revenue)}</span></button></li>)}</ol></article></section>
    <section className="panel"><div className="panel-header split"><div><h2>Orders</h2><p>Filter by status, priority, supplier, warehouse, or product search.</p></div><div className={`realtime-status ${realtime.connected ? 'connected' : ''}`}>{realtime.text}</div></div><form className="filters" onSubmit={applyFilters}><label>Status<select name="status"><option value="">Any</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select></label><label>Priority<select name="priority"><option value="">Any</option>{priorities.map((p) => <option key={p}>{p}</option>)}</select></label><label>Supplier ID<input name="supplier_id" placeholder="sup_042" /></label><label>Warehouse<input name="warehouse" placeholder="warehouse_east" /></label><label>From<input name="date_from" type="date" /></label><label>To<input name="date_to" type="date" /></label><label className="grow">Product search<input name="search" placeholder="hydraulic" /></label><button className="button">Apply</button><button className="button secondary" type="button" onClick={() => { setFilters({}); setOffset(0); }}>Clear</button></form>
      <div className="table-controls"><label>Sort by<select value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }}><option value="created_at">Created date</option><option value="updated_at">Updated date</option><option value="total_price">Total price</option><option value="status">Status</option><option value="priority">Priority</option><option value="warehouse">Warehouse</option></select></label><label>Direction<select value={order} onChange={(e) => { setOrder(e.target.value as 'asc' | 'desc'); setOffset(0); }}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label><label>Page size<select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }}><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label><div className="pagination"><button className="button secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</button><span className="muted">Page {page} of {number.format(totalPages)}</span><button className="button secondary" disabled={offset + limit >= (dashboard.orders?.total ?? 0)} onClick={() => setOffset(offset + limit)}>Next</button></div></div>
      <form className="bulk-actions" onSubmit={runBulk}><strong>{number.format(selectedIds.size)} selected</strong><label>Bulk action<select name="action"><option value="approve">Approve</option><option value="reject">Reject</option><option value="flag">Flag</option></select></label><label className="grow">Reason<input name="reason" placeholder="Optional note for this bulk action" /></label><button className="button">Run bulk action</button><button className="button secondary" type="button" onClick={() => setSelectedIds(new Set())}>Clear selection</button></form>
      {job && <div className={`bulk-status ${job.result.status}`}>Job {job.id}: {job.result.status}. Completed {number.format(job.result.progress.completed)} / {number.format(job.result.progress.total)}, failed {number.format(job.result.progress.failed)}.</div>}
      <div className="table-wrap"><table><thead><tr><th>Select</th><th>Order</th><th>Supplier</th><th>Product</th><th>Status</th><th>Priority</th><th>Total</th><th>Warehouse</th><th>Updated</th></tr></thead><tbody>{dashboard.loading ? <tr><td colSpan={9}>Loading orders…</td></tr> : dashboard.orders?.data.length ? dashboard.orders.data.map((item) => <tr key={item.id} className={selectedOrder?.id === item.id ? 'selected' : ''} onClick={() => selectOrder(item.id)}><td><input type="checkbox" checked={selectedIds.has(item.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSelectedIds((current) => { const next = new Set(current); e.target.checked ? next.add(item.id) : next.delete(item.id); return next; })} /></td><td><strong>{item.id}</strong></td><td>{item.supplier_id}</td><td>{item.product_name ?? item.product_id}</td><td><span className={`pill ${item.status}`}>{item.status}</span></td><td>{item.priority}</td><td>{currency.format(item.total_price)}</td><td>{item.warehouse || 'unassigned'}</td><td>{date.format(new Date(item.updated_at))}</td></tr>) : <tr><td colSpan={9}>No matching orders.</td></tr>}</tbody></table></div><p className="muted">Showing {dashboard.orders?.data.length ?? 0} of {number.format(dashboard.orders?.total ?? 0)} matching orders.</p></section>
    <section className="grid two-column detail-grid"><article className="panel"><h2>Order detail</h2>{selectedOrder ? <><div className="detail-list"><div className="detail-row"><span>Order</span><strong>{selectedOrder.id}</strong></div><div className="detail-row"><span>Supplier</span><span>{selectedOrder.supplier_id} {selectedOrder.supplier_name ? `· ${selectedOrder.supplier_name}` : ''}</span></div><div className="detail-row"><span>Product</span><span>{selectedOrder.product_name ?? selectedOrder.product_id}</span></div><div className="detail-row"><span>Total</span><span>{currency.format(selectedOrder.total_price)}</span></div><div className="detail-row"><span>Version</span><span>{selectedOrder.version}</span></div><div className="detail-row"><span>Notes</span><span>{selectedOrder.notes || '—'}</span></div></div><form className="update-form" onSubmit={updateOrder}><label>Status<select name="status" defaultValue={selectedOrder.status}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></label><label>Priority<select name="priority" defaultValue={selectedOrder.priority}>{priorities.map((p) => <option key={p}>{p}</option>)}</select></label><button className="button">Update order</button></form></> : <div className="detail-empty">No order selected yet.</div>}</article><article className="panel"><h2>Realtime activity</h2><ul className="event-feed">{events.length ? events.map((item, index) => <li key={index}><strong>{describeEvent(item)}</strong><time>{item.receivedAt.toLocaleTimeString()}</time></li>) : <li className="muted">Waiting for live events…</li>}</ul></article></section>
    <section className="panel"><h2>Supplier detail</h2>{supplierDetail ? <><div className="detail-list"><div className="detail-row"><span>Supplier</span><strong>{supplierDetail.supplier.name}</strong></div><div className="detail-row"><span>ID</span><span>{supplierDetail.supplier.id}</span></div><div className="detail-row"><span>Email</span><span>{supplierDetail.supplier.email || '—'}</span></div><div className="detail-row"><span>Country</span><span>{supplierDetail.supplier.country || '—'}</span></div></div><div className="metric-grid"><div className="metric"><span>Avg delivery</span><strong>{Number(supplierDetail.performance.avg_delivery_days).toFixed(1)} days</strong></div><div className="metric"><span>Rejection rate</span><strong>{(Number(supplierDetail.performance.rejection_rate) * 100).toFixed(1)}%</strong></div><div className="metric"><span>Avg order</span><strong>{currency.format(supplierDetail.performance.avg_order_value)}</strong></div><div className="metric"><span>Price consistency</span><strong>{(Number(supplierDetail.performance.price_consistency) * 100).toFixed(1)}%</strong></div></div><h3>Recent supplier orders</h3><div className="table-wrap"><table><tbody>{supplierDetail.orders.map((item) => <tr key={item.id} onClick={() => selectOrder(item.id)}><td><strong>{item.id}</strong></td><td><span className={`pill ${item.status}`}>{item.status}</span></td><td>{item.priority}</td><td>{currency.format(item.total_price)}</td><td>{date.format(new Date(item.created_at))}</td></tr>)}</tbody></table></div></> : <div className="detail-empty">No supplier selected yet.</div>}</section>
  </main>;
}