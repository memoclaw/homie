# @homie/core

Shared types, interfaces, and error classes used across all Homie packages.

Defines the contracts between channels, providers, and persistence.

## Exports

### Types

- `Session`, `Message` — domain models
- `MessageDirection` — union types
- `Attachment` — file attachment metadata
- `InboundEvent`, `ChatMessageEvent`, `CommandEvent` — inbound event types

### Interfaces

- `ChannelAdapter` — start/stop/sendMessage for a messaging platform
- `ProviderAdapter` — generate responses from a local agent CLI
- `SessionStore` — persistence interface for sessions and messages
- `EventHandler`, `ReplyFn`, `ProgressHandler`, `ProgressCallback` — callback types
- `ProviderRequest`, `ProviderResponse` — provider I/O

### Errors

- `HomieError` — base error with `code` field
- `ConfigError`, `PersistenceError`, `ProviderError`, `ChannelError`, `AbortError` — typed errors
- `getErrorMessage(err)` — safely extract message from unknown errors

## Usage

```ts
import type { Session, Message, ChannelAdapter, ProviderAdapter } from '@homie/core';
import { ProviderError, getErrorMessage } from '@homie/core';
```
