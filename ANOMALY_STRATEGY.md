# Anomaly Strategy

## Guiding principle

The dataset intentionally contains suspicious records. The implementation treats these records as business-relevant data, not as import failures.

```text
preserve source data → expose consistent APIs → flag risky records → let workflow decide
```

This matters in procurement because anomalies can represent real events: returns, emergency purchases, manual price overrides, migrated historical records, or supplier lifecycle changes.

## Endpoint

Anomalies are exposed by:

```text
GET /api/orders/anomalies
```

Response shape:

```json
{
  "data": [
    {
      "order_id": "ord_00150",
      "anomaly_types": ["price_mismatch", "negative_quantity"],
      "severity": "high"
    }
  ]
}
```

The query is implemented in `src/backend/repositories/ordersRepository.ts` using SQL joins across `orders`, `suppliers`, and `products`.

## Implemented rules

### Required rules

| Rule | Condition | Rationale |
|---|---|---|
| `price_mismatch` | `abs(total_price - quantity * unit_price) > 0.01` | Detects totals that do not match quantity and unit price. |
| `inactive_supplier` | The order's supplier currently has `active = false` | Highlights orders tied to suppliers that may not be eligible for new procurement. |
| `negative_quantity` | `quantity < 0` | Flags returns, corrections, or ambiguous inventory movements. |
| `timestamp_anomaly` | `updated_at < created_at` | Detects impossible or corrupted timestamps. |

### Bonus rules

| Rule | Condition | Rationale |
|---|---|---|
| `price_spike` | `unit_price > product.price * 3` when catalog price is positive | Highlights unusually expensive purchases compared with catalog price. |
| `after_hours` | `created_at` hour is `22:00-05:59 UTC` | Identifies emergency or policy-bypass purchase timing. |
| `risky_supplier` | More than 50% of a supplier's orders have core anomaly signals | Escalates suppliers with repeated suspicious patterns. |

The `risky_supplier` calculation intentionally excludes `after_hours` from the supplier-risk average because after-hours activity is common in the dataset and could otherwise dominate the score.

## Severity model

Severity is assigned in application code by `classifyAnomalySeverity`.

Current logic:

- `high`
  - an order has two or more anomaly types, or
  - includes `negative_quantity`, `inactive_supplier`, or `price_spike`
- `medium`
  - includes `price_mismatch`, `timestamp_anomaly`, or `risky_supplier`
- `low`
  - all other cases, primarily standalone `after_hours`

This is intentionally conservative: anomalies that affect money, supplier eligibility, or inventory movement are treated as higher risk than timing-only signals.

## Data patterns discovered

Detailed examples and counts are documented in `docs/DATA_QUALITY_FINDINGS.md`. Key findings include:

- 1,512 orders with null/empty warehouse values.
- 507 orders with negative quantities.
- 1,489 orders with mismatched totals.
- 2,247 orders tied to inactive suppliers.
- 208 timestamp anomalies where `updated_at` is earlier than `created_at`.
- 1,486 unit-price spikes above 3x catalog price.
- 16,677 after-hours orders outside 06:00-22:00 UTC.
- 490 XSS-like note payloads, which are preserved as text and escaped in the UI.
- Duplicate supplier names/emails and duplicate product SKUs, which are documented but not treated as order-level anomalies in the API.

## Why anomalies are not rejected on import

Rejecting suspicious rows would reduce data completeness and could make analytics misleading. For example:

- Negative quantities may represent returns or credits.
- Inactive suppliers may still have valid historical orders.
- Price mismatches may represent discounts, tax, shipping, or manual overrides.
- After-hours orders may be legitimate emergency procurement.

The import therefore preserves all source rows and the anomaly endpoint makes risk visible to operators.

## UI handling

The frontend dashboard displays the total anomaly count from `/api/orders/anomalies` in the top metric cards. Order notes are rendered through HTML escaping so XSS-like payloads remain visible as text rather than executable markup.

## Improvements with more time

- Add anomaly filters and a dedicated anomaly review queue in the UI.
- Store anomaly snapshots in a table to avoid recalculating the full scan on every request.
- Add explainable anomaly details, such as expected total, actual total, price ratio, or timestamp delta.
- Incorporate supplier history to distinguish historically valid inactive-supplier orders from truly invalid new orders.
- Add product price versioning so price-spike detection compares against the catalog price valid at order time.
- Add explicit order movement types (`purchase`, `return`, `correction`) instead of inferring from quantity or notes.
- Add configurable severity thresholds rather than hard-coded rules.