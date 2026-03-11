# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev              # Start server
bun test                 # Run all tests (bun test runner)
bun test packages/gateway/src/commands.test.ts  # Run a single test file
bun tsc --noEmit         # Type check
bun run lint             # Biome lint
bun run lint:fix         # Biome lint + auto-fix
bun run format           # Biome format
```

## Architecture

Homie is an interrupt-first Telegram agent that wraps local coding CLIs like Codex and Claude Code. Users send messages via Telegram, Homie routes them through a gateway to the local provider, and returns results. The latest message always wins for a chat.

### Data flow

```
Telegram message → TelegramAdapter → Gateway.handleEvent()
  ├─ Command (/status, /abort, /clear, /help) → CommandHandler → reply
  └─ Chat message → RequestRunner.submit() (interrupts active request)
       → SessionStore (active session + history)
       → Agent.run() → buildMessages() → provider.generate()
       → spawns provider CLI and parses streamed output
       → reply to user
```

### Package dependency graph

```
core (types, interfaces, errors) ← everything depends on this
config (YAML loader) ← src/
observability (logger) ← most packages
persistence (SQLite stores) ← gateway, src/
providers (claude CLI wrapper) ← agent, src/
agent (context + provider orchestration) ← gateway, src/
gateway (routing, commands, request-runner) ← src/, telegram
channels/telegram (grammy adapter) ← src/
```

### Key patterns

- **No classes.** All modules use factory functions returning interfaces.
- **No build step.** Bun resolves `.ts` workspace imports directly via `tsconfig.json` path aliases (`@homie/core` → `./packages/core/src`).
- **SQLite via `bun:sqlite`** with WAL mode. Inline migrations run on `openDatabase()`. Stores are synchronous under the hood but expose async interfaces.
- **Interrupt-first requests.** One request runs at a time per chat. A new message aborts the old request and starts immediately.
- **Sessions.** Chats can have multiple stored sessions, but only one active session at a time. `/clear` creates a new active session without deleting old history.
- **Telegram ownership.** The first Telegram user to message the bot becomes the only allowed user until restart.
- **Preflight checks:** Server startup validates Telegram bot token (`getMe` API) and Claude Code auth (minimal prompt) in parallel before booting.

### Conventions

- Commit messages: `type: description` (e.g., `feat:`, `fix:`, `chore:`)
- Formatting: Biome — 2-space indent, single quotes, semicolons, 100 char line width
- TypeScript strict mode with `noUncheckedIndexedAccess`
- Channel adapters build their own `ReplyFn` and `ProgressHandler` internally, then pass them to the gateway's `EventHandler`
- `EventHandler` from core is the contract between channels and the gateway — channels never import gateway directly
