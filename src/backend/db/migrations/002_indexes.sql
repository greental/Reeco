BEGIN;

-- Orders: core filtering, sorting, joins, anomaly checks, and pagination.
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_priority ON orders (priority);
CREATE INDEX IF NOT EXISTS idx_orders_supplier_id ON orders (supplier_id);
CREATE INDEX IF NOT EXISTS idx_orders_product_id ON orders (product_id);
CREATE INDEX IF NOT EXISTS idx_orders_warehouse ON orders (warehouse);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON orders (updated_at);
CREATE INDEX IF NOT EXISTS idx_orders_total_price ON orders (total_price);
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders (status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_priority ON orders (status, priority);
CREATE INDEX IF NOT EXISTS idx_orders_supplier_status ON orders (supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_product_created_at ON orders (product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_guard ON orders (id, status, version);
CREATE INDEX IF NOT EXISTS idx_orders_unassigned_warehouse ON orders ((COALESCE(NULLIF(warehouse, ''), 'unassigned')));

-- Products: category filtering and case-insensitive product-name search.
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_lower_name ON products (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku);

-- Categories: recursive child lookup.
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories (parent_id);

-- Suppliers: joins, active-supplier anomaly checks, and optional lookup/display filters.
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers (active);
CREATE INDEX IF NOT EXISTS idx_suppliers_lower_name ON suppliers (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_suppliers_email ON suppliers (email);

-- Jobs/job_items: job polling and background progress updates.
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at);
CREATE INDEX IF NOT EXISTS idx_job_items_job_id ON job_items (job_id);
CREATE INDEX IF NOT EXISTS idx_job_items_status ON job_items (status);
CREATE INDEX IF NOT EXISTS idx_job_items_job_status ON job_items (job_id, status);
CREATE INDEX IF NOT EXISTS idx_job_items_order_id ON job_items (order_id);

COMMIT;
