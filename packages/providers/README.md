# @homie/providers

Local agent CLI adapters and runtime factories that implement `ProviderAdapter` from core.

Each provider wraps a local CLI agent as a subprocess — no API keys or billing needed. The agent handles its own loop; Homie handles context, sessions, and delivery.

## Supported providers

### Claude Code

Wraps the local `claude` CLI with streaming JSON output, session resume, crash recovery, and account usage support.

- Session continuity via `--resume` / `--session-id`
- Resume failure fallback: retries with full flattened history
- Crash recovery: 1 retry with 3s backoff, respects abort signals
- Streaming progress events (tool use, text deltas)
- Auth and availability checks via `checkClaudeCode()`
- Account usage via `createClaudeUsageProvider()`

Recommended `extraArgs`:
- Usually empty
- Add flags like `--verbose` only when you need Claude-specific CLI behavior

### Codex CLI

Wraps the local `codex` CLI with JSONL output, resume support, and account usage from persisted session rate-limit snapshots.

- Session continuity via `codex exec resume`
- Resume failure fallback: retries with full flattened history
- Streaming final agent output and token usage
- Auth and availability checks via `checkCodexCli()`
- Account usage via `createCodexUsageProvider()`

Recommended `extraArgs`:
- `--skip-git-repo-check` if you want Homie to work outside git repos
- Avoid duplicating `--json` or resume flags; the adapter manages those

Recommended `model`:
- Leave it empty to follow the Codex CLI default
- If you want an explicit pin, use `gpt-5.4`

## Planned providers

- Gemini CLI

## Usage

```ts
import { createProviderRuntime } from '@homie/providers';

const runtime = createProviderRuntime({
  kind: 'codex',
  model: '',
  extraArgs: [],
});

const status = await runtime.check(); // { available, authed, version }
const provider = runtime.adapter;
```
