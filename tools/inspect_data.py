#!/usr/bin/env python3
"""Inspect assignment CSV data and print data-quality summary counts."""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def read_csv(name: str) -> list[dict[str, str]]:
    path = DATA / name
    with path.open(newline="", encoding="utf-8-sig") as file:
        return list(csv.DictReader(file))


def decimal_value(value: str) -> Decimal:
    try:
        return Decimal((value or "0").strip())
    except InvalidOperation:
        return Decimal("0")


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def normalize_supplier_name(name: str) -> str:
    return "".join(ch.lower() for ch in name if ch.isalnum())


def has_html_note(note: str) -> bool:
    lowered = (note or "").lower()
    return any(token in lowered for token in ["<script", "onerror=", "onmouseover=", "<img", "<div"])


def find_category_cycles(categories: list[dict[str, str]]) -> list[list[str]]:
    parent_by_id = {row["id"]: (row.get("parent_id") or "").strip() for row in categories}
    cycles: set[tuple[str, ...]] = set()

    for category_id in parent_by_id:
        seen: dict[str, int] = {}
        path: list[str] = []
        current = category_id
        while current:
            if current in seen:
                cycle = path[seen[current]:]
                if cycle:
                    min_index = min(range(len(cycle)), key=lambda i: cycle[i])
                    normalized = tuple(cycle[min_index:] + cycle[:min_index])
                    cycles.add(normalized)
                break
            if current not in parent_by_id:
                break
            seen[current] = len(path)
            path.append(current)
            current = parent_by_id[current]

    return [list(cycle) for cycle in sorted(cycles)]


def main() -> int:
    orders = read_csv("orders.csv")
    suppliers = read_csv("suppliers.csv")
    products = read_csv("products.csv")
    categories = read_csv("categories.csv")

    suppliers_by_id = {row["id"]: row for row in suppliers}
    products_by_id = {row["id"]: row for row in products}
    category_ids = {row["id"] for row in categories}

    empty_warehouses = [row for row in orders if not (row.get("warehouse") or "").strip()]
    negative_quantities = [row for row in orders if decimal_value(row["quantity"]) < 0]
    price_mismatches = [
        row
        for row in orders
        if abs(decimal_value(row["total_price"]) - decimal_value(row["quantity"]) * decimal_value(row["unit_price"]))
        > Decimal("0.01")
    ]
    inactive_supplier_orders = [
        row
        for row in orders
        if suppliers_by_id.get(row["supplier_id"], {}).get("active", "").lower() == "false"
    ]
    timestamp_anomalies = [row for row in orders if parse_ts(row["updated_at"]) < parse_ts(row["created_at"])]
    xss_like_notes = [row for row in orders if has_html_note(row.get("notes", ""))]
    missing_category_products = [row for row in products if row.get("category_id") not in category_ids]

    supplier_name_counts = Counter(normalize_supplier_name(row["name"]) for row in suppliers)
    duplicate_supplier_groups = sum(1 for count in supplier_name_counts.values() if count > 1)
    duplicate_supplier_rows = sum(count for count in supplier_name_counts.values() if count > 1)

    sku_counts = Counter(row["sku"] for row in products)
    duplicate_sku_groups = sum(1 for count in sku_counts.values() if count > 1)
    duplicate_sku_rows = sum(count for count in sku_counts.values() if count > 1)

    product_name_counts = Counter(row["name"] for row in products)
    duplicate_product_name_groups = sum(1 for count in product_name_counts.values() if count > 1)
    duplicate_product_name_rows = sum(count for count in product_name_counts.values() if count > 1)

    supplier_created_after_order = [
        row
        for row in orders
        if row["supplier_id"] in suppliers_by_id
        and parse_ts(suppliers_by_id[row["supplier_id"]]["created_at"]) > parse_ts(row["created_at"])
    ]
    return_like = [row for row in orders if "return" in (row.get("notes") or "").lower()]
    return_like_positive_qty = [row for row in return_like if decimal_value(row["quantity"]) > 0]
    missing_supplier_ratings = [row for row in suppliers if not (row.get("rating") or "").strip()]
    duplicate_email_counts = Counter(row["email"] for row in suppliers if row.get("email"))
    duplicate_email_groups = sum(1 for count in duplicate_email_counts.values() if count > 1)
    duplicate_email_rows = sum(count for count in duplicate_email_counts.values() if count > 1)
    price_spikes = [
        row
        for row in orders
        if row["product_id"] in products_by_id
        and decimal_value(row["unit_price"]) > decimal_value(products_by_id[row["product_id"]]["price"]) * Decimal("3")
    ]
    after_hours = [
        row
        for row in orders
        if (created := parse_ts(row["created_at"])).hour < 6 or created.hour >= 22
    ]
    cycles = find_category_cycles(categories)

    print("Data inspection summary")
    print("=======================")
    print(f"orders: {len(orders)}")
    print(f"suppliers: {len(suppliers)}")
    print(f"products: {len(products)}")
    print(f"categories: {len(categories)}")
    print()
    print(f"empty/null warehouses: {len(empty_warehouses)}")
    print(f"negative quantities: {len(negative_quantities)}")
    print(f"price mismatches: {len(price_mismatches)}")
    print(f"inactive supplier orders: {len(inactive_supplier_orders)}")
    print(f"timestamp anomalies: {len(timestamp_anomalies)}")
    print(f"xss/html-like notes: {len(xss_like_notes)}")
    print(f"category cycles: {len(cycles)}" + (f" ({' -> '.join(cycles[0])} -> {cycles[0][0]})" if cycles else ""))
    print(f"duplicate supplier normalized groups/rows: {duplicate_supplier_groups}/{duplicate_supplier_rows}")
    print(f"products with missing categories: {len(missing_category_products)}")
    print(f"duplicate SKU groups/rows: {duplicate_sku_groups}/{duplicate_sku_rows}")
    print(f"duplicate product-name groups/rows: {duplicate_product_name_groups}/{duplicate_product_name_rows}")
    print(f"supplier-created-after-order rows: {len(supplier_created_after_order)}")
    print(f"return-like notes / positive quantity: {len(return_like)} / {len(return_like_positive_qty)}")
    print(f"missing supplier ratings: {len(missing_supplier_ratings)}")
    print(f"duplicate supplier email groups/rows: {duplicate_email_groups}/{duplicate_email_rows}")
    print(f"unit price spikes > 3x catalog: {len(price_spikes)}")
    print(f"after-hours orders: {len(after_hours)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
