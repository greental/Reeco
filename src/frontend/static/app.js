const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-US');
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

const state = {
  filters: {},
};

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
    .map((supplier) => `<li><strong>${escapeHtml(supplier.supplier_name)}</strong><br><span class="muted">${escapeHtml(supplier.supplier_id)} · ${currency.format(supplier.total_revenue)}</span></li>`)
    .join('');
}

function ordersQuery() {
  const params = new URLSearchParams({ limit: '25', sort: 'created_at', order: 'desc' });
  for (const [key, value] of Object.entries(state.filters)) {
    if (value) params.set(key, value);
  }
  return `/api/orders?${params.toString()}`;
}

function renderOrders(result) {
  $('ordersBody').innerHTML = result.data
    .map((order) => `
      <tr>
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
  $('ordersMeta').textContent = `Showing ${result.data.length} of ${number.format(result.total)} matching orders.`;
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
  } catch (error) {
    showError(error);
  }
}

$('filtersForm').addEventListener('submit', (event) => {
  event.preventDefault();
  state.filters = Object.fromEntries(new FormData(event.currentTarget).entries());
  loadDashboard();
});

$('refreshButton').addEventListener('click', loadDashboard);

loadDashboard();