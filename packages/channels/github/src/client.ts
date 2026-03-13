import { ChannelError } from '@homie/core';
import type { GitHubEventDetails } from './types';

const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;

export interface GitHubClient {
  verifyAuth(): Promise<void>;
  postReply(details: GitHubEventDetails, body: string): Promise<void>;
}

export function createGitHubClient(token: string): GitHubClient {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  return {
    async verifyAuth() {
      const res = await fetch(`${GITHUB_API}/user`, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new ChannelError(`GitHub auth failed (${res.status}): ${text}`);
      }
    },

    async postReply(details, body) {
      if (!details.commentsUrl) {
        throw new ChannelError(
          `Cannot post GitHub reply for ${details.repo}: comments URL unavailable`,
        );
      }

      const url = `${GITHUB_API}/${details.commentsUrl.replace(/^\/+/, '')}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new ChannelError(
          `GitHub API error for ${details.commentsUrl} (${res.status}): ${text}`,
        );
      }
    },
  };
}
