import { ChannelError } from '@homie/core';
import type {
  GitHubActivityItem,
  GitHubNotificationDetails,
  GitHubNotificationSummary,
  GitHubSubjectType,
} from './types';

export interface GitHubClient {
  verifyAuth(): Promise<void>;
  listNotifications(): Promise<GitHubNotificationSummary[]>;
  loadNotificationDetails(
    notification: GitHubNotificationSummary,
  ): Promise<GitHubNotificationDetails>;
  postReply(details: GitHubNotificationDetails, body: string): Promise<void>;
  markNotificationRead(notificationId: string): Promise<void>;
}

export function createGitHubClient(): GitHubClient {
  return {
    async verifyAuth() {
      const proc = Bun.spawn(['gh', 'auth', 'status', '--active'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        const detail = stderr.trim() || stdout.trim() || 'gh auth status failed';
        throw new ChannelError(`GitHub CLI auth failed: ${detail}`);
      }
    },

    async listNotifications() {
      const notifications = await requestJson<GitHubNotificationApi[]>(
        'notifications?all=false&participating=false&per_page=50',
      );

      return notifications
        .map((notification) => {
          const repo = notification.repository.full_name;
          const subjectType = normalizeSubjectType(notification.subject.type);
          if (!repo || !subjectType) {
            return null;
          }

          return {
            id: notification.id,
            repo,
            subjectType,
            updatedAt: notification.updated_at,
          } satisfies GitHubNotificationSummary;
        })
        .filter((notification): notification is GitHubNotificationSummary => notification !== null);
    },

    async loadNotificationDetails(notification) {
      const thread = await requestJson<GitHubNotificationApi>(
        `notifications/threads/${notification.id}`,
      );
      const subjectType = normalizeSubjectType(thread.subject.type) ?? notification.subjectType;
      const number = extractNumber(thread.subject.url);
      const detailsUrl = thread.subject.url;
      const details = detailsUrl
        ? await requestJson<Record<string, unknown>>(toGhPath(detailsUrl))
        : null;
      const issueCommentsUrl = inferCommentsUrl(notification.repo, subjectType, number);
      const reviewCommentsUrl = inferReviewCommentsUrl(notification.repo, subjectType, number);
      const [issueComments, reviews] = await Promise.all([
        issueCommentsUrl
          ? requestJson<GitHubIssueCommentApi[]>(`${issueCommentsUrl}?per_page=30`)
          : Promise.resolve([]),
        reviewCommentsUrl
          ? requestJson<GitHubReviewApi[]>(`${reviewCommentsUrl}?per_page=30`)
          : Promise.resolve([]),
      ]);
      const activity = [...issueComments.map(mapIssueComment), ...reviews.map(mapReview)].sort(
        (left, right) => left.createdAt.localeCompare(right.createdAt),
      );
      const latestActivity = activity.at(-1) ?? null;
      const actor =
        latestActivity?.author ??
        readLogin((details?.user ?? null) as Record<string, unknown> | null);
      const triggerText =
        latestActivity?.body ?? (typeof details?.body === 'string' ? details.body : null);
      const commentsUrl = inferCommentsUrl(notification.repo, subjectType, number);
      const htmlUrl = typeof details?.html_url === 'string' ? details.html_url : null;
      const title =
        typeof details?.title === 'string' ? details.title : thread.subject.title || '(untitled)';

      return {
        notificationId: notification.id,
        repo: notification.repo,
        actor,
        subjectType,
        updatedAt: notification.updatedAt,
        title,
        url: htmlUrl ?? `https://github.com/${notification.repo}`,
        number,
        body: typeof details?.body === 'string' ? details.body : null,
        triggerText,
        commentsUrl,
        activity,
      };
    },

    async postReply(details, body) {
      if (!details.commentsUrl) {
        throw new ChannelError(
          `Cannot post GitHub reply for ${details.repo}: comments URL unavailable`,
        );
      }

      await requestJson(details.commentsUrl, {
        method: 'POST',
        body: { body },
      });
    },

    async markNotificationRead(notificationId) {
      await requestJson(`notifications/threads/${notificationId}`, {
        method: 'PATCH',
      });
    },
  };
}

async function requestJson<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH'; body?: Record<string, unknown> },
): Promise<T> {
  const args = ['api', '--include', normalizeEndpoint(path)];

  if (options?.method && options.method !== 'GET') {
    args.push('--method', options.method);
  }
  if (options?.body) {
    for (const [key, value] of Object.entries(options.body)) {
      args.push('-f', `${key}=${String(value)}`);
    }
  }

  const proc = Bun.spawn(['gh', ...args], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new ChannelError(getGhErrorMessage(path, stderr, stdout));
  }

  const response = splitGhResponse(stdout);
  if (response.status === 204 || !response.body.trim()) {
    return undefined as T;
  }

  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new ChannelError(`GitHub CLI returned invalid JSON for ${path}`);
  }
}

function splitGhResponse(stdout: string): { status: number; body: string } {
  const marker = '\r\n\r\n';
  const altMarker = '\n\n';
  const index = stdout.lastIndexOf(marker);
  const separatorLength = index >= 0 ? marker.length : altMarker.length;
  const splitIndex = index >= 0 ? index : stdout.lastIndexOf(altMarker);
  if (splitIndex < 0) {
    throw new ChannelError('GitHub CLI response did not include HTTP headers');
  }

  const rawHeaders = stdout.slice(0, splitIndex);
  const body = stdout.slice(splitIndex + separatorLength);
  const statusLine = rawHeaders
    .trim()
    .split(/\r?\n/)
    .findLast((line) => line.startsWith('HTTP/'));
  const status = statusLine ? Number(statusLine.split(' ')[1]) : NaN;

  if (!Number.isFinite(status)) {
    throw new ChannelError('GitHub CLI response did not include a valid HTTP status');
  }

  return { status, body };
}

function getGhErrorMessage(path: string, stderr: string, stdout: string): string {
  const detail = stderr.trim() || stdout.trim() || `gh api failed for ${path}`;
  return `GitHub CLI error for ${path}: ${detail}`;
}

function toGhPath(url: string): string {
  if (url.startsWith('https://api.github.com')) {
    return url.slice('https://api.github.com/'.length);
  }
  return url;
}

function normalizeEndpoint(path: string): string {
  return path.replace(/^\/+/, '');
}

function normalizeSubjectType(type: string): GitHubSubjectType | null {
  if (type === 'PullRequest' || type === 'Issue' || type === 'Discussion') {
    return type;
  }
  return null;
}

function readLogin(user: Record<string, unknown> | null): string | null {
  return user && typeof user.login === 'string' ? user.login : null;
}

function extractNumber(subjectUrl: string | null | undefined): number | null {
  if (!subjectUrl) {
    return null;
  }

  const match = subjectUrl.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function inferCommentsUrl(
  repo: string,
  subjectType: GitHubSubjectType,
  number: number | null,
): string | null {
  if (!number) {
    return null;
  }

  if (subjectType === 'PullRequest' || subjectType === 'Issue') {
    return `/repos/${repo}/issues/${number}/comments`;
  }

  return null;
}

function inferReviewCommentsUrl(
  repo: string,
  subjectType: GitHubSubjectType,
  number: number | null,
): string | null {
  if (!number || subjectType !== 'PullRequest') {
    return null;
  }

  return `/repos/${repo}/pulls/${number}/reviews`;
}

function mapIssueComment(comment: GitHubIssueCommentApi): GitHubActivityItem {
  return {
    type: 'issue_comment',
    author: readLogin(comment.user),
    body: comment.body ?? null,
    url: comment.html_url ?? null,
    createdAt: comment.created_at,
  };
}

function mapReview(review: GitHubReviewApi): GitHubActivityItem {
  return {
    type: 'review',
    author: readLogin(review.user),
    body: review.body ?? null,
    state: review.state ?? null,
    url: review.html_url ?? null,
    createdAt: review.submitted_at ?? '',
  };
}

interface GitHubNotificationApi {
  id: string;
  updated_at: string;
  repository: {
    full_name: string;
  };
  subject: {
    title: string;
    type: string;
    url: string | null;
  };
}

interface GitHubIssueCommentApi {
  body?: string | null;
  html_url?: string | null;
  created_at: string;
  user: Record<string, unknown> | null;
}

interface GitHubReviewApi {
  body?: string | null;
  html_url?: string | null;
  state?: string | null;
  submitted_at?: string | null;
  user: Record<string, unknown> | null;
}
