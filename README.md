# 🫂 Homie

Your AI dev mate. Local AI agents, remote control.

> **Warning** — Under active development. Schema and config may change without notice.

A self-hosted agent hub that connects your local AI coding agents to Telegram. Send a message from your phone, Homie runs it on your machine through Claude Code or Codex CLI, and sends back the result.

No API keys. No cloud billing. Just your existing CLI subscriptions.

## Why Homie

- **Remote control** — Telegram is your interface, your machine does the work
- **Local agents** — wraps CLI agents you already have (Claude Code today, more coming)
- **Zero API cost** — rides your existing subscriptions, no billing keys needed
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

Requires [Bun](https://bun.sh) and a supported local agent CLI installed and authenticated. Homie verifies your Telegram token and the configured provider on startup before accepting messages.

## Every message is a priority request

Every message you send starts a request. Homie runs it and replies with the result. Send a photo or file and Homie downloads it to a temp path so the agent can read it natively.

The first Telegram user to message the bot becomes the only allowed user until Homie restarts.

```
/status          Current request
/abort           Interrupt the active request
/clear           Start a new session
/help            Show commands
```

## How it works

```
Telegram message
  → Adapter (parse text, photos, documents)
    → Gateway (resolve active session, route command or submit request)
      → Request runner (interrupt previous request, execute latest request per chat)
        → Agent (build message history, call provider)
          → Provider CLI (spawn subprocess, stream JSON/JSONL)
            → parse response → reply to user
```

**Provider.** Homie wraps local agent CLIs behind a shared runtime contract. Claude Code uses `--output-format stream-json`; Codex uses `exec --json`. Homie parses streamed events and final output, then forwards progress and replies back to Telegram.

**Session continuity.** Each chat has one active session. On the first request in a session, Homie sends the full conversation history. On subsequent requests, it attempts the provider's native resume flow. If resume fails, it falls back to replaying full history in a fresh request. Claude retries once after a crash; Codex currently fails fast.

**Interrupt-first flow.** One request is active per chat. A new message interrupts the active request and starts a fresh request immediately. Interrupted partial output is not added to conversation history.

**Fresh context.** `/clear` starts a brand new session for the chat without deleting old history. The next message runs from empty context.

**Progress.** While a request is active, Homie sends typing indicators every 4 seconds and a status message every 30 seconds showing elapsed time and what the agent is doing ("Reading files...", "Editing code...", "Running commands...").

## Configure

`config/system.yaml`:

| Setting | Default | What it does |
|---------|---------|-------------|
| `telegram.botToken` | — | `TELEGRAM_BOT_TOKEN` env var (required) |
| `provider.kind` | `claude-code` | Which CLI backend to use: `claude-code` or `codex` |
| `provider.model` | `""` | Override the provider's default model; leave empty to follow the CLI default |
| `provider.extraArgs` | `[]` | Extra CLI flags passed to the agent |

Recommended `provider.extraArgs`:
- `claude-code`: usually leave empty; add flags like `--verbose` only if you need provider-specific behavior
- `codex`: useful defaults are `["--skip-git-repo-check"]` for non-git directories, or sandbox-related flags if you want stricter execution

Recommended `provider.model`:
- `claude-code`: pin a Claude model only if you want reproducible behavior
- `codex`: leave empty by default so Codex CLI can track its preferred default; if you want an explicit pin, use `gpt-5.4`

## Project structure

```
src/                  Boot, preflight checks, wiring, graceful shutdown
bin/                  CLI entry point (homie)
packages/
  core/             Types (Session, Message), interfaces, errors
  config/           YAML loader with ${ENV_VAR} interpolation (zod)
  observability/    Structured JSON logger
  persistence/      SQLite stores — sessions, active sessions, messages
  providers/        Provider runtimes for Claude Code and Codex CLI
  agent/            Context builder — system prompt + history → provider messages
  gateway/          Request runner (interrupt + execute), command handler
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
