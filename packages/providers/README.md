# @homie/providers

Local agent CLI adapters that implement `ProviderAdapter` from core.

Each provider wraps a local CLI agent as a subprocess — no API keys or billing needed. The agent handles its own loop; Homie handles context, sessions, and delivery.

## Claude Code (current)

Wraps the local `claude` CLI with streaming JSON output, session resume, and crash recovery.

- Session continuity via `--resume` / `--session-id`
- Resume failure fallback: retries with full flattened history
- Crash recovery: 1 retry with 3s backoff, respects abort signals
- Streaming progress events (tool use, text deltas)
- Title generation via lightweight CLI call
- Auth and availability checks via `checkClaudeCode()`

## Planned providers

- Codex CLI
- Gemini CLI

## Usage

```ts
import { createClaudeCodeProvider, checkClaudeCode } from '@homie/providers';

const status = await checkClaudeCode(); // { available, authed, version }
const provider = createClaudeCodeProvider({ model: 'opus', extraArgs: [] });
```
