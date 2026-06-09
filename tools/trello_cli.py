#!/usr/bin/env python3
"""
Trello CLI for the Reeco assignment board.

Uses TRELLO_API_KEY and TRELLO_TOKEN from environment or tools/.env.
Default board: https://trello.com/b/UZMr7YiD/reeco
"""

import argparse
import csv
import os
import sys

try:
    import requests
except ImportError:
    print("Run: pip install -r tools/requirements-trello.txt", file=sys.stderr)
    sys.exit(1)

BASE = "https://api.trello.com/1"
DEFAULT_BOARD = "UZMr7YiD"  # from https://trello.com/b/UZMr7YiD/reeco


def load_dotenv():
    """Load tools/.env without adding a dotenv dependency."""
    tools_dir = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.join(tools_dir, ".env")
    if not os.path.isfile(env_path):
        return

    with open(env_path, encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ[key.strip()] = value.strip().strip('"').strip("'")


def auth():
    key = os.environ.get("TRELLO_API_KEY") or os.environ.get("TRELLO_KEY")
    token = os.environ.get("TRELLO_TOKEN")
    if not key or not token:
        print(
            "Set TRELLO_API_KEY and TRELLO_TOKEN (environment or tools/.env). "
            "Get them from https://trello.com/app-key",
            file=sys.stderr,
        )
        sys.exit(1)
    return {"key": key, "token": token}


def trello_error(response):
    message = response.text[:300] if response.text else response.reason
    print(f"Trello API error {response.status_code}: {message}", file=sys.stderr)


def get_board_id(short_link, params):
    response = requests.get(f"{BASE}/boards/{short_link}", params={**params, "fields": "id"}, timeout=30)
    if not response.ok:
        trello_error(response)
        response.raise_for_status()
    return response.json()["id"]


def get_lists(board_id, params):
    response = requests.get(
        f"{BASE}/boards/{board_id}/lists",
        params={**params, "fields": "name,id"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def normalize_name(name):
    return " ".join((name or "").strip().lower().split())


def get_cards(board_id, params, fields="name,id,idList,desc,url,idLabels"):
    response = requests.get(
        f"{BASE}/boards/{board_id}/cards",
        params={**params, "fields": fields},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def get_labels(board_id, params):
    response = requests.get(
        f"{BASE}/boards/{board_id}/labels",
        params={**params, "fields": "name,id,color"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def create_list(board_id, params, name):
    response = requests.post(
        f"{BASE}/lists",
        params=params,
        json={"name": name, "idBoard": board_id, "pos": "bottom"},
        timeout=30,
    )
    response.raise_for_status()
    created = response.json()
    print(f"Created list {created['name']!r}")
    return created


def create_label(board_id, params, name, color=None):
    response = requests.post(
        f"{BASE}/labels",
        params=params,
        json={"name": name, "idBoard": board_id, "color": color},
        timeout=30,
    )
    response.raise_for_status()
    created = response.json()
    print(f"Created label {created['name']!r}")
    return created


def split_labels(raw_labels):
    return [label.strip() for label in (raw_labels or "").split(",") if label.strip()]


def build_manifest_description(row):
    parts = []
    description = (row.get("Description") or "").strip()
    if description:
        parts.append(description)
    priority = (row.get("Priority") or "").strip()
    test_command = (row.get("Test Command") or "").strip()
    metadata = []
    if priority:
        metadata.append(f"Priority: {priority}")
    if test_command:
        metadata.append(f"Test command: `{test_command}`")
    if metadata:
        parts.append("\n".join(metadata))
    return "\n\n---\n".join(parts)


def read_manifest_rows(csv_path):
    required = {"List", "Card Title", "Priority", "Labels", "Test Command", "Description"}
    with open(csv_path, newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"CSV is missing required columns: {sorted(missing)}")
        rows = []
        for index, row in enumerate(reader, start=2):
            list_name = (row.get("List") or "").strip()
            title = (row.get("Card Title") or "").strip()
            if not list_name or not title:
                raise ValueError(f"CSV row {index} must include List and Card Title")
            row["List"] = list_name
            row["Card Title"] = title
            rows.append(row)
    return rows


def cmd_validate_csv(args, params=None):
    try:
        rows = read_manifest_rows(args.csv_path)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    lists = []
    labels = set()
    titles = set()
    duplicate_titles = set()
    for row in rows:
        if row["List"] not in lists:
            lists.append(row["List"])
        title_key = normalize_name(row["Card Title"])
        if title_key in titles:
            duplicate_titles.add(row["Card Title"])
        titles.add(title_key)
        if row.get("Priority"):
            labels.add(row["Priority"].strip())
        labels.update(split_labels(row.get("Labels")))

    print(f"CSV rows: {len(rows)}")
    print(f"Lists: {len(lists)} -> {', '.join(lists)}")
    print(f"Labels: {len(labels)} -> {', '.join(sorted(labels))}")
    if duplicate_titles:
        print(f"Duplicate card titles in CSV: {sorted(duplicate_titles)}", file=sys.stderr)
        return 1
    print("CSV validation passed.")
    return 0


def cmd_import_csv(args, params):
    try:
        rows = read_manifest_rows(args.csv_path)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    board_id = get_board_id(args.board, params)
    existing_lists = {normalize_name(item["name"]): item for item in get_lists(board_id, params)}
    existing_labels = {normalize_name(item["name"]): item for item in get_labels(board_id, params) if item.get("name")}
    existing_cards = {normalize_name(item["name"]): item for item in get_cards(board_id, params)}

    created_lists = 0
    created_labels = 0
    created_cards = 0
    updated_cards = 0
    skipped_cards = 0

    needed_lists = []
    needed_label_names = []
    for row in rows:
        if row["List"] not in needed_lists:
            needed_lists.append(row["List"])
        label_names = []
        if row.get("Priority"):
            label_names.append(row["Priority"].strip())
        label_names.extend(split_labels(row.get("Labels")))
        for label_name in label_names:
            if label_name and label_name not in needed_label_names:
                needed_label_names.append(label_name)

    for list_name in needed_lists:
        key = normalize_name(list_name)
        if key in existing_lists:
            continue
        if args.dry_run:
            print(f"Would create list {list_name!r}")
            existing_lists[key] = {"name": list_name, "id": "dry-run"}
        else:
            existing_lists[key] = create_list(board_id, params, list_name)
        created_lists += 1

    label_colors = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "sky", "lime", "black", None]
    for index, label_name in enumerate(needed_label_names):
        key = normalize_name(label_name)
        if key in existing_labels:
            continue
        if args.dry_run:
            print(f"Would create label {label_name!r}")
            existing_labels[key] = {"name": label_name, "id": "dry-run"}
        else:
            existing_labels[key] = create_label(board_id, params, label_name, label_colors[index % len(label_colors)])
        created_labels += 1

    for row in rows:
        title = row["Card Title"]
        title_key = normalize_name(title)
        target_list = existing_lists[normalize_name(row["List"])]
        label_names = []
        if row.get("Priority"):
            label_names.append(row["Priority"].strip())
        label_names.extend(split_labels(row.get("Labels")))
        label_ids = [existing_labels[normalize_name(name)]["id"] for name in label_names if normalize_name(name) in existing_labels]
        description = build_manifest_description(row)

        if title_key in existing_cards:
            card = existing_cards[title_key]
            if not args.update_existing:
                print(f"Skipping existing card {title!r}")
                skipped_cards += 1
                continue
            if args.dry_run:
                print(f"Would update existing card {title!r}")
            else:
                body = {"desc": description, "idList": target_list["id"]}
                response = requests.put(f"{BASE}/cards/{card['id']}", params=params, json=body, timeout=30)
                response.raise_for_status()
                existing_label_ids = set(card.get("idLabels") or [])
                for label_id in label_ids:
                    if label_id not in existing_label_ids:
                        label_response = requests.post(
                            f"{BASE}/cards/{card['id']}/idLabels",
                            params=params,
                            json={"value": label_id},
                            timeout=30,
                        )
                        label_response.raise_for_status()
            updated_cards += 1
            continue

        body = {"name": title, "idList": target_list["id"], "desc": description}
        if label_ids:
            body["idLabels"] = ",".join(label_ids)
        if args.dry_run:
            print(f"Would create card {title!r} in {target_list['name']!r}")
            existing_cards[title_key] = {"name": title, "id": "dry-run", "idLabels": label_ids}
        else:
            response = requests.post(f"{BASE}/cards", params=params, json=body, timeout=30)
            response.raise_for_status()
            created = response.json()
            existing_cards[title_key] = created
            print(f"Created card {created['name']!r} in {target_list['name']!r}")
        created_cards += 1

    print(
        "Import summary: "
        f"rows={len(rows)}, created_lists={created_lists}, created_labels={created_labels}, "
        f"created_cards={created_cards}, updated_cards={updated_cards}, skipped_cards={skipped_cards}"
    )
    return 0


def cmd_lists(args, params):
    board_id = get_board_id(args.board, params)
    for trello_list in get_lists(board_id, params):
        print(f"  {trello_list['name']!r}  (id: {trello_list['id']})")
    return 0


def cmd_cards(args, params):
    board_id = get_board_id(args.board, params)
    response = requests.get(
        f"{BASE}/boards/{board_id}/cards",
        params={**params, "fields": "name,id,idList"},
        timeout=30,
    )
    response.raise_for_status()
    lists_by_id = {trello_list["id"]: trello_list["name"] for trello_list in get_lists(board_id, params)}
    for card in response.json():
        list_name = lists_by_id.get(card["idList"], "?")
        print(f"  {card['name']!r}  -> {list_name!r}  (id: {card['id']})")
    return 0


def find_one_by_name(items, query, item_type, allow_first=False):
    query_lower = query.strip().lower()
    matches = [item for item in items if query_lower in item["name"].lower()]
    if not matches:
        print(f"No {item_type} matching {query!r}.", file=sys.stderr)
        return None
    if len(matches) > 1 and not allow_first:
        exact = [item for item in matches if item["name"].lower() == query_lower]
        if len(exact) == 1:
            return exact[0]
        print(f"Multiple {item_type}s match {query!r}: {[item['name'] for item in matches]}. Use exact name.", file=sys.stderr)
        return None
    return matches[0]


def cmd_move(args, params):
    board_id = get_board_id(args.board, params)
    cards_response = requests.get(
        f"{BASE}/boards/{board_id}/cards",
        params={**params, "fields": "name,id,idList"},
        timeout=30,
    )
    cards_response.raise_for_status()
    card = find_one_by_name(cards_response.json(), args.card_name, "card", allow_first=args.yes)
    if card is None:
        return 1

    target_list = find_one_by_name(get_lists(board_id, params), args.list_name, "list")
    if target_list is None:
        return 1

    if card["idList"] == target_list["id"]:
        print(f"Card {card['name']!r} is already in {target_list['name']!r}.")
        return 0

    response = requests.put(
        f"{BASE}/cards/{card['id']}",
        params=params,
        json={"idList": target_list["id"]},
        timeout=30,
    )
    response.raise_for_status()
    print(f"Moved {card['name']!r} -> {target_list['name']!r}")
    return 0


def cmd_add(args, params):
    board_id = get_board_id(args.board, params)
    target_list = find_one_by_name(get_lists(board_id, params), args.list_name, "list")
    if target_list is None:
        return 1

    body = {"name": args.card_name.strip(), "idList": target_list["id"]}
    if args.desc:
        body["desc"] = args.desc

    response = requests.post(f"{BASE}/cards", params=params, json=body, timeout=30)
    response.raise_for_status()
    print(f"Added card {response.json()['name']!r} to {target_list['name']!r}")
    return 0


def cmd_open(args, params):
    board_id = get_board_id(args.board, params)
    response = requests.get(
        f"{BASE}/boards/{board_id}/cards",
        params={**params, "fields": "name,id,idList,desc,url"},
        timeout=30,
    )
    response.raise_for_status()
    card = find_one_by_name(response.json(), args.card_name, "card")
    if card is None:
        return 1

    lists_by_id = {trello_list["id"]: trello_list["name"] for trello_list in get_lists(board_id, params)}
    print(f"Name: {card['name']}")
    print(f"List: {lists_by_id.get(card['idList'], '?')}")
    print(f"URL:  {card.get('url', '')}")
    if card.get("desc"):
        desc = card["desc"]
        print(f"Desc: {desc[:200]}{'...' if len(desc) > 200 else ''}")
    return 0


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description="Trello CLI for the Reeco assignment board")
    parser.add_argument("--board", default=DEFAULT_BOARD, help=f"Board id/shortLink (default: {DEFAULT_BOARD})")
    subparsers = parser.add_subparsers(dest="cmd", required=True)

    subparsers.add_parser("lists", help="List all lists on the board")
    subparsers.add_parser("cards", help="List all cards and their list")

    validate_parser = subparsers.add_parser("validate-csv", help="Validate a Trello task CSV manifest without API access")
    validate_parser.add_argument("csv_path", help="Path to CSV manifest")

    import_parser = subparsers.add_parser("import-csv", help="Import cards from a Trello task CSV manifest")
    import_parser.add_argument("csv_path", help="Path to CSV manifest")
    import_parser.add_argument("--dry-run", action="store_true", help="Show planned changes without writing to Trello")
    import_parser.add_argument("--update-existing", action="store_true", help="Update existing exact-title cards instead of skipping them")

    move_parser = subparsers.add_parser("move", help="Move a card to a list by name")
    move_parser.add_argument("card_name", help="Card name (partial match)")
    move_parser.add_argument("list_name", help="Target list name (partial match)")
    move_parser.add_argument("--yes", "-y", action="store_true", help="If multiple cards match, move the first")

    add_parser = subparsers.add_parser("add", help="Add a new card to a list")
    add_parser.add_argument("list_name", help="Target list name")
    add_parser.add_argument("card_name", help="Card title")
    add_parser.add_argument("--desc", "-d", default=None, help="Optional description")

    open_parser = subparsers.add_parser("open", help="Show card details by name")
    open_parser.add_argument("card_name", help="Card name (partial match)")

    args = parser.parse_args()

    if args.cmd == "validate-csv":
        return cmd_validate_csv(args)

    params = auth()

    if args.cmd == "lists":
        return cmd_lists(args, params)
    if args.cmd == "cards":
        return cmd_cards(args, params)
    if args.cmd == "import-csv":
        return cmd_import_csv(args, params)
    if args.cmd == "move":
        return cmd_move(args, params)
    if args.cmd == "add":
        return cmd_add(args, params)
    if args.cmd == "open":
        return cmd_open(args, params)
    return 0


if __name__ == "__main__":
    sys.exit(main())
