# @homie/gateway

Routes inbound events from any channel to commands or the request runner. The central dispatch layer between channels and local agent CLIs.

## Components

| Factory                | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `createGateway`        | Main event router — resolves active sessions, dispatches commands or requests |
| `createRequestRunner`  | Interrupts the active request and starts the latest message per chat |
| `createCommandHandler` | Handles `/status`, `/abort`, `/clear`, `/help`               |

## Flow

```
InboundEvent (from any channel)
  → Gateway
    ├─ Command? → CommandHandler
    └─ Chat?    → RequestRunner.submit() (interrupts active request, starts latest input)
```

## Usage

```ts
import { createGateway } from '@homie/gateway';

const gateway = createGateway({ sessionStore, agent });
await gateway.handleEvent(event, reply, progress);
```
