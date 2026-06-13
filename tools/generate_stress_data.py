#!/usr/bin/env python3
"""Generate a deterministic large stress dataset for local import/API testing."""

from __future__ import annotations

import argparse
import csv
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

STATUSES = ["pending", "approved", "rejected", "shipped", "delivered", "cancelled"]
PRIORITIES = ["low", "medium", "high", "critical"]
WAREHOUSES = ["warehouse_east", "warehouse_west", "warehouse_north", "warehouse_south", "warehouse_central"]
COUNTRIES = ["US", "CA", "GB", "DE", "FR", "IL", "JP", "AU"]
MATERIALS = ["Steel", "Carbon", "Hydraulic", "Electric", "Titanium", "Copper", "Ceramic", "Analog"]
NOUNS = ["Valve", "Pump", "Motor", "Bracket", "Cable", "Bearing", "Plate", "Sensor", "Fuse", "Hose"]


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def money(value: float) -> str:
    return f"{value:.2f}"


def generate_categories(count: int) -> list[dict[str, str]]:
    rows = []
    for index in range(1, count + 1):
        parent_id = "" if index <= 10 else f"stress_cat_{random.randint(1, index - 1):04d}"
        rows.append({"id": f"stress_cat_{index:04d}", "name": f"Stress Category {index:04d}", "parent_id": parent_id})

    if count >= 153:
        rows[149]["parent_id"] = "stress_cat_0152"
        rows[150]["parent_id"] = "stress_cat_0150"
        rows[151]["parent_id"] = "stress_cat_0151"
    return rows


def generate_suppliers(count: int) -> list[dict[str, str]]:
    rows = []
    base = datetime(2022, 1, 1, tzinfo=timezone.utc)
    for index in range(1, count + 1):
        name = f"Stress Supplier {index:04d} LLC"
        email = f"stress.supplier.{index:04d}@supplier.example"
        if index in (26, 28):
            name = "Duplicate Stress Trading LLC"
            email = "duplicate.stress@supplier.example"
        rows.append({
            "id": f"stress_sup_{index:04d}",
            "name": name,
            "email": email,
            "rating": "" if index % 97 == 0 else f"{random.uniform(1, 5):.2f}",
            "country": random.choice(COUNTRIES),
            "active": "false" if index % 17 == 0 else "true",
            "created_at": iso(base + timedelta(days=random.randint(0, 900), hours=random.randint(0, 23))),
        })
    return rows


def generate_products(count: int, category_count: int) -> list[dict[str, str]]:
    rows = []
    for index in range(1, count + 1):
        material = random.choice(MATERIALS)
        noun = random.choice(NOUNS)
        sku = f"STRESS-{material[:3].upper()}-{noun[:3].upper()}-{index % 5000:04d}"
        if index % 83 == 0:
            sku = "STRESS-DUP-SKU"
        category_id = f"stress_cat_{random.randint(1, category_count):04d}"
        if index % 251 == 0:
            category_id = "stress_cat_missing"
        rows.append({
            "id": f"stress_prod_{index:05d}",
            "name": f"{material} {noun} {index % 100}mm",
            "category_id": category_id,
            "sku": sku,
            "price": money(random.uniform(5, 5000)),
        })
    return rows


def order_row(order_id: str, supplier_id: str, product: dict[str, str], created: datetime, quantity: int, unit_price: float, **overrides: str) -> dict[str, str]:
    updated = created + timedelta(days=random.randint(0, 20), hours=random.randint(0, 23))
    row = {
        "id": order_id,
        "supplier_id": supplier_id,
        "product_id": product["id"],
        "quantity": str(quantity),
        "unit_price": money(unit_price),
        "total_price": money(quantity * unit_price),
        "status": random.choice(STATUSES),
        "priority": random.choice(PRIORITIES),
        "created_at": iso(created),
        "updated_at": iso(updated),
        "warehouse": random.choice(WAREHOUSES),
        "notes": "Stress generated order",
    }
    row.update(overrides)
    return row


def generate_orders(count: int, suppliers: list[dict[str, str]], products: list[dict[str, str]]):
    malformed = max(1, int(count * 0.02))
    business = max(1, int(count * 0.03))
    normal = count - malformed - business
    base = datetime(2023, 1, 1, tzinfo=timezone.utc)
    rows: list[dict[str, str]] = []
    sample_ids = {key: [] for key in [
        "malformed_orders_expected_skipped", "price_mismatch", "negative_quantity",
        "timestamp_anomaly", "price_spike", "after_hours", "xss_like_notes"
    ]}
    fault_counts = {
        "malformed_ingestion": {"orders_invalid_quantity": 0, "orders_invalid_price": 0, "orders_invalid_timestamp": 0, "orders_invalid_status": 0, "orders_missing_required_reference": 0},
        "business_anomalies": {"price_mismatch": 0, "negative_quantity": 0, "timestamp_anomaly": 0, "price_spike": 0, "after_hours": 0, "xss_like_notes": 0, "empty_warehouse": 0, "inactive_supplier": 0},
    }

    for index in range(1, malformed + 1):
        product = random.choice(products)
        supplier = random.choice(suppliers)["id"]
        kind = index % 5
        order_id = f"stress_ord_bad_{index:06d}"
        row = order_row(order_id, supplier, product, base, 10, float(product["price"]))
        if kind == 0:
            row["quantity"] = "abc"
            fault_counts["malformed_ingestion"]["orders_invalid_quantity"] += 1
        elif kind == 1:
            row["unit_price"] = "not-a-price"
            fault_counts["malformed_ingestion"]["orders_invalid_price"] += 1
        elif kind == 2:
            row["created_at"] = "2024-99-99T99:99:99Z"
            fault_counts["malformed_ingestion"]["orders_invalid_timestamp"] += 1
        elif kind == 3:
            row["status"] = "paid"
            fault_counts["malformed_ingestion"]["orders_invalid_status"] += 1
        else:
            row["product_id"] = "stress_prod_missing"
            fault_counts["malformed_ingestion"]["orders_missing_required_reference"] += 1
        rows.append(row)
        if len(sample_ids["malformed_orders_expected_skipped"]) < 10:
            sample_ids["malformed_orders_expected_skipped"].append(order_id)

    anomaly_kinds = ["price_mismatch", "negative_quantity", "timestamp_anomaly", "price_spike", "after_hours", "xss_like_notes", "empty_warehouse", "inactive_supplier"]
    inactive_suppliers = [supplier for supplier in suppliers if supplier["active"] == "false"] or suppliers
    for index in range(1, business + 1):
        kind = anomaly_kinds[(index - 1) % len(anomaly_kinds)]
        product = random.choice(products)
        supplier = random.choice(inactive_suppliers if kind == "inactive_supplier" else suppliers)["id"]
        order_id = f"stress_ord_{kind}_{index:06d}"
        created = base + timedelta(days=random.randint(0, 730), hours=random.randint(6, 21))
        row = order_row(order_id, supplier, product, created, random.randint(1, 200), float(product["price"]))
        if kind == "price_mismatch":
            row["total_price"] = money(float(row["total_price"]) * 1.25)
        elif kind == "negative_quantity":
            row["quantity"] = str(-abs(int(row["quantity"])))
        elif kind == "timestamp_anomaly":
            row["updated_at"] = iso(created - timedelta(days=5))
        elif kind == "price_spike":
            row["unit_price"] = money(float(product["price"]) * 4.5)
            row["total_price"] = money(float(row["quantity"]) * float(row["unit_price"]))
        elif kind == "after_hours":
            row["created_at"] = iso(created.replace(hour=2))
        elif kind == "xss_like_notes":
            row["notes"] = '<img src=x onerror=alert("stress")>'
        elif kind == "empty_warehouse":
            row["warehouse"] = ""
        fault_counts["business_anomalies"][kind] += 1
        if kind in sample_ids and len(sample_ids[kind]) < 10:
            sample_ids[kind].append(order_id)
        rows.append(row)

    for index in range(1, normal + 1):
        product = random.choice(products)
        created = base + timedelta(days=random.randint(0, 730), hours=random.randint(6, 21))
        rows.append(order_row(f"stress_ord_{index:06d}", random.choice(suppliers)["id"], product, created, random.randint(1, 200), float(product["price"])))

    return rows, malformed, fault_counts, sample_ids


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--orders", type=int, default=200_000)
    parser.add_argument("--suppliers", type=int, default=2_000)
    parser.add_argument("--products", type=int, default=20_000)
    parser.add_argument("--categories", type=int, default=300)
    parser.add_argument("--out", default="data_stress")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    categories = generate_categories(args.categories)
    suppliers = generate_suppliers(args.suppliers)
    products = generate_products(args.products, args.categories)
    orders, malformed_orders, fault_counts, sample_ids = generate_orders(args.orders, suppliers, products)

    write_csv(out / "categories.csv", ["id", "name", "parent_id"], categories)
    write_csv(out / "suppliers.csv", ["id", "name", "email", "rating", "country", "active", "created_at"], suppliers)
    write_csv(out / "products.csv", ["id", "name", "category_id", "sku", "price"], products)
    write_csv(out / "orders.csv", ["id", "supplier_id", "product_id", "quantity", "unit_price", "total_price", "status", "priority", "created_at", "updated_at", "warehouse", "notes"], orders)

    manifest = {
        "seed": args.seed,
        "generated_at": iso(datetime.now(timezone.utc)),
        "files": {
            "suppliers": {"source_rows": len(suppliers), "expected_inserted": len(suppliers), "expected_skipped": 0},
            "categories": {"source_rows": len(categories), "expected_inserted": len(categories), "expected_skipped": 0},
            "products": {"source_rows": len(products), "expected_inserted": len(products), "expected_skipped": 0},
            "orders": {"source_rows": len(orders), "expected_inserted": len(orders) - malformed_orders, "expected_skipped": malformed_orders},
        },
        "faults": fault_counts,
        "expected_api_minimums": {
            "anomalies_total_min": int(args.orders * 0.02),
            "price_mismatch_min": fault_counts["business_anomalies"]["price_mismatch"],
            "negative_quantity_min": fault_counts["business_anomalies"]["negative_quantity"],
            "timestamp_anomaly_min": fault_counts["business_anomalies"]["timestamp_anomaly"],
            "price_spike_min": fault_counts["business_anomalies"]["price_spike"],
            "after_hours_min": fault_counts["business_anomalies"]["after_hours"],
        },
        "sample_ids": sample_ids,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Generated stress dataset in {out}: orders={len(orders)}, expected_inserted_orders={len(orders) - malformed_orders}, malformed_orders={malformed_orders}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
