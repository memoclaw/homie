import type { GitHubEventDetails, GitHubEventSummary, LoadedGitHubWorkflow } from './types';

export interface QueuedGitHubEvent {
  event: GitHubEventSummary;
  details: GitHubEventDetails;
  workflow: LoadedGitHubWorkflow;
  chatId: string;
}

export function buildChatId(
  repo: string,
  subjectType: string,
  number: number | null,
  eventId: string,
): string {
  const scope = number ? `${subjectType.toLowerCase()}:${number}` : `event:${eventId}`;
  return `github:${repo}:${scope}`;
}

export function replyMarker(eventId: string): string {
  return `<!-- homie:event:${eventId} -->`;
}

export function hasReplyMarker(details: GitHubEventDetails, marker: string): boolean {
  return details.activity.some((item) => item.body?.includes(marker));
}

export function formatReplyWithMarker(reply: string, marker: string): string {
  return `${reply.trim()}\n\n${marker}`;
}
