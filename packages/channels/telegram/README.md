# @homie/telegram

Telegram channel adapter using [grammy](https://grammy.dev) in polling mode. First channel in Homie — more channels planned.

## Features

- Text messages, photos, and documents with automatic file download
- Markdown to Telegram MarkdownV2 conversion with fallback to plain text
- Typing indicators and editable status messages for progress
- First-user lock in memory for simple single-user access control
- Bot command registration on startup

## Usage

```ts
import { createTelegramAdapter } from '@homie/telegram';

const telegram = createTelegramAdapter({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  onEvent: gateway.handleEvent,
  dataDir: './data',
});

await telegram.start();
```
