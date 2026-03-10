# 🫂 Homie

Your AI dev mate. Local AI agents, remote control.

> **Warning** — Under active development. Schema and config may change without notice.

A self-hosted agent hub that connects your local AI coding agents to Telegram. Send a message from your phone, Homie runs it on your machine through Claude Code, and sends back the result.

No API keys. No cloud billing. Just your existing CLI subscriptions.

## Why Homie

- **Remote control** — Telegram is your interface, your machine does the work
- **Local agents** — wraps CLI agents you already have (Claude Code today, more coming)
- **Zero API cost** — rides your existing subscriptions, no billing keys needed
- **Async by design** — fire and forget, check results when you're ready
- **Self-hosted** — your machine, your data, your agents

## Install

### From source

```bash
git clone https://github.com/memoclaw/homie.git
cd homie
bun install
cp .env.example .env   # add your TELEGRAM_BOT_TOKEN
bun run dev
```

### Build and link globally

```bash
bun run build          # outputs dist/cli.js
bun link               # makes `homie` available globally
homie
```

Requires [Bun](https://bun.sh) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated. Homie verifies your Telegram token and Claude Code auth on startup before accepting messages.

## Every message is a task

Every message you send becomes a task. Homie runs it and replies with the result.

If Homie is already working on something, your message gets queued and runs next — up to 10 deep. Send a photo or file and Homie downloads it to a temp path so the agent can read it natively.

```
/list            Recent tasks and their status
/status          Running task, queue, and uptime
/abort           Cancel the running task and clear the queue
/help            Show commands
```

## How it works

```
Telegram message
  → Adapter (parse text, photos, documents)
    → Gateway (resolve session, route command or submit task)
      → Task runner (queue, execute one at a time per chat)
        → Agent (build message history, call provider)
          → Claude Code CLI (spawn subprocess, stream JSON)
            → parse response → reply to user
```

**Provider.** Homie spawns `claude` with `--output-format stream-json` and streams stdout line by line. It parses tool starts (to show "Reading files..." status), text deltas, token usage, and cost. The subprocess runs with `--dangerously-skip-permissions` so the agent can work autonomously.

**Session continuity.** Each chat gets one hidden session. On the first task, Homie sends the full conversation history. On subsequent tasks, it attempts `--resume` to reuse the agent's cached context. If resume fails, it falls back to replaying full history with `--session-id`. If the agent crashes, Homie waits 3 seconds and retries once.

**Queue.** One task runs at a time per chat. The rest sit in an in-memory queue (also tracked in SQLite so status survives restarts). When a task finishes, the next one starts automatically. Aborting kills the running task and clears the entire queue.

**Progress.** While a task runs, Homie sends typing indicators every 4 seconds and a status message every 30 seconds showing elapsed time and what the agent is doing ("Reading files...", "Editing code...", "Running commands...").

## Configure

`config/system.yaml`:

| Setting | Default | What it does |
|---------|---------|-------------|
| `telegram.botToken` | — | `TELEGRAM_BOT_TOKEN` env var (required) |
| `telegram.allowedChatIds` | `[]` | Restrict to specific chats (empty = allow all) |
| `provider.model` | `""` | Override the agent's default model |
| `provider.extraArgs` | `[]` | Extra CLI flags passed to the agent |

## Project structure

```
src/                  Boot, preflight checks, wiring, graceful shutdown
bin/                  CLI entry point (homie)
packages/
  core/             Types (Task, Session, Message), interfaces, errors
  config/           YAML loader with ${ENV_VAR} interpolation (zod)
  observability/    Structured JSON logger
  persistence/      SQLite stores — tasks, sessions, messages, usage, kv
  sessions/         Session manager — one session per chat, history, status
  providers/        Claude Code CLI adapter (spawn, stream, parse, retry)
  agent/            Context builder — system prompt + history → provider messages
  gateway/          Task runner (queue + execute), command handler
  channels/
    telegram/       Grammy adapter — polling, photos, documents, markdown
```

Bun monorepo. TypeScript strict. No build step — Bun resolves `.ts` imports via path aliases. SQLite in WAL mode with inline migrations.

## Dev

```bash
bun run dev         # start server
bun test            # run all tests
bun tsc --noEmit    # type-check
bun run lint        # biome check
bun run lint:fix    # biome auto-fix
```
