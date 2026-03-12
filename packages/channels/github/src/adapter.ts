import type { EventHandler } from '@homie/core';
import { ChannelError, getErrorMessage } from '@homie/core';
import { createLogger } from '@homie/observability';
import { createGitHubClient, type GitHubClient } from './client';
import { matchGitHubWorkflow } from './matcher';
import { buildChatId, matchesStaticScope, type QueuedGitHubNotification } from './notification';
import { dispatchQueuedGitHubNotification } from './queue-dispatch';
import type { LoadedGitHubWorkflow } from './types';
import { discoverGitHubWorkflows } from './workflow-discovery';

const log = createLogger('github');

export interface GitHubAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface GitHubAdapterOptions {
  enabled: boolean;
  workflowsDir: string;
  onEvent: EventHandler;
  pollIntervalMs: number;
  markReadOnHandled?: boolean;
  createClient?: () => GitHubClient;
  discoverWorkflows?: (workflowsDir: string) => Promise<LoadedGitHubWorkflow[]>;
}

export function createGitHubAdapter(opts: GitHubAdapterOptions): GitHubAdapter {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let queueRunning = false;
  let client: GitHubClient | null = null;
  let workflows: LoadedGitHubWorkflow[] = [];
  const queuedIds = new Set<string>();
  const pendingQueue: QueuedGitHubNotification[] = [];

  async function pollOnce(): Promise<void> {
    if (!client || workflows.length === 0) {
      return;
    }
    if (inFlight) {
      return;
    }
    inFlight = true;

    try {
      const notifications = await client.listNotifications();
      for (const notification of notifications) {
        const candidateWorkflows = workflows.filter((candidate) =>
          matchesStaticScope(candidate.definition, notification),
        );

        if (candidateWorkflows.length === 0) {
          log.info('Marked unrelated GitHub notification as read', {
            notificationId: notification.id,
            repo: notification.repo,
            subjectType: notification.subjectType,
          });
          await client.markNotificationRead(notification.id);
          continue;
        }

        const details = await client.loadNotificationDetails(notification);
        let matchedWorkflow: LoadedGitHubWorkflow | undefined;
        for (const candidate of candidateWorkflows) {
          const result = matchGitHubWorkflow(candidate.definition, details);
          if (result.matched) {
            matchedWorkflow = candidate;
            break;
          }
        }
        const chatId = buildChatId(
          details.repo,
          details.subjectType,
          details.number,
          notification.id,
        );

        if (!matchedWorkflow) {
          log.info('Marked GitHub notification as read (no workflow matched after details)', {
            notificationId: notification.id,
            repo: details.repo,
            subjectType: details.subjectType,
          });
          await client.markNotificationRead(notification.id);
          continue;
        }

        const workflow = matchedWorkflow;

        if (queuedIds.has(notification.id)) {
          continue;
        }

        queuedIds.add(notification.id);
        pendingQueue.push({ notification, details, workflow, chatId });
      }
      void drainQueue();
    } catch (err) {
      log.error('GitHub poll failed', { error: getErrorMessage(err) });
    } finally {
      inFlight = false;
    }
  }

  function scheduleNext(): void {
    if (!running) {
      return;
    }

    timer = setTimeout(() => {
      void pollOnce().finally(() => {
        scheduleNext();
      });
    }, opts.pollIntervalMs);
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
          await dispatchQueuedGitHubNotification({
            client,
            item,
            onEvent: opts.onEvent,
            markReadOnHandled: opts.markReadOnHandled ?? false,
            log,
          });
        } finally {
          queuedIds.delete(item.notification.id);
        }
      }
    } finally {
      queueRunning = false;
    }
  }

  return {
    async start() {
      if (!opts.enabled) {
        log.info('GitHub adapter disabled');
        return;
      }

      workflows = await (opts.discoverWorkflows ?? discoverGitHubWorkflows)(opts.workflowsDir);
      if (workflows.length === 0) {
        throw new ChannelError(`No GitHub workflows found in ${opts.workflowsDir}`);
      }
      client = (opts.createClient ?? createGitHubClient)();
      await client.verifyAuth();
      running = true;
      log.info('GitHub adapter started', {
        workflows: workflows.map((workflow) => workflow.definition.id),
      });
      void pollOnce().finally(() => {
        scheduleNext();
      });
    },

    async stop() {
      if (!running) {
        return;
      }
      running = false;
      if (timer) {
        clearTimeout(timer);
      }
      client = null;
      workflows = [];
      pendingQueue.length = 0;
      queuedIds.clear();
      log.info('GitHub adapter stopped');
    },
  };
}
