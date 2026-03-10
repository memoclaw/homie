import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAgent } from '@homie/agent';
import { loadConfig } from '@homie/config';
import { getErrorMessage } from '@homie/core';
import { createGateway } from '@homie/gateway';
import { createLogger, setLogLevel } from '@homie/observability';
import {
  createSessionStore,
  createTaskStore,
  createUsageStore,
  openDatabase,
} from '@homie/persistence';
import { checkClaudeCode, createClaudeCodeProvider } from '@homie/providers';
import { createTelegramAdapter } from '@homie/telegram';

const log = createLogger('server');

async function verifyTelegramToken(
  token: string,
): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await resp.json()) as {
      ok: boolean;
      result?: { username: string };
      description?: string;
    };
    if (data.ok && data.result) {
      return { ok: true, username: data.result.username };
    }
    return { ok: false, error: data.description ?? 'Invalid bot token' };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

async function main() {
  const startedAt = new Date();
  const config = loadConfig();
  setLogLevel(config.app.logLevel as 'debug' | 'info' | 'warn' | 'error');

  log.info('Starting Homie', {
    model: config.provider.model,
    logLevel: config.app.logLevel,
  });

  // --- Preflight checks (run in parallel) ---
  log.info('Running preflight checks...');

  const [telegramCheck, claudeCheck] = await Promise.all([
    verifyTelegramToken(config.telegram.botToken),
    checkClaudeCode(),
  ]);

  let preflightFailed = false;

  if (!telegramCheck.ok) {
    console.error(
      `\n  ✗ Telegram: ${telegramCheck.error}\n    Check TELEGRAM_BOT_TOKEN in your .env file.\n`,
    );
    preflightFailed = true;
  } else {
    log.info('Telegram bot verified', { username: telegramCheck.username });
  }

  if (!claudeCheck.available) {
    console.error(
      '\n  ✗ Claude Code: CLI not found.\n    Install it: https://docs.anthropic.com/en/docs/claude-code\n',
    );
    preflightFailed = true;
  } else if (!claudeCheck.authed) {
    console.error(
      `\n  ✗ Claude Code: not authenticated.\n    Run \`claude\` to log in.\n    ${claudeCheck.error ? `Detail: ${claudeCheck.error}` : ''}\n`,
    );
    preflightFailed = true;
  } else {
    log.info('Claude Code verified', { version: claudeCheck.version });
  }

  if (preflightFailed) {
    process.exit(1);
  }

  // --- Boot ---

  // Ensure data directory
  const dataDir = resolve(config.app.dataDir);
  mkdirSync(dataDir, { recursive: true });

  // Database
  const dbPath = resolve(dataDir, 'homie.db');
  const db = openDatabase(dbPath);

  // Stores
  const sessionStore = createSessionStore(db);
  const usageStore = createUsageStore(db);
  const taskStore = createTaskStore(db);

  // Reset stuck state from previous run
  const [stuck, stuckTasks] = await Promise.all([
    sessionStore.resetStuckSessions(),
    taskStore.resetStuckTasks(),
  ]);
  if (stuck > 0) {
    log.info('Reset stuck sessions from previous run', { count: stuck });
  }
  if (stuckTasks > 0) {
    log.info('Reset stuck tasks from previous run', { count: stuckTasks });
  }

  const provider = createClaudeCodeProvider({
    model: config.provider.model,
    extraArgs: config.provider.extraArgs,
  });

  // Agent + Gateway
  const agent = createAgent(provider, {
    model: config.provider.model,
  });

  const gateway = createGateway({
    sessionStore,
    agent,
    taskStore,
    usageStore,
    model: config.provider.model,
    startedAt,
  });

  // Telegram
  const telegram = createTelegramAdapter({
    botToken: config.telegram.botToken,
    allowedChatIds: config.telegram.allowedChatIds,
    onEvent: gateway.handleEvent,
    dataDir,
  });
  await telegram.start();

  log.info('Homie is running');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    await telegram.stop();
    db.close();
    log.info('Goodbye');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
