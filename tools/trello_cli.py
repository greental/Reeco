#!/usr/bin/env python3
"""
Trello CLI for the Reeco assignment board.

Uses TRELLO_API_KEY and TRELLO_TOKEN from environment or tools/.env.
Default board: https://trello.com/b/UZMr7YiD/reeco
"""

import argparse
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
    params = auth()

    if args.cmd == "lists":
        return cmd_lists(args, params)
    if args.cmd == "cards":
        return cmd_cards(args, params)
    if args.cmd == "move":
        return cmd_move(args, params)
    if args.cmd == "add":
        return cmd_add(args, params)
    if args.cmd == "open":
        return cmd_open(args, params)
    return 0


if __name__ == "__main__":
    sys.exit(main())
