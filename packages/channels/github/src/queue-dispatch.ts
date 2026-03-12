import type { EventHandler } from '@homie/core';
import { getErrorMessage } from '@homie/core';
import type { Logger } from '@homie/observability';
import type { GitHubClient } from './client';
import {
  formatReplyWithMarker,
  hasNotificationMarker,
  notificationMarker,
  type QueuedGitHubNotification,
} from './notification';
import { buildGitHubWorkflowPrompt } from './prompt';
import { parseGitHubWorkflowDecision } from './workflow-evaluator';

export async function dispatchQueuedGitHubNotification(params: {
  client: GitHubClient;
  item: QueuedGitHubNotification;
  onEvent: EventHandler;
  markReadOnHandled: boolean;
  log: Logger;
}): Promise<void> {
  const { client, item, onEvent, markReadOnHandled, log } = params;

  await new Promise<void>((resolve) => {
    void onEvent(
      {
        type: 'chat',
        channel: 'github',
        chatId: item.chatId,
        text: buildGitHubWorkflowPrompt(item.workflow, item.details),
        rawSourceId: item.notification.id,
        agentModel: item.workflow.definition.agentModel ?? null,
      },
      async (replyText) => {
        try {
          if (replyText === 'Something went wrong. Please try again.') {
            return;
          }

          const decision = parseGitHubWorkflowDecision(replyText);
          if (decision.handle) {
            const marker = notificationMarker(item.notification.id);
            if (!hasNotificationMarker(item.details, marker)) {
              log.info('Posting GitHub workflow reply', {
                notificationId: item.notification.id,
                repo: item.details.repo,
                subjectType: item.details.subjectType,
                reason: decision.reason,
              });
              await client.postReply(
                item.details,
                formatReplyWithMarker(decision.reply ?? '', marker),
              );
            } else {
              log.info('Skipping GitHub reply (marker already present)', {
                notificationId: item.notification.id,
                repo: item.details.repo,
                subjectType: item.details.subjectType,
              });
            }
          } else {
            log.info('Skipping GitHub reply (workflow decided not to handle)', {
              notificationId: item.notification.id,
              repo: item.details.repo,
              subjectType: item.details.subjectType,
              reason: decision.reason,
            });
          }

          if (markReadOnHandled) {
            await client.markNotificationRead(item.notification.id);
          }
        } catch (err) {
          log.error('GitHub notification handling failed', {
            notificationId: item.notification.id,
            error: getErrorMessage(err),
          });
        } finally {
          resolve();
        }
      },
    ).catch((err) => {
      log.error('GitHub event dispatch failed', {
        notificationId: item.notification.id,
        error: getErrorMessage(err),
      });
      resolve();
    });
  });
}
