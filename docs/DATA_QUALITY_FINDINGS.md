# Data Quality & Business Risk Findings

This document records the data-quality findings from inspecting the assignment CSV files before designing the database schema and API behavior.

The goal is not to reject suspicious records during import. In procurement systems, many suspicious-looking records are still business-relevant events: returns, emergency purchases, manual price overrides, inactive-but-historical suppliers, or data migrated from another system.

Our approach:

```text
preserve all source data on import
→ expose consistent API behavior
→ flag suspicious records through anomaly detection / validation
→ document business risks and possible prevention controls
```

## Source files inspected

| File | Rows | Purpose |
|---|---:|---|
| `orders.csv` | 50,000 | Procurement orders |
| `suppliers.csv` | 500 | Supplier master data |
| `products.csv` | 5,000 | Product catalog |
| `categories.csv` | 195 | Product category hierarchy |

---

# 1. README edge cases found

The README says the dataset intentionally includes null warehouses, negative quantities, mismatched prices, inactive suppliers with orders, timestamp anomalies, duplicate supplier names, circular categories, and XSS payloads in notes.

## 1.1 Null / empty warehouses

**Count found:** 1,512 orders

**Example:**

```text
order_id:   ord_00053
supplier:   sup_390
product:    prod_1538
quantity:   8
warehouse:  null / empty
notes:      <div onmouseover="alert(1)">hover me</div>
```

**Business interpretation**

A missing warehouse may mean the order has not yet been assigned to a receiving location, was imported from another system, or was created before warehouse routing was known.

**Implementation impact**

- Do not reject these orders during import.
- In `/api/orders/stats`, group null/empty warehouses as `"unassigned"`.
- In the UI, show `"Unassigned"` rather than blank.

**Prevention / controls**

- New orders should require warehouse assignment before approval/shipping.
- Allow draft/pending orders to have missing warehouse, but flag them before fulfillment.

---

## 1.2 Negative quantities

**Count found:** 507 orders

**Example:**

```text
order_id:    ord_00122
supplier:    sup_393
product:     prod_0254
quantity:    -35
unit_price:  13.39
total_price: 468.65
status:      delivered
warehouse:   warehouse_south
```

**Business interpretation**

Negative quantity may represent a return, credit, correction, or reversal. However, the example still has a positive `total_price`, so the financial meaning is ambiguous.

**Implementation impact**

- Preserve the order.
- Flag as `negative_quantity` in `/api/orders/anomalies`.
- Do not assume negative quantity always means negative revenue unless the business model explicitly defines it that way.

**Prevention / controls**

- In a production system, use an explicit field such as `order_type` or `movement_type`:
  - `purchase`
  - `return`
  - `replacement`
  - `correction`
  - `transfer`
- Require return authorization IDs for negative quantities.

---

## 1.3 Mismatched prices

**Count found:** 1,489 orders

**Example:**

```text
order_id:    ord_00119
quantity:    152
unit_price:  175.30
expected:    152 * 175.30 = 26,645.60
actual:      23,941.41
difference:  2,704.19
```

**Business interpretation**

A mismatch may be caused by discounting, tax handling, currency conversion, manual override, unit-of-measure mismatch, or corrupted data.

**Implementation impact**

- Do not silently recalculate and overwrite `total_price`.
- Preserve source `total_price`.
- Flag as `price_mismatch` where `abs(total_price - quantity * unit_price) > 0.01`.

**Prevention / controls**

- Store explicit fields for discounts, tax, shipping, currency, and unit-of-measure.
- Store computed total and source total separately.
- Require approval for manual price overrides.

---

## 1.4 Inactive suppliers with orders

**Count found:** 2,247 orders

**Example:**

```text
order_id:        ord_00009
supplier_id:     sup_197
supplier_name:   Valley Lunar Trading LLC
supplier_active: false
```

**Business interpretation**

This can be legitimate for historical orders, but it is risky for new procurement. Current supplier state alone is not enough to know whether the supplier was active at the time of order creation.

**Implementation impact**

- Preserve the order.
- Flag as `inactive_supplier` in anomaly detection.
- Do not block historical data import.

**Prevention / controls**

- Prevent new orders for inactive suppliers.
- Add supplier status history in production:

```text
supplier_status_history(
  supplier_id,
  status,
  valid_from,
  valid_to
)
```

This allows the system to answer: “Was this supplier active when the order was placed?”

---

## 1.5 Timestamp anomalies

**Count found:** 208 orders

**Example:**

```text
order_id:    ord_00495
created_at:  2023-05-19T23:55:27Z
updated_at:  2023-05-03T23:55:27Z
```

**Business interpretation**

The order appears to have been updated before it was created. This can happen during imports, time zone conversion bugs, backfills, or bad source data.

**Implementation impact**

- Preserve the order.
- Flag as `timestamp_anomaly`.
- Exclude or handle carefully when computing delivery time metrics.

**Prevention / controls**

- Validate timestamps at write time.
- Use database constraints for new writes where possible.
- Keep source-system timestamps separate from local ingestion timestamps.

---

## 1.6 Duplicate supplier names

**Normalized duplicate groups found:** 8 groups / 16 supplier rows

**Example:**

```text
sup_001 | Acme Industrial Supply
sup_002 | ACME Industrial Supply Inc.
```

Another example:

```text
sup_026 | Bright Star Electronics
sup_028 | Bright-Star Electronics
```

**Business interpretation**

Duplicate supplier identities split spend, performance metrics, anomaly rates, and approval workflows across multiple records.

**Implementation impact**

- Do not enforce unique supplier name.
- Use supplier ID as the primary identity.
- In analytics, be aware that duplicates may distort top supplier calculations.

**Prevention / controls**

- Add supplier deduplication workflow.
- Match potential duplicates using:
  - normalized name
  - email
  - tax ID / registration number
  - address
  - country
  - bank account or payment details

---

## 1.7 Circular category hierarchy

**Cycle found:** one cycle

```text
cat_150 → cat_152 → cat_151 → cat_150
```

**Business interpretation**

Category hierarchy data is corrupt. Any recursive category lookup can infinite-loop if it does not guard against cycles.

**Implementation impact**

- Product filtering by category must include recursive child categories.
- Recursive category traversal must use cycle detection.
- PostgreSQL recursive CTEs should track visited IDs, or application traversal should use a `visited` set.

**Prevention / controls**

- Prevent category parent updates that create cycles.
- Add validation before saving category hierarchy changes.
- Add admin tooling to detect and repair category cycles.

---

## 1.8 XSS payloads in order notes

**HTML/script-like notes found:** 490 orders

**Examples:**

```text
ord_00220 | "><script>document.cookie</script>
ord_00556 | <img src=x onerror=alert(1)>
ord_00053 | <div onmouseover="alert(1)">hover me</div>
```

**Business interpretation**

Notes are user-controlled or imported text and may contain malicious payloads.

**Implementation impact**

- Backend may preserve notes as plain text.
- API must return JSON, not HTML.
- Frontend must render notes as text, never raw HTML.
- Do not use `dangerouslySetInnerHTML` for notes.

**Prevention / controls**

- Escape on output.
- Sanitize only if HTML notes are explicitly supported.
- Add content security policy in production.
- Audit all text fields rendered in UI.

---

# 2. Additional business risks found

These are not all required by the assignment tests, but they are important for schema design, documentation, and optional internal quality tests.

## 2.1 Products referencing missing categories

**Count found:** 81 products

**Example:**

```text
prod_0056 | Carbon Ring 100mm | category_id: cat_200
prod_0102 | Titanium Fuse 100mm | category_id: cat_200
prod_0231 | Galvanized Motor M6 Pack | category_id: cat_200
```

`cat_200` does not exist in `categories.csv`.

**Business risk**

Product category lookup can fail. A strict foreign key from `products.category_id` to `categories.id` would fail import unless handled.

**Recommended assignment approach**

- Preserve all products.
- Either avoid a strict category FK for the assignment import, or insert a placeholder category such as `"Unknown / Missing Category"`.
- Document the decision in `ARCHITECTURE.md`.

**Production approach**

- Import into staging tables first.
- Quarantine missing references.
- Require catalog owners to repair invalid category mappings.

---

## 2.2 Duplicate product SKUs

**Duplicate SKU groups found:** 742  
**Rows involved:** 1,573

**Example:**

```text
prod_0373 | Analog Bearing SM Assembly | SKU-ANA-BEA-SM | price 460.45
prod_1732 | Analog Bearing SM Kit      | SKU-ANA-BEA-SM | price 102.38
```

Another high-risk pattern:

```text
prod_0133 | Analog Bracket XL    | SKU-ANA-BRA-XL | price 15.58
prod_2201 | Titanium Plate 50mm  | SKU-ANA-BRA-XL | price 962.26
```

**Business risk**

SKU normally represents product identity, but here it is not unique. Matching orders or invoices by SKU alone could map to the wrong product.

**Implementation impact**

- Use `product_id` as the primary product identity.
- Do not enforce SKU uniqueness.
- Show both product ID and SKU in operational UI.

**Prevention / controls**

- In production, uniqueness might be scoped by supplier, catalog, tenant, or unit-of-measure.
- Add duplicate SKU review workflow.

---

## 2.3 Duplicate product names

**Exact duplicate product-name groups found:** 165  
**Rows involved:** 338

**Example:**

```text
prod_0230 | Analog Cable 1/2" | price 3119.20
prod_2001 | Analog Cable 1/2" | price 87.67
prod_2899 | Analog Cable 1/2" | price 5.44
```

**Business risk**

Search by product name may return multiple different products with very different catalog prices.

**Implementation impact**

- Search should not hide identity fields.
- UI should show product ID, SKU, category, and price.
- Product name search should be treated as discovery, not identity matching.

**Prevention / controls**

- Use product master-data governance.
- Add duplicate product review and merge workflow.

---

## 2.4 Supplier record created after order date

**Count found:** 7,254 orders

**Example:**

```text
order_id:             ord_00006
supplier_id:          sup_161
order_created_at:     2023-03-14T16:15:32Z
supplier_created_at:  2023-10-16T19:37:27Z
supplier_name:        Lunar Solar Corporation AB
```

**Business risk**

Either supplier onboarding dates are wrong, or historical orders were backfilled after supplier records were created. This weakens audit assumptions.

**Implementation impact**

- Do not rely on `suppliers.created_at` alone to validate historical orders.
- Current `active` status is not enough for historical compliance.

**Prevention / controls**

- Track supplier lifecycle/history.
- Track source-system import timestamps separately.
- Add data lineage fields.

---

## 2.5 “Return” notes with positive quantities

**Orders with return-like notes:** 2,266  
**Return-like notes with positive quantity:** 2,246

**Example:**

```text
ord_00003 | quantity 8   | notes: Return - damaged items
ord_00023 | quantity 34  | notes: Return - damaged items
ord_00038 | quantity 149 | notes: Return - damaged items
```

**Business risk**

The meaning of returns is ambiguous. A positive quantity with a return note may represent a replacement order, a return request, or inconsistent data entry.

**Implementation impact**

- Do not infer return behavior from notes alone.
- Required anomaly detection should use `quantity < 0` for `negative_quantity`.
- Notes can be considered a softer signal only.

**Prevention / controls**

- Add explicit order type / movement type.
- Add return authorization workflow.

---

## 2.6 Missing supplier ratings

**Count found:** 14 suppliers

**Example:**

```text
sup_002 | ACME Industrial Supply Inc. | rating: null
sup_008 | Global Tech Solutions       | rating: null
sup_012 | Smith Manufacturing Company | rating: null
```

**Business risk**

Supplier ranking and risk scoring can be misleading if missing ratings are treated as zero.

**Implementation impact**

- Keep `rating` nullable.
- Do not default missing rating to `0`.
- UI should show `"Unrated"`.

**Prevention / controls**

- Separate “unrated” from “bad rating.”
- Require rating before supplier becomes preferred/approved if that is a business rule.

---

## 2.7 Duplicate supplier email

**Duplicate email groups found:** 1  
**Rows involved:** 2

**Example:**

```text
sup_026 | Bright Star Electronics  | bright.star.electronics@supplier.com
sup_028 | Bright-Star Electronics | bright.star.electronics@supplier.com
```

**Business risk**

Email duplication is a strong signal that two supplier rows may represent the same vendor. This can split spend and performance analytics.

**Implementation impact**

- Do not enforce unique email during import unless data is cleaned first.
- Keep supplier ID as primary identity.
- Optionally flag duplicate email in internal quality tests.

**Prevention / controls**

- Add supplier deduplication workflow.
- Use unique constraints only after master-data cleanup.

---

## 2.8 Unit price spikes against catalog price

**Count found:** 1,486 orders where `unit_price > 3x product.price`

**Example:**

```text
order_id:      ord_00011
product_id:    prod_3620
product_name:  Electric Hose 1/2"
unit_price:    84.99
catalog_price: 11.89
ratio:         ~7.15x
```

**Business risk**

Could indicate fraud, unit-of-measure mismatch, wrong product mapping, emergency procurement, or outdated catalog price.

**Implementation impact**

- Implement as bonus anomaly `price_spike`.
- Do not auto-reject because high price may be legitimate.

**Prevention / controls**

- Approval threshold for price variance.
- Capture unit-of-measure and currency.
- Track catalog price versions.

---

## 2.9 Very high-value approved orders

**Largest order found:**

```text
order_id:    ord_00688
quantity:    175
unit_price:  35,849.29
total_price: 6,273,625.75
status:      approved
priority:    high
```

**Business risk**

High-value orders should usually require stronger approval controls.

**Implementation impact**

- Not required by assignment tests.
- Useful candidate for an internal business-risk test.

**Prevention / controls**

- Approval thresholds:
  - `< 10k`: normal flow
  - `10k–100k`: manager approval
  - `> 100k`: finance/procurement director approval
- Add audit trail for approval decisions.

---

## 2.10 After-hours orders

**Count found:** 16,677 orders outside 06:00–22:00 UTC

**Example:**

```text
order_id:   ord_00001
created_at: 2023-02-24T03:57:10Z
notes:      After-hours emergency order
```

**Business risk**

After-hours orders may be legitimate emergency purchases, but they can also indicate policy bypass or suspicious activity.

**Implementation impact**

- Implement as bonus anomaly `after_hours`.
- Classify as low/medium risk unless combined with other signals.

**Prevention / controls**

- Require reason for emergency orders.
- Escalate if after-hours + high value + inactive supplier + price spike.

---

# 3. Schema implications

Recommended assignment schema behavior:

```text
orders
- preserve original CSV fields
- add version column for optimistic locking
- allow nullable warehouse
- store notes as text
- do not reject anomaly-like rows during import

suppliers
- id is primary key
- active is boolean
- rating is nullable
- do not enforce unique name/email during raw import

products
- id is primary key
- sku is not unique
- category_id may be nullable or non-strict because cat_200 is missing
- do not use product name or SKU as primary identity

categories
- id is primary key
- parent_id is nullable
- recursive traversal must have cycle guard

jobs / job_items
- needed for async bulk actions
- track progress and failed IDs
```

Production-grade alternative:

```text
raw_import tables
→ validation/quarantine tables
→ normalized business tables
```

For this assignment, the API needs to operate over all rows, so the import should be tolerant and the anomaly layer should expose risks.

---

# 4. Proposed internal quality tests

The assignment tests live under `tests/` and should not be modified.

Create a separate folder for our own project-quality tests, for example:

```text
quality-tests/
  data-quality.test.ts
  business-rules.test.ts
  README.md
```

These tests should document our standards without interfering with the official test suite.

## 4.1 Suggested npm scripts

```json
{
  "scripts": {
    "test:quality": "vitest run quality-tests",
    "test:quality:data": "vitest run quality-tests/data-quality.test.ts",
    "test:quality:business": "vitest run quality-tests/business-rules.test.ts"
  }
}
```

## 4.2 Data-quality tests

Suggested tests:

```text
- CSV fixture has expected row counts.
- Orders contain null warehouses and API stats groups them as "unassigned".
- Negative quantity examples are flagged as anomalies.
- Price mismatch examples are flagged as anomalies.
- Inactive supplier examples are flagged as anomalies.
- Timestamp anomaly examples are flagged as anomalies.
- Category traversal detects/prevents circular category loops.
- Product import preserves products with missing category references.
- API renders/returns XSS notes as JSON strings, not HTML.
```

## 4.3 Business-risk tests

Suggested tests:

```text
- Duplicate supplier names are detectable by normalized-name logic.
- Duplicate supplier emails are detectable.
- Duplicate SKUs are detectable and not treated as unique identifiers.
- Duplicate product names do not break product search or identity.
- Missing supplier rating remains null/unrated, not zero.
- Supplier-created-after-order records are detected as audit risk.
- Return-note + positive-quantity records are detected as ambiguous movement risk.
- Very high-value approved orders are detectable for approval-threshold review.
- After-hours + high-value + price-spike combinations are escalated in severity.
```

## 4.4 Example test style

These tests can use direct CSV reads for pure data checks and API calls for behavior checks.

Example pure data test:

```ts
it("detects products that reference missing categories", async () => {
  const products = await loadCsv("data/products.csv");
  const categories = await loadCsv("data/categories.csv");

  const categoryIds = new Set(categories.map(c => c.id));
  const missing = products.filter(p => !categoryIds.has(p.category_id));

  expect(missing.length).toBeGreaterThan(0);
  expect(missing.some(p => p.category_id === "cat_200")).toBe(true);
});
```

Example API behavior test:

```ts
it("keeps XSS-like notes as JSON strings", async () => {
  const res = await fetch(`${API_URL}/api/orders/ord_00220`);
  expect(res.headers.get("content-type")).toContain("application/json");

  const body = await res.json();
  expect(typeof body.notes).toBe("string");
  expect(body.notes).toContain("<script>");
});
```

---

# 5. Product design principle

The main principle from the data exploration is:

```text
Do not confuse suspicious data with invalid data.
```

In procurement, suspicious rows may represent real business events. Therefore:

```text
ingestion should preserve
validation should flag
workflow should decide
UI should make risk visible
```

This is the core design standard we should carry into the implementation.
