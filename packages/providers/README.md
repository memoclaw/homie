# @homie/providers

AI provider adapters that implement `ProviderAdapter` from core.

## Claude Code provider

Wraps the local `claude` CLI with streaming JSON output, session resume, and crash recovery.

Features:
- Session continuity via `--resume` / `--session-id`
- Resume failure fallback: retries with full flattened history
- Crash recovery: 1 retry with 3s backoff, respects abort signals
- Streaming progress events (tool use, text deltas)
- Title generation via lightweight CLI call

## Usage

```ts
import { createClaudeCodeProvider, detectClaudeCli } from '@homie/providers';

const cliPath = await detectClaudeCli(); // null if not installed
const provider = createClaudeCodeProvider({ model: 'opus', extraArgs: [] });
```
