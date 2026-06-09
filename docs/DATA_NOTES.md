# Data Notes

This slice verifies the assignment CSV shape and records how implementation should treat known edge cases.

For the detailed business-risk analysis and examples, see [`docs/DATA_QUALITY_FINDINGS.md`](./DATA_QUALITY_FINDINGS.md).

## Verified source row counts

| File | Rows |
| --- | ---: |
| `data/orders.csv` | 50,000 |
| `data/suppliers.csv` | 500 |
| `data/products.csv` | 5,000 |
| `data/categories.csv` | 195 |

## Implementation decisions

- Preserve all source rows during import, including suspicious records.
- Do not mutate or clean source values silently during import.
- Use IDs as primary identities:
  - `supplier_id` for suppliers.
  - `product_id` for products.
  - `category_id` for categories.
- Keep `orders.warehouse` nullable and group null/empty warehouses as `unassigned` in stats.
- Keep `suppliers.rating` nullable; do not convert missing ratings to `0`.
- Do not enforce unique supplier names, supplier emails, product SKUs, or product names during raw import.
- Product category references may point to missing categories; the schema/import strategy must tolerate this.
- Recursive category traversal must use a cycle guard.
- Preserve notes as text and return them as JSON strings; frontend must render notes as text, not HTML.
- Required anomaly detection should flag suspicious rows rather than reject them.

## Inspection helper

Run:

```bash
npm run data:inspect
```

The helper prints row counts and important data-quality counts used to guide schema design, import behavior, anomaly detection, and frontend safety.
