# @homie/core

Shared types, interfaces, and error classes used across all Homie packages.

Defines the contracts between channels, providers, and persistence — any local agent CLI or messaging platform plugs in through these interfaces.

## Exports

### Types

- `Session`, `Message`, `Task`, `UsageStats` — domain models
- `SessionStatus`, `MessageDirection`, `TaskStatus` — union types
- `Attachment` — file attachment metadata
- `InboundEvent`, `ChatMessageEvent`, `CommandEvent` — inbound event types

### Interfaces

- `ChannelAdapter` — start/stop/sendMessage for a messaging platform
- `ProviderAdapter` — generate responses from a local agent CLI
- `SessionStore` — persistence interface for sessions and messages
- `TaskStore` — persistence interface for task queue and history
- `EventHandler`, `ReplyFn`, `ProgressHandler`, `ProgressCallback` — callback types
- `ProviderRequest`, `ProviderResponse` — provider I/O

### Errors

- `HomieError` — base error with `code` field
- `ConfigError`, `PersistenceError`, `ProviderError`, `ChannelError`, `AbortError` — typed errors
- `getErrorMessage(err)` — safely extract message from unknown errors

## Usage

```ts
import type { Session, Task, ChannelAdapter, ProviderAdapter } from '@homie/core';
import { ProviderError, getErrorMessage } from '@homie/core';
```
