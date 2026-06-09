# Trello CLI for Reeco

Repo-local Trello helper for AI agents and maintainers working on the Reeco procurement assignment.

Default board: [Reeco](https://trello.com/b/UZMr7YiD/reeco) (`UZMr7YiD`).

## One-time setup

1. Get Trello credentials from [https://trello.com/app-key](https://trello.com/app-key):
   - Copy your **API Key**.
   - Click the **Token** link, allow access, and copy the token.
2. Install the Python dependency:

   ```bash
   pip install -r tools/requirements-trello.txt
   ```

3. Store credentials using either environment variables or a local file:
   - Environment variables: `TRELLO_API_KEY` and `TRELLO_TOKEN`
   - Local file: copy `tools/.env.example` to `tools/.env` and fill in values.

Do not commit `tools/.env` or any Trello credentials.

## Usage

Run from the repository root:

```bash
python tools/trello_cli.py lists
python tools/trello_cli.py cards
python tools/trello_cli.py open "partial card title"
python tools/trello_cli.py add "List Name" "Card title" --desc "Optional description"
python tools/trello_cli.py move "partial card title" "Target List Name"
```

The default board is `UZMr7YiD`. To target a different board explicitly:

```bash
python tools/trello_cli.py --board UZMr7YiD lists
```

## Agent workflow

- Prefer read commands first: `lists`, `cards`, or `open`.
- Before write commands (`add`, `move`), verify the target list/card names.
- If multiple matches are reported, ask for clarification instead of guessing.
