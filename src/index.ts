import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAgent } from '@homie/agent';
import { loadConfig } from '@homie/config';
import { getErrorMessage } from '@homie/core';
import { createGateway } from '@homie/gateway';
import { createLogger, setLogLevel } from '@homie/observability';
import { createSessionStore, openDatabase } from '@homie/persistence';
import { createProviderRuntime } from '@homie/providers';
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
  const config = loadConfig();
  setLogLevel(config.app.logLevel as 'debug' | 'info' | 'warn' | 'error');

  log.info('Starting Homie', {
    provider: config.provider.kind,
    model: config.provider.model,
    logLevel: config.app.logLevel,
  });

  // --- Preflight checks (run in parallel) ---
  log.info('Running preflight checks...');

  const providerRuntime = createProviderRuntime(config.provider);

  const [telegramCheck, providerCheck] = await Promise.all([
    verifyTelegramToken(config.telegram.botToken),
    providerRuntime.check(),
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

  if (!providerCheck.available) {
    console.error(
      `\n  ✗ ${providerRuntime.name}: CLI not found.\n    Install and configure ${providerRuntime.name} before starting Homie.\n`,
    );
    preflightFailed = true;
  } else if (!providerCheck.authed) {
    console.error(
      `\n  ✗ ${providerRuntime.name}: not authenticated.\n    ${providerCheck.error ? `Detail: ${providerCheck.error}` : ''}\n`,
    );
    preflightFailed = true;
  } else {
    log.info('Provider verified', {
      provider: providerRuntime.name,
      version: providerCheck.version,
    });
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

  // Agent + Gateway
  const agent = createAgent(providerRuntime.adapter, {
    model: config.provider.model,
  });

  const gateway = createGateway({
    sessionStore,
    agent,
  });

  // Telegram
  const telegram = createTelegramAdapter({
    botToken: config.telegram.botToken,
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
