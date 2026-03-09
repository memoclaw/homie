# @homie/observability

Structured JSON logger with level filtering.

## Usage

```ts
import { createLogger, setLogLevel } from '@homie/observability';

setLogLevel('debug'); // debug | info | warn | error

const log = createLogger('my-module');
log.info('Server started', { port: 3000 });
// → {"ts":"...","level":"info","module":"my-module","msg":"Server started","port":3000}
```

Log entries below the global level are silently dropped.
