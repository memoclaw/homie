# @homie/sessions

Session lifecycle manager built on top of `SessionStore` from core.

Handles session resolution (get-or-create), named sessions, switching, message history, status transitions, and stuck session recovery.

## Usage

```ts
import { createSessionManager } from '@homie/sessions';

const manager = createSessionManager(sessionStore);

const session = await manager.resolveSession('telegram', 'chat123');
await manager.addMessage(session.id, 'in', 'Hello');
const history = await manager.getHistory(session.id, 20);
```
