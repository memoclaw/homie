# 🫂 Homie

Your AI dev mate. Local agents, remote control.

> **Warning** — Homie is under active development. APIs, config format, and database schema may change without notice. Not yet recommended for production use.

A self-hosted agent hub that connects your local AI coding agents to Telegram. Control Claude Code, Codex, Gemini CLI — and whatever comes next — without sitting in front of a terminal. 

No API keys. No billing. Just your existing subscriptions.

## Why Homie

- **Remote control** — Telegram is your interface, your machine does the work
- **Local agents** — wraps CLI agents you already have (Claude Code today, Codex and Gemini CLI coming)
- **Zero API cost** — rides your existing subscriptions, no billing keys needed
- **Async by design** — fire and forget, check results when you're ready
- **Multi-session** — juggle tasks like chat threads
- **Self-hosted** — your machine, your data, your agents

## Quick start

```bash
bun install
cp .env.example .env   # add your TELEGRAM_BOT_TOKEN
bun run dev
```

Homie runs preflight checks on startup — verifies your Telegram token and that your local agent CLI is installed and authenticated.

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
  └── Homie (routing, sessions, memory, persistence)
        └── Local agent CLI (Claude Code, Codex, Gemini CLI, ...)
              └── Your codebase
```

Homie spawns your local agent as a subprocess, streams its progress, and delivers the result back to your chat. The agent handles its own loop (think → tool call → observe → repeat). Homie handles everything around it:

- **Sessions** — SQLite-backed, multi-session per chat, named and switchable
- **Usage** — token counts tracked per session and lifetime
- **Memory** — persistent context learned across conversations
- **Interrupts** — new messages kill the running agent and start fresh
- **Resilience** — session resume with full history fallback, crash retry with backoff

## Configure

All settings in `config/system.yaml`:

| Setting | Default | What it does |
|---------|---------|-------------|
| `telegram.botToken` | — | Set via `TELEGRAM_BOT_TOKEN` env var (required) |
| `provider.model` | `""` | Override the agent's default model |
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
  providers/      Agent CLI adapters (Claude Code, more coming)
  agent/          Context builder + provider orchestration
  gateway/        Event routing, interrupts, command handling
  channels/
    telegram/     Grammy adapter (polling, photos, documents)
```

Bun monorepo. TypeScript strict. SQLite via `bun:sqlite` (WAL mode).

## Dev

```bash
bun run dev         # start
bun test            # run tests
bun tsc --noEmit    # type-check
bun run lint        # check (biome)
bun run lint:fix    # auto-fix
```
