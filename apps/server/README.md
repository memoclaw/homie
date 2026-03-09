# @homie/server

Main entrypoint that wires all packages together and boots the system.

## Boot sequence

1. Load config from `config/system.yaml`
2. Open SQLite database (runs migrations)
3. Create all stores (sessions, kv, memory, usage)
4. Detect and initialize Claude Code CLI provider
5. Create agent, gateway, and Telegram adapter
6. Start Telegram polling
7. Register graceful shutdown handlers (SIGINT, SIGTERM)

## Usage

```bash
bun run dev
```

Requires `TELEGRAM_BOT_TOKEN` in `.env` and the `claude` CLI installed.
