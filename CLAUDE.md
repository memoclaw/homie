# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev              # Start server (apps/server)
bun test                 # Run all tests (bun test runner)
bun test packages/gateway/src/commands.test.ts  # Run a single test file
bun tsc --noEmit         # Type check
bun run lint             # Biome lint
bun run lint:fix         # Biome lint + auto-fix
bun run format           # Biome format
```

## Architecture

Homie is an async Telegram agent that wraps the local `claude` CLI. Users send messages via Telegram, Homie routes them through a gateway to Claude Code, and returns results. Every message becomes a task — there is no casual chat mode.

### Data flow

```
Telegram message → TelegramAdapter → Gateway.handleEvent()
  ├─ Command (/list, /status, etc.) → CommandHandler → reply
  └─ Chat message → TaskRunner.submit() (queued, background)
       → SessionManager (history)
       → Agent.run() → buildMessages() → ClaudeCodeProvider.generate()
       → spawns `claude` CLI with stream-json output
       → parse response, save usage
       → reply to user
```

### Package dependency graph

```
core (types, interfaces, errors) ← everything depends on this
config (YAML loader) ← server
observability (logger) ← most packages
persistence (SQLite stores) ← sessions, gateway, server
sessions (session manager) ← gateway, server
providers (claude CLI wrapper) ← agent, server
agent (context + provider orchestration) ← gateway, server
gateway (routing, commands, task-runner) ← server, telegram
channels/telegram (grammy adapter) ← server
```

### Key patterns

- **No classes.** All modules use factory functions returning interfaces (e.g., `createSessionManager(store): SessionManager`).
- **No build step.** Bun resolves `.ts` workspace imports directly via `tsconfig.json` path aliases (`@homie/core` → `./packages/core/src`).
- **SQLite via `bun:sqlite`** with WAL mode. Inline migrations run on `openDatabase()`. Stores are synchronous under the hood but expose async interfaces.
- **Task queue.** One task runs at a time per chat. New messages queue up (max 10). Sessions are hidden — one per chat, used internally for Claude CLI `--session-id` continuity.
- **Provider resilience:** Session resume via `--resume`, fallback to full history replay, 1 crash retry with 3s backoff.
- **Preflight checks:** Server startup validates Telegram bot token (`getMe` API) and Claude Code auth (minimal prompt) in parallel before booting.

### Conventions

- Commit messages: `type: description` (e.g., `feat:`, `fix:`, `chore:`)
- Formatting: Biome — 2-space indent, single quotes, semicolons, 100 char line width
- TypeScript strict mode with `noUncheckedIndexedAccess`
- Channel adapters build their own `ReplyFn` and `ProgressHandler` internally, then pass them to the gateway's `EventHandler`
- `EventHandler` from core is the contract between channels and the gateway — channels never import gateway directly
