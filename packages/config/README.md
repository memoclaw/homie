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
| `provider` | `kind`, `model`, `extraArgs`            |

## Usage

```ts
import { loadConfig } from '@homie/config';

const config = loadConfig(); // reads config/system.yaml
```

## Provider examples

Claude Code:

```yaml
provider:
  kind: claude-code
  model: opus
  extraArgs: []
```

Codex CLI:

```yaml
provider:
  kind: codex
  model: ""
  extraArgs:
    - --skip-git-repo-check
```

Codex CLI with an explicit model pin:

```yaml
provider:
  kind: codex
  model: gpt-5.4
  extraArgs: []
```
