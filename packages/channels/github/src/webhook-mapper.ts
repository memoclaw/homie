import type {
  GitHubActivityItem,
  GitHubEventDetails,
  GitHubEventSummary,
  GitHubSubjectType,
} from './types';

export interface WebhookEvent {
  eventType: string;
  deliveryId: string;
  payload: Record<string, unknown>;
}

export interface MappedWebhookEvent {
  summary: GitHubEventSummary;
  details: GitHubEventDetails;
}

export function mapWebhookEvent(event: WebhookEvent): MappedWebhookEvent | null {
  const { eventType, deliveryId, payload } = event;
  const action = typeof payload.action === 'string' ? payload.action : null;

  const mapping = resolveMapping(eventType, action, payload);
  if (!mapping) {
    return null;
  }

  const repo = readRepoFullName(payload);
  if (!repo) {
    return null;
  }

  const actor = readSenderLogin(payload);
  const now = new Date().toISOString();

  const activity: GitHubActivityItem[] = mapping.activityBody
    ? [
        {
          type: mapping.activityType,
          author: actor,
          body: mapping.activityBody,
          state: mapping.activityState ?? null,
          url: mapping.htmlUrl,
          createdAt: now,
        },
      ]
    : [];

  const commentsUrl = mapping.number ? `/repos/${repo}/issues/${mapping.number}/comments` : null;

  const details: GitHubEventDetails = {
    eventId: deliveryId,
    repo,
    actor,
    subjectType: mapping.subjectType,
    updatedAt: now,
    title: mapping.title,
    url: mapping.htmlUrl ?? `https://github.com/${repo}`,
    number: mapping.number,
    body: mapping.body,
    triggerText: mapping.activityBody ?? mapping.body,
    commentsUrl,
    activity,
  };

  const summary: GitHubEventSummary = {
    id: deliveryId,
    repo,
    subjectType: mapping.subjectType,
    updatedAt: now,
  };

  return { summary, details };
}

interface ResolvedMapping {
  subjectType: GitHubSubjectType;
  title: string;
  number: number | null;
  body: string | null;
  htmlUrl: string | null;
  activityType: GitHubActivityItem['type'];
  activityBody: string | null;
  activityState?: string | null;
}

function resolveMapping(
  eventType: string,
  action: string | null,
  payload: Record<string, unknown>,
): ResolvedMapping | null {
  switch (eventType) {
    case 'pull_request': {
      if (!action || !['opened', 'reopened', 'synchronize'].includes(action)) {
        return null;
      }
      const pr = payload.pull_request as Record<string, unknown> | undefined;
      if (!pr) return null;
      return {
        subjectType: 'PullRequest',
        title: readString(pr.title) ?? '(untitled)',
        number: readNumber(pr.number),
        body: readString(pr.body),
        htmlUrl: readString(pr.html_url),
        activityType: 'issue_comment',
        activityBody: readString(pr.body),
      };
    }

    case 'pull_request_review': {
      if (action !== 'submitted') return null;
      const review = payload.review as Record<string, unknown> | undefined;
      const pr = payload.pull_request as Record<string, unknown> | undefined;
      if (!review || !pr) return null;
      return {
        subjectType: 'PullRequest',
        title: readString(pr.title) ?? '(untitled)',
        number: readNumber(pr.number),
        body: readString(pr.body),
        htmlUrl: readString(review.html_url),
        activityType: 'review',
        activityBody: readString(review.body),
        activityState: readString(review.state),
      };
    }

    case 'issue_comment': {
      if (action !== 'created') return null;
      const comment = payload.comment as Record<string, unknown> | undefined;
      const issue = payload.issue as Record<string, unknown> | undefined;
      if (!comment || !issue) return null;
      const isPr = issue.pull_request !== undefined && issue.pull_request !== null;
      return {
        subjectType: isPr ? 'PullRequest' : 'Issue',
        title: readString(issue.title) ?? '(untitled)',
        number: readNumber(issue.number),
        body: readString(issue.body),
        htmlUrl: readString(comment.html_url),
        activityType: 'issue_comment',
        activityBody: readString(comment.body),
      };
    }

    case 'issues': {
      if (!action || !['opened', 'labeled'].includes(action)) return null;
      const issue = payload.issue as Record<string, unknown> | undefined;
      if (!issue) return null;
      return {
        subjectType: 'Issue',
        title: readString(issue.title) ?? '(untitled)',
        number: readNumber(issue.number),
        body: readString(issue.body),
        htmlUrl: readString(issue.html_url),
        activityType: 'issue_comment',
        activityBody: readString(issue.body),
      };
    }

    default:
      return null;
  }
}

function readRepoFullName(payload: Record<string, unknown>): string | null {
  const repo = payload.repository as Record<string, unknown> | undefined;
  return repo ? readString(repo.full_name) : null;
}

function readSenderLogin(payload: Record<string, unknown>): string | null {
  const sender = payload.sender as Record<string, unknown> | undefined;
  return sender ? readString(sender.login) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
