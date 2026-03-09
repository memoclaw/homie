# @homie/cli

Admin CLI for inspecting Homie state locally. Not a chat interface — use Telegram for that.

## Commands

```bash
bun run cli status     # Show session count and last startup time
bun run cli sessions   # List all sessions with channel, chat ID, and timestamps
bun run cli help       # Show usage
```

Reads the same `config/system.yaml` and SQLite database as the server.
