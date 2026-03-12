import type {
  GitHubNotificationDetails,
  GitHubNotificationSummary,
  LoadedGitHubWorkflow,
} from './types';

export interface QueuedGitHubNotification {
  notification: GitHubNotificationSummary;
  details: GitHubNotificationDetails;
  workflow: LoadedGitHubWorkflow;
  chatId: string;
}

export function buildChatId(
  repo: string,
  subjectType: string,
  number: number | null,
  notificationId: string,
): string {
  const scope = number
    ? `${subjectType.toLowerCase()}:${number}`
    : `notification:${notificationId}`;
  return `github:${repo}:${scope}`;
}

export function matchesStaticScope(
  workflow: LoadedGitHubWorkflow['definition'],
  notification: { repo: string; subjectType: string },
): boolean {
  if (!workflow.repos.includes(notification.repo)) {
    return false;
  }

  return !workflow.subjectTypes || workflow.subjectTypes.includes(notification.subjectType);
}

export function notificationMarker(notificationId: string): string {
  return `<!-- homie:notification:${notificationId} -->`;
}

export function hasNotificationMarker(details: GitHubNotificationDetails, marker: string): boolean {
  return details.activity.some((item) => item.body?.includes(marker));
}

export function formatReplyWithMarker(reply: string, marker: string): string {
  return `${reply.trim()}\n\n${marker}`;
}
