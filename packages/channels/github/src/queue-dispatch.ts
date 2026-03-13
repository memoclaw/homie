import type { EventHandler } from '@homie/core';
import { getErrorMessage } from '@homie/core';
import type { Logger } from '@homie/observability';
import type { GitHubClient } from './client';
import {
  formatReplyWithMarker,
  hasReplyMarker,
  type QueuedGitHubEvent,
  replyMarker,
} from './notification';
import { buildGitHubWorkflowPrompt } from './prompt';
import { parseGitHubWorkflowDecision } from './workflow-evaluator';

export async function dispatchQueuedGitHubEvent(params: {
  client: GitHubClient;
  item: QueuedGitHubEvent;
  onEvent: EventHandler;
  log: Logger;
}): Promise<void> {
  const { client, item, onEvent, log } = params;

  await new Promise<void>((resolve) => {
    void onEvent(
      {
        type: 'chat',
        channel: 'github',
        chatId: item.chatId,
        text: buildGitHubWorkflowPrompt(item.workflow, item.details),
        rawSourceId: item.event.id,
        agentModel: item.workflow.definition.agentModel ?? null,
      },
      async (replyText) => {
        try {
          if (replyText === 'Something went wrong. Please try again.') {
            return;
          }

          const decision = parseGitHubWorkflowDecision(replyText);
          if (decision.handle) {
            const marker = replyMarker(item.event.id);
            if (!hasReplyMarker(item.details, marker)) {
              log.info('Posting GitHub workflow reply', {
                eventId: item.event.id,
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
                eventId: item.event.id,
                repo: item.details.repo,
                subjectType: item.details.subjectType,
              });
            }
          } else {
            log.info('Skipping GitHub reply (workflow decided not to handle)', {
              eventId: item.event.id,
              repo: item.details.repo,
              subjectType: item.details.subjectType,
              reason: decision.reason,
            });
          }
        } catch (err) {
          log.error('GitHub event handling failed', {
            eventId: item.event.id,
            error: getErrorMessage(err),
          });
        } finally {
          resolve();
        }
      },
    ).catch((err) => {
      log.error('GitHub event dispatch failed', {
        eventId: item.event.id,
        error: getErrorMessage(err),
      });
      resolve();
    });
  });
}
