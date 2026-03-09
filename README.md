# 🫂 Homie

Your AI dev mate. Always on, never in the way.

Text your homie a coding task from Telegram. Walk away. Come back to it done.

No IDE required. No terminal open. No babysitting. Just results.

## Why Homie

- **Telegram-native** — your IDE is your phone
- **Async by design** — fire and forget, get results when you're ready
- **Zero API cost** — rides your existing Claude Pro/Max subscription
- **Multi-session** — juggle tasks like chat threads
- **Interruptible** — send a new message mid-task, homie pivots instantly
- **Self-hosted** — your machine, your data, your agent

## Quick start

```bash
bun install
cp .env.example .env   # add your TELEGRAM_BOT_TOKEN
bun run dev
```

That's it. No API keys needed beyond Telegram. Homie wraps your local `claude` CLI — it handles its own auth.

## Talk to it

Send any message and homie gets to work. Send photos or files and homie can read those too. Use commands when you need control:

```
/new [name]      Start a new session
/use <name>      Switch sessions
/sessions        List all sessions
/status          Session info and token usage
/ping            Check if homie is alive
/help            Show commands
```

Busy? Just send another message — homie interrupts the current task and picks up your new one.

## How it works

```
You (Telegram)
  └── Homie (routing, sessions, persistence)
        └── Claude Code CLI
              └── Your codebase
```

Homie spawns Claude Code as a subprocess, streams its progress, and delivers the result back to your chat. Everything is tracked:

- **Sessions** — SQLite-backed, multi-session per chat, named and switchable
- **Usage** — token counts tracked per session and lifetime
- **Memory** — persistent context learned across conversations
- **Interrupts** — new messages kill the running process and start fresh
- **Resilience** — session resume with full history fallback, crash retry with backoff

## Configure

All settings in `config/system.yaml`:

| Setting | Default | What it does |
|---------|---------|-------------|
| `telegram.botToken` | — | Set via `TELEGRAM_BOT_TOKEN` env var (required) |
| `provider.model` | `""` | Override Claude Code's default model |
| `memory.enabled` | `true` | Persistent context across sessions |
| `agent.maxHistoryMessages` | `20` | How much conversation to keep in context |

## Project structure

```
apps/
  server/         Entrypoint — wires everything, boots, shuts down gracefully
  cli/            Admin CLI (status, sessions)
packages/
  core/           Types, interfaces, events, errors
  config/         YAML + env var loader (zod)
  observability/  Structured JSON logger
  persistence/    SQLite stores (sessions, messages, usage, kv, memory)
  sessions/       Session lifecycle
  providers/      Claude Code CLI adapter
  agent/          Context builder + provider orchestration
  gateway/        Event routing, interrupts, command handling
  channels/
    telegram/     Grammy adapter (polling, photos, documents)
```

Bun monorepo. TypeScript strict. SQLite via `bun:sqlite` (WAL mode). 6 external deps.

## Dev

```bash
bun run dev         # start
bun test            # run tests
bun tsc --noEmit    # type-check
bun run lint        # check (biome)
bun run lint:fix    # auto-fix
bun run format      # format
```
