import type { EventHandler } from '@homie/core';
import { ChannelError } from '@homie/core';
import { createLogger } from '@homie/observability';
import { createGitHubClient, type GitHubClient } from './client';
import { matchGitHubWorkflow } from './matcher';
import { buildChatId, type QueuedGitHubEvent } from './notification';
import { dispatchQueuedGitHubEvent } from './queue-dispatch';
import type { LoadedGitHubWorkflow, WebhookOptions } from './types';
import { mapWebhookEvent, type WebhookEvent } from './webhook-mapper';
import { createWebhookServer, type WebhookServer } from './webhook-server';
import { discoverGitHubWorkflows } from './workflow-discovery';

const log = createLogger('github');

const MAX_QUEUE_SIZE = 100;

export interface GitHubAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface GitHubAdapterOptions {
  enabled: boolean;
  workflowsDir: string;
  onEvent: EventHandler;
  webhook: WebhookOptions;
  token: string;
  createClient?: (token: string) => GitHubClient;
  createWebhookServer?: (opts: Parameters<typeof createWebhookServer>[0]) => WebhookServer;
  discoverWorkflows?: (workflowsDir: string) => Promise<LoadedGitHubWorkflow[]>;
}

export function createGitHubAdapter(opts: GitHubAdapterOptions): GitHubAdapter {
  let running = false;
  let queueRunning = false;
  let client: GitHubClient | null = null;
  let webhookServer: WebhookServer | null = null;
  let workflows: LoadedGitHubWorkflow[] = [];
  const queuedChatIds = new Set<string>();
  const pendingQueue: QueuedGitHubEvent[] = [];

  function handleWebhookEvent(event: WebhookEvent): void {
    if (!running || workflows.length === 0) return;

    const mapped = mapWebhookEvent(event);
    if (!mapped) {
      log.debug('Ignoring unhandled webhook event', { eventType: event.eventType });
      return;
    }

    const { summary, details } = mapped;

    for (const candidate of workflows) {
      const result = matchGitHubWorkflow(candidate.definition, details);
      if (result.matched) {
        const chatId = buildChatId(details.repo, details.subjectType, details.number, summary.id);
        if (queuedChatIds.has(chatId)) {
          log.debug('Dropping duplicate event for active chat', {
            eventId: summary.id,
            chatId,
          });
          return;
        }
        if (pendingQueue.length >= MAX_QUEUE_SIZE) {
          log.warn('Event queue full, dropping event', {
            eventId: summary.id,
            repo: details.repo,
            queueSize: pendingQueue.length,
          });
          return;
        }
        queuedChatIds.add(chatId);
        pendingQueue.push({ event: summary, details, workflow: candidate, chatId });
        void drainQueue();
        return;
      }
    }

    log.info('Webhook event matched no workflow', {
      eventType: event.eventType,
      repo: details.repo,
    });
  }

  async function drainQueue(): Promise<void> {
    if (queueRunning || !client) {
      return;
    }

    queueRunning = true;
    try {
      while (running && client && pendingQueue.length > 0) {
        const item = pendingQueue.shift();
        if (!item) {
          continue;
        }
        try {
          await dispatchQueuedGitHubEvent({
            client,
            item,
            onEvent: opts.onEvent,
            log,
          });
        } finally {
          queuedChatIds.delete(item.chatId);
        }
      }
    } finally {
      queueRunning = false;
    }
    // Re-drain in case items arrived while we were finishing
    if (pendingQueue.length > 0) {
      void drainQueue();
    }
  }

  return {
    async start() {
      if (!opts.enabled) {
        log.info('GitHub adapter disabled');
        return;
      }

      if (!opts.webhook.secret) {
        throw new ChannelError(
          'GitHub webhook secret is required. Set GITHUB_WEBHOOK_SECRET in your environment.',
        );
      }

      if (!opts.token) {
        throw new ChannelError('GitHub token is required. Set GITHUB_TOKEN in your environment.');
      }

      workflows = await (opts.discoverWorkflows ?? discoverGitHubWorkflows)(opts.workflowsDir);
      if (workflows.length === 0) {
        throw new ChannelError(`No GitHub workflows found in ${opts.workflowsDir}`);
      }
      client = (opts.createClient ?? createGitHubClient)(opts.token);
      await client.verifyAuth();
      running = true;

      const factory = opts.createWebhookServer ?? createWebhookServer;
      webhookServer = factory({
        ...opts.webhook,
        onEvent: handleWebhookEvent,
      });
      await webhookServer.start();

      log.info('GitHub adapter started', {
        workflows: workflows.map((w) => w.definition.id),
        webhookPort: opts.webhook.port,
      });
    },

    async stop() {
      if (!running) {
        return;
      }
      running = false;
      if (webhookServer) {
        await webhookServer.stop();
        webhookServer = null;
      }
      client = null;
      workflows = [];
      pendingQueue.length = 0;
      queuedChatIds.clear();
      log.info('GitHub adapter stopped');
    },
  };
}
