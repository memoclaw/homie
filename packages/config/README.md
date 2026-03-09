# @homie/config

YAML configuration loader with environment variable interpolation and zod validation.

## What it does

1. Reads `config/system.yaml` (or a custom path)
2. Interpolates `${ENV_VAR}` placeholders from `process.env`
3. Validates against a zod schema
4. Returns a typed `AppConfig` object

## Config sections

| Section    | Key fields                              |
| ---------- | --------------------------------------- |
| `app`      | `logLevel`, `dataDir`                   |
| `telegram` | `botToken`, `allowedChatIds`            |
| `provider` | `model`, `extraArgs`                    |

## Usage

```ts
import { loadConfig } from '@homie/config';

const config = loadConfig(); // reads config/system.yaml
```
