# @homie/server

Main entrypoint that wires all packages together and boots the system.

## Boot sequence

1. Load config from `config/system.yaml`
2. Run preflight checks in parallel (Telegram token, agent CLI auth)
3. Open SQLite database (runs migrations)
4. Create all stores (sessions, kv, memory, usage)
5. Initialize the configured agent CLI provider
6. Create agent, gateway, and channel adapters
7. Start Telegram polling
8. Register graceful shutdown handlers (SIGINT, SIGTERM)

## Usage

```bash
bun run dev
```

Requires `TELEGRAM_BOT_TOKEN` in `.env` and a local agent CLI (e.g., `claude`) installed and authenticated.
