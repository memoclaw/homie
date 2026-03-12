import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAgent } from '@homie/agent';
import { loadConfig } from '@homie/config';
import { getErrorMessage } from '@homie/core';
import { createGateway } from '@homie/gateway';
import { createGitHubAdapter } from '@homie/github';
import { createLogger, setLogLevel } from '@homie/observability';
import { createSessionStore, openDatabase } from '@homie/persistence';
import { createProviderRuntime, detectProvider, type ProviderKind } from '@homie/providers';
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
    model: config.provider.model,
    logLevel: config.app.logLevel,
  });

  // --- Preflight checks ---
  log.info('Running preflight checks...');

  const [telegramCheck, providerRuntime] = await Promise.all([
    verifyTelegramToken(config.telegram.botToken),
    detectProvider(config.provider),
  ]);

  if (!telegramCheck.ok) {
    console.error(
      `\n  ✗ Telegram: ${telegramCheck.error}\n    Check TELEGRAM_BOT_TOKEN in your .env file.\n`,
    );
  } else {
    log.info('Telegram bot verified', { username: telegramCheck.username });
  }

  if (!providerRuntime) {
    console.error(
      '\n  ✗ No provider CLI found.\n    Install and authenticate Claude Code or Codex CLI before starting Homie.\n',
    );
  } else {
    log.info('Provider detected', {
      provider: providerRuntime.name,
    });
  }

  if (!telegramCheck.ok || !providerRuntime) {
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
  const agentCache = new Map<string, typeof agent>([
    [cacheKey(providerRuntime.kind, config.provider.model), agent],
  ]);

  const gateway = createGateway({
    sessionStore,
    agent,
    resolveAgent(selection) {
      const kind = normalizeProviderKind(selection.agentType) ?? providerRuntime.kind;
      const model = selection.agentModel?.trim() || config.provider.model;
      const key = cacheKey(kind, model);
      const cached = agentCache.get(key);
      if (cached) {
        return cached;
      }

      const runtime = createProviderRuntime({
        kind,
        model,
        extraArgs: config.provider.extraArgs,
      });
      const nextAgent = createAgent(runtime.adapter, { model });
      agentCache.set(key, nextAgent);
      return nextAgent;
    },
  });

  // Telegram
  const telegram = createTelegramAdapter({
    botToken: config.telegram.botToken,
    onEvent: gateway.handleEvent,
    dataDir,
  });
  await telegram.start();

  const github = createGitHubAdapter({
    enabled: config.github.enabled,
    workflowsDir: config.github.workflowsDir,
    onEvent: gateway.handleEvent,
    pollIntervalMs: config.github.pollIntervalSec * 1000,
    markReadOnHandled: true,
  });
  await github.start();

  log.info('Homie is running');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    await github.stop();
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

function normalizeProviderKind(kind?: string | null): ProviderKind | null {
  if (kind === 'claude-code' || kind === 'codex') {
    return kind;
  }
  return null;
}

function cacheKey(kind: ProviderKind, model: string): string {
  return `${kind}:${model}`;
}
