# @homie/persistence

SQLite-backed stores for sessions, active sessions, and messages.

Uses `bun:sqlite` with WAL mode and inline migrations.

## Stores

| Factory              | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `createSessionStore` | Sessions, active session pointers, and messages       |

## Usage

```ts
import { openDatabase, createSessionStore } from '@homie/persistence';

const db = openDatabase('./data/homie.db'); // runs migrations automatically
const sessions = createSessionStore(db);
```
