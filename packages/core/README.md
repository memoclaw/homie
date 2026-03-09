# @homie/core

Shared types, interfaces, and error classes used across all Homie packages.

## Exports

### Types

- `Session`, `Message`, `UsageStats` — domain models
- `SessionKind`, `MessageDirection`, `SessionStatus` — union types
- `Attachment` — file attachment metadata
- `InboundEvent`, `ChatMessageEvent`, `CommandEvent` — inbound event types

### Interfaces

- `ChannelAdapter` — start/stop/sendMessage for a messaging platform
- `ProviderAdapter` — generate responses from an AI provider
- `SessionStore` — persistence interface for sessions and messages
- `EventHandler`, `ReplyFn`, `ProgressHandler`, `ProgressCallback` — callback types
- `ProviderRequest`, `ProviderResponse` — provider I/O

### Errors

- `HomieError` — base error with `code` field
- `ConfigError`, `PersistenceError`, `ProviderError`, `ChannelError`, `AbortError` — typed errors
- `getErrorMessage(err)` — safely extract message from unknown errors

## Usage

```ts
import type { Session, ChannelAdapter, ProviderAdapter } from '@homie/core';
import { ProviderError, getErrorMessage } from '@homie/core';
```
