const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-US');
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

const state = {
  filters: {},
  orders: [],
  ordersTotal: 0,
  limit: 25,
  offset: 0,
  sort: 'created_at',
  order: 'desc',
  selectedOrderId: null,
  selectedSupplierId: null,
  selectedOrderIds: new Set(),
  activeJobId: null,
  events: [],
};

const statuses = ['pending', 'approved', 'rejected', 'shipped', 'delivered', 'cancelled'];
const priorities = ['low', 'medium', 'high', 'critical'];

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function getJson(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }
  return response.json();
}

async function patchJson(path, body) {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `${path} failed with ${response.status}`);
  }
  return payload;
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `${path} failed with ${response.status}`);
  }
  return payload;
}

function showError(error) {
  const banner = $('errorBanner');
  banner.textContent = error instanceof Error ? error.message : 'Unexpected UI error';
  banner.hidden = false;
}

function clearError() {
  $('errorBanner').hidden = true;
}

function renderStats(stats, anomalies) {
  $('totalOrders').textContent = number.format(stats.total_orders);
  $('totalRevenue').textContent = currency.format(stats.total_revenue);
  $('avgOrderValue').textContent = currency.format(stats.avg_order_value);
  $('anomalyCount').textContent = number.format(anomalies.data.length);

  const maxStatus = Math.max(...Object.values(stats.by_status).map((item) => item.count));
  $('statusMix').innerHTML = Object.entries(stats.by_status)
    .map(([status, item]) => `
      <div class="status-row">
        <span class="pill ${escapeHtml(status)}">${escapeHtml(status)}</span>
        <div class="bar" aria-label="${escapeHtml(status)} ${item.count}"><span style="width: ${(item.count / maxStatus) * 100}%"></span></div>
        <strong>${number.format(item.count)}</strong>
      </div>
    `)
    .join('');

  $('topSuppliers').innerHTML = stats.top_suppliers
    .map((supplier) => `
      <li>
        <button class="supplier-button" type="button" data-supplier-id="${escapeHtml(supplier.supplier_id)}">
          <strong>${escapeHtml(supplier.supplier_name)}</strong><br>
          <span class="muted">${escapeHtml(supplier.supplier_id)} · ${currency.format(supplier.total_revenue)}</span>
        </button>
      </li>
    `)
    .join('');
}

function percent(value) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function ordersQuery() {
  const params = new URLSearchParams({
    limit: String(state.limit),
    offset: String(state.offset),
    sort: state.sort,
    order: state.order,
  });
  for (const [key, value] of Object.entries(state.filters)) {
    if (value) params.set(key, value);
  }
  return `/api/orders?${params.toString()}`;
}

function renderOrders(result) {
  state.orders = result.data;
  state.ordersTotal = result.total;
  $('ordersBody').innerHTML = result.data
    .map((order) => `
      <tr data-order-id="${escapeHtml(order.id)}" class="${order.id === state.selectedOrderId ? 'selected' : ''}">
        <td><input type="checkbox" class="order-select" data-order-id="${escapeHtml(order.id)}" ${state.selectedOrderIds.has(order.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(order.id)}" /></td>
        <td><strong>${escapeHtml(order.id)}</strong></td>
        <td>${escapeHtml(order.supplier_id)}</td>
        <td>${escapeHtml(order.product_name ?? order.product_id)}</td>
        <td><span class="pill ${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></td>
        <td>${escapeHtml(order.priority)}</td>
        <td>${currency.format(order.total_price)}</td>
        <td>${escapeHtml(order.warehouse || 'unassigned')}</td>
        <td>${date.format(new Date(order.updated_at))}</td>
      </tr>
    `)
    .join('');
  $('ordersMeta').textContent = `Showing ${result.data.length} of ${number.format(state.ordersTotal)} matching orders.`;
  const page = Math.floor(state.offset / state.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(state.ordersTotal / state.limit));
  $('pageInfo').textContent = `Page ${page} of ${number.format(totalPages)}`;
  $('prevPageButton').disabled = state.offset === 0;
  $('nextPageButton').disabled = state.offset + state.limit >= state.ordersTotal;
  renderSelectedCount();
}

function renderSelectedCount() {
  $('selectedCount').textContent = `${number.format(state.selectedOrderIds.size)} selected`;
}

function optionList(values, selected) {
  return values.map((value) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value}</option>`).join('');
}

function renderOrderDetail(order, message = '') {
  if (!order) {
    $('orderDetail').className = 'detail-empty';
    $('orderDetail').textContent = 'No order selected yet.';
    return;
  }

  $('orderDetail').className = '';
  $('orderDetail').innerHTML = `
    <div class="detail-list">
      <div class="detail-row"><span>Order</span><strong>${escapeHtml(order.id)}</strong></div>
      <div class="detail-row"><span>Supplier</span><span>${escapeHtml(order.supplier_id)} ${order.supplier_name ? `· ${escapeHtml(order.supplier_name)}` : ''}</span></div>
      <div class="detail-row"><span>Product</span><span>${escapeHtml(order.product_name ?? order.product_id)}</span></div>
      <div class="detail-row"><span>Total</span><span>${currency.format(order.total_price)}</span></div>
      <div class="detail-row"><span>Quantity</span><span>${number.format(order.quantity)} @ ${currency.format(order.unit_price)}</span></div>
      <div class="detail-row"><span>Warehouse</span><span>${escapeHtml(order.warehouse || 'unassigned')}</span></div>
      <div class="detail-row"><span>Updated</span><span>${date.format(new Date(order.updated_at))}</span></div>
      <div class="detail-row"><span>Notes</span><span>${escapeHtml(order.notes || '—')}</span></div>
    </div>
    <form id="updateOrderForm" class="update-form">
      <label>Status<select name="status">${optionList(statuses, order.status)}</select></label>
      <label>Priority<select name="priority">${optionList(priorities, order.priority)}</select></label>
      <button class="button" type="submit">Update order</button>
      <button class="button secondary" type="button" id="reloadOrderButton">Reload detail</button>
    </form>
    ${message ? `<div class="success">${escapeHtml(message)}</div>` : ''}
  `;

  $('updateOrderForm').addEventListener('submit', updateSelectedOrder);
  $('reloadOrderButton').addEventListener('click', () => selectOrder(order.id));
}

async function selectOrder(orderId) {
  state.selectedOrderId = orderId;
  renderOrders({ data: state.orders, total: state.ordersTotal });
  try {
    const order = await getJson(`/api/orders/${encodeURIComponent(orderId)}`);
    renderOrderDetail(order);
  } catch (error) {
    showError(error);
  }
}

async function updateSelectedOrder(event) {
  event.preventDefault();
  if (!state.selectedOrderId) return;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const form = new FormData(event.currentTarget);
    const updated = await patchJson(`/api/orders/${encodeURIComponent(state.selectedOrderId)}`, {
      status: form.get('status'),
      priority: form.get('priority'),
    });
    state.orders = state.orders.map((order) => (order.id === updated.id ? { ...order, ...updated } : order));
    renderOrders({ data: state.orders, total: state.ordersTotal });
    renderOrderDetail(updated, 'Order updated successfully. Live event should appear in the activity feed.');
    addEventFeedItem({ type: 'ui_patch_success', data: { id: updated.id, status: updated.status, priority: updated.priority } });
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
}

function setBulkStatus(status, message) {
  const element = $('bulkStatus');
  element.hidden = false;
  element.className = `bulk-status ${status}`;
  element.textContent = message;
}

async function runBulkAction(event) {
  event.preventDefault();
  if (state.selectedOrderIds.size === 0) {
    setBulkStatus('failed', 'Select at least one order before running a bulk action.');
    return;
  }

  const form = new FormData(event.currentTarget);
  const action = form.get('action');
  const reason = form.get('reason');
  const orderIds = Array.from(state.selectedOrderIds);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const response = await postJson('/api/orders/bulk-action', { orderIds, action, reason });
    state.activeJobId = response.jobId || response.job_id;
    setBulkStatus('processing', `Bulk job ${state.activeJobId} queued for ${number.format(orderIds.length)} orders.`);
    pollJob(state.activeJobId, submitButton);
  } catch (error) {
    submitButton.disabled = false;
    showError(error);
    setBulkStatus('failed', error instanceof Error ? error.message : 'Bulk action failed.');
  }
}

async function pollJob(jobId, submitButton) {
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const job = await getJson(`/api/jobs/${encodeURIComponent(jobId)}`);
      const progress = job.progress || { total: 0, completed: 0, failed: 0 };
      setBulkStatus(
        job.status,
        `Job ${jobId}: ${job.status}. Completed ${number.format(progress.completed)} / ${number.format(progress.total)}, failed ${number.format(progress.failed)}.`,
      );
      if (job.status === 'completed' || job.status === 'failed') {
        state.selectedOrderIds.clear();
        renderSelectedCount();
        submitButton.disabled = false;
        loadDashboard();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setBulkStatus('processing', `Job ${jobId} is still processing. Use Refresh to update the table.`);
  } catch (error) {
    showError(error);
    setBulkStatus('failed', error instanceof Error ? error.message : 'Could not poll bulk job.');
  } finally {
    submitButton.disabled = false;
  }
}

async function selectSupplier(supplierId) {
  state.selectedSupplierId = supplierId;
  $('supplierDetail').className = 'detail-empty';
  $('supplierDetail').textContent = `Loading ${supplierId}…`;

  try {
    const [supplier, performance, orders] = await Promise.all([
      getJson(`/api/suppliers/${encodeURIComponent(supplierId)}`),
      getJson(`/api/suppliers/${encodeURIComponent(supplierId)}/performance`),
      getJson(`/api/orders?supplier_id=${encodeURIComponent(supplierId)}&limit=10&sort=created_at&order=desc`),
    ]);
    renderSupplierDetail(supplier, performance, orders.data);
  } catch (error) {
    showError(error);
    $('supplierDetail').className = 'detail-empty';
    $('supplierDetail').textContent = 'Supplier details could not be loaded.';
  }
}

function renderSupplierDetail(supplier, performance, orders) {
  $('supplierDetail').className = '';
  $('supplierDetail').innerHTML = `
    <div class="detail-list">
      <div class="detail-row"><span>Supplier</span><strong>${escapeHtml(supplier.name)}</strong></div>
      <div class="detail-row"><span>ID</span><span>${escapeHtml(supplier.id)}</span></div>
      <div class="detail-row"><span>Email</span><span>${escapeHtml(supplier.email || '—')}</span></div>
      <div class="detail-row"><span>Country</span><span>${escapeHtml(supplier.country || '—')}</span></div>
      <div class="detail-row"><span>Status</span><span>${supplier.active ? 'Active' : 'Inactive'} · rating ${escapeHtml(supplier.rating || '—')}</span></div>
      <div class="detail-row"><span>Revenue</span><span>${currency.format(Number(supplier.total_revenue || 0))} across ${number.format(Number(supplier.order_count || 0))} orders</span></div>
    </div>
    <div class="metric-grid" aria-label="Supplier performance metrics">
      <div class="metric"><span>Avg delivery</span><strong>${Number(performance.avg_delivery_days).toFixed(1)} days</strong></div>
      <div class="metric"><span>Rejection rate</span><strong>${percent(performance.rejection_rate)}</strong></div>
      <div class="metric"><span>Avg order</span><strong>${currency.format(performance.avg_order_value)}</strong></div>
      <div class="metric"><span>Price consistency</span><strong>${percent(performance.price_consistency)}</strong></div>
    </div>
    <h3>Recent supplier orders</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Order</th><th>Status</th><th>Priority</th><th>Total</th><th>Created</th></tr></thead>
        <tbody>
          ${orders.map((order) => `
            <tr data-order-id="${escapeHtml(order.id)}">
              <td><strong>${escapeHtml(order.id)}</strong></td>
              <td><span class="pill ${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></td>
              <td>${escapeHtml(order.priority)}</td>
              <td>${currency.format(order.total_price)}</td>
              <td>${date.format(new Date(order.created_at))}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" class="muted">No recent orders found.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function loadDashboard() {
  clearError();
  try {
    const [stats, anomalies, orders] = await Promise.all([
      getJson('/api/orders/stats'),
      getJson('/api/orders/anomalies'),
      getJson(ordersQuery()),
    ]);
    renderStats(stats, anomalies);
    renderOrders(orders);
    if (state.selectedOrderId) {
      const stillVisible = orders.data.some((order) => order.id === state.selectedOrderId);
      if (!stillVisible) renderOrderDetail(null);
    }
  } catch (error) {
    showError(error);
  }
}

$('filtersForm').addEventListener('submit', (event) => {
  event.preventDefault();
  state.filters = Object.fromEntries(new FormData(event.currentTarget).entries());
  state.offset = 0;
  loadDashboard();
});

$('refreshButton').addEventListener('click', loadDashboard);
$('topSuppliers').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-supplier-id]');
  if (button) selectSupplier(button.dataset.supplierId);
});
$('clearFiltersButton').addEventListener('click', () => {
  $('filtersForm').reset();
  state.filters = {};
  state.offset = 0;
  loadDashboard();
});
$('sortField').addEventListener('change', (event) => {
  state.sort = event.target.value;
  state.offset = 0;
  loadDashboard();
});
$('sortDirection').addEventListener('change', (event) => {
  state.order = event.target.value;
  state.offset = 0;
  loadDashboard();
});
$('pageSize').addEventListener('change', (event) => {
  state.limit = Number(event.target.value);
  state.offset = 0;
  loadDashboard();
});
$('prevPageButton').addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - state.limit);
  loadDashboard();
});
$('nextPageButton').addEventListener('click', () => {
  if (state.offset + state.limit < state.ordersTotal) {
    state.offset += state.limit;
    loadDashboard();
  }
});
$('bulkActionForm').addEventListener('submit', runBulkAction);
$('clearSelectionButton').addEventListener('click', () => {
  state.selectedOrderIds.clear();
  renderOrders({ data: state.orders, total: state.ordersTotal });
});
$('ordersBody').addEventListener('click', (event) => {
  if (event.target.matches('input.order-select')) {
    const orderId = event.target.dataset.orderId;
    if (event.target.checked) {
      state.selectedOrderIds.add(orderId);
    } else {
      state.selectedOrderIds.delete(orderId);
    }
    renderSelectedCount();
    return;
  }
  const row = event.target.closest('tr[data-order-id]');
  if (row) selectOrder(row.dataset.orderId);
});
$('supplierDetail').addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-order-id]');
  if (row) selectOrder(row.dataset.orderId);
});

function describeEvent(event) {
  if (event.type === 'order_updated') {
    return `Order ${event.data.id} changed from ${event.data.old_status} to ${event.data.new_status}`;
  }
  if (event.type === 'bulk_completed') {
    return `Bulk job ${event.data.jobId ?? event.data.job_id} completed`;
  }
  if (event.type === 'ui_patch_success') {
    return `UI saved ${event.data.id}: ${event.data.status} / ${event.data.priority}`;
  }
  return `${event.type}: ${JSON.stringify(event.data)}`;
}

function addEventFeedItem(event) {
  state.events = [{ ...event, receivedAt: new Date() }, ...state.events].slice(0, 8);
  $('eventFeed').innerHTML = state.events
    .map((item) => `<li><strong>${escapeHtml(describeEvent(item))}</strong><time>${item.receivedAt.toLocaleTimeString()}</time></li>`)
    .join('');
}

function connectEvents() {
  if (!('EventSource' in window)) {
    $('realtimeStatus').textContent = 'Live events unavailable in this browser';
    return;
  }

  const source = new EventSource('/api/events');
  source.onopen = () => {
    $('realtimeStatus').textContent = 'Live events connected';
    $('realtimeStatus').classList.add('connected');
  };
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      addEventFeedItem(event);
      if (event.type === 'order_updated' && event.data.id === state.selectedOrderId) {
        selectOrder(state.selectedOrderId);
      }
      loadDashboard();
    } catch (error) {
      showError(error);
    }
  };
  source.onerror = () => {
    $('realtimeStatus').textContent = 'Live events reconnecting…';
    $('realtimeStatus').classList.remove('connected');
  };
}

loadDashboard();
connectEvents();