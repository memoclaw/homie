import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { schema } from '@homie/persistence/src/migrations';
import { createGitHubAdapter } from './adapter';
import type { GitHubClient } from './client';
import { loadGitHubWorkflow } from './loader';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

describe('GitHubAdapter', () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  test('dispatches matched notifications and marks them handled after reply', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/pr-review-mentions/WORKFLOW.md');
    const repo = workflow.definition.repos[0] ?? 'unknown/repo';
    const actor = workflow.definition.users?.[0] ?? 'someone';
    const client: GitHubClient = {
      verifyAuth: mock(async () => {}),
      listNotifications: mock(async () => [
        {
          id: 'n1',
          repo,
          subjectType: 'PullRequest',
          updatedAt: '2026-03-12T00:00:00.000Z',
        },
      ]),
      loadNotificationDetails: mock(async () => ({
        notificationId: 'n1',
        repo,
        actor,
        subjectType: 'PullRequest',
        updatedAt: '2026-03-12T00:00:00.000Z',
        title: 'Test PR',
        url: `https://github.com/${repo}/pull/12`,
        number: 12,
        body: 'please review this',
        triggerText: '@homie can you review this?',
        commentsUrl: `/repos/${repo}/issues/12/comments`,
        activity: [
          {
            type: 'issue_comment',
            author: actor,
            body: '@homie can you review this?',
            url: `https://github.com/${repo}/pull/12#issuecomment-1`,
            createdAt: '2026-03-12T00:00:00.000Z',
          },
        ],
      })),
      postReply: mock(async () => {}),
      markNotificationRead: mock(async () => {}),
    };

    const adapter = createGitHubAdapter({
      enabled: true,
      workflowsDir: './workflows/github',
      pollIntervalMs: 60_000,
      markReadOnHandled: true,
      createClient: () => client,
      discoverWorkflows: async () => [workflow],
      onEvent: async (_event, reply) => {
        await reply(
          JSON.stringify({
            handle: true,
            reason: 'direct review request',
            action: 'reply',
            reply: 'reviewed',
          }),
        );
      },
    });

    await adapter.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.stop();

    expect(client.postReply).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining('<!-- homie:notification:n1 -->'),
    );
    expect(client.markNotificationRead).toHaveBeenCalledWith('n1');
  });

  test('marks notifications ignored when workflow says not to handle', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/pr-review-mentions/WORKFLOW.md');
    const repo = workflow.definition.repos[0] ?? 'unknown/repo';
    const actor = workflow.definition.users?.[0] ?? 'someone';
    const client: GitHubClient = {
      verifyAuth: mock(async () => {}),
      listNotifications: mock(async () => [
        {
          id: 'n2',
          repo,
          subjectType: 'PullRequest',
          updatedAt: '2026-03-12T00:00:00.000Z',
        },
      ]),
      loadNotificationDetails: mock(async () => ({
        notificationId: 'n2',
        repo,
        actor,
        subjectType: 'PullRequest',
        updatedAt: '2026-03-12T00:00:00.000Z',
        title: 'Test PR',
        url: `https://github.com/${repo}/pull/12`,
        number: 12,
        body: 'ambient discussion',
        triggerText: null,
        commentsUrl: `/repos/${repo}/issues/12/comments`,
        activity: [],
      })),
      postReply: mock(async () => {}),
      markNotificationRead: mock(async () => {}),
    };

    const adapter = createGitHubAdapter({
      enabled: true,
      workflowsDir: './workflows/github',
      pollIntervalMs: 60_000,
      markReadOnHandled: true,
      createClient: () => client,
      discoverWorkflows: async () => [workflow],
      onEvent: async (_event, reply) => {
        await reply(
          JSON.stringify({
            handle: false,
            reason: 'not actionable',
          }),
        );
      },
    });

    await adapter.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.stop();

    expect(client.postReply).not.toHaveBeenCalled();
    expect(client.markNotificationRead).toHaveBeenCalledWith('n2');
  });

  test('marks unrelated notifications read immediately', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/pr-review-mentions/WORKFLOW.md');
    const client: GitHubClient = {
      verifyAuth: mock(async () => {}),
      listNotifications: mock(async () => [
        {
          id: 'n3',
          repo: 'unrelated/repo',
          subjectType: 'Issue',
          updatedAt: '2026-03-12T00:00:00.000Z',
        },
      ]),
      loadNotificationDetails: mock(async () => {
        throw new Error('should not load details');
      }),
      postReply: mock(async () => {}),
      markNotificationRead: mock(async () => {}),
    };

    const adapter = createGitHubAdapter({
      enabled: true,
      workflowsDir: './workflows/github',
      pollIntervalMs: 60_000,
      markReadOnHandled: true,
      createClient: () => client,
      discoverWorkflows: async () => [workflow],
      onEvent: async () => {
        throw new Error('should not dispatch');
      },
    });

    await adapter.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.stop();

    expect(client.loadNotificationDetails).not.toHaveBeenCalled();
    expect(client.postReply).not.toHaveBeenCalled();
    expect(client.markNotificationRead).toHaveBeenCalledWith('n3');
  });

  test('does not repost when the notification marker already exists', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/pr-review-mentions/WORKFLOW.md');
    const repo = workflow.definition.repos[0] ?? 'unknown/repo';
    const actor = workflow.definition.users?.[0] ?? 'someone';
    const client: GitHubClient = {
      verifyAuth: mock(async () => {}),
      listNotifications: mock(async () => [
        {
          id: 'n4',
          repo,
          subjectType: 'PullRequest',
          updatedAt: '2026-03-12T00:00:00.000Z',
        },
      ]),
      loadNotificationDetails: mock(async () => ({
        notificationId: 'n4',
        repo,
        actor,
        subjectType: 'PullRequest',
        updatedAt: '2026-03-12T00:00:00.000Z',
        title: 'Test PR',
        url: `https://github.com/${repo}/pull/12`,
        number: 12,
        body: 'please review this',
        triggerText: '@homie can you review this?',
        commentsUrl: `/repos/${repo}/issues/12/comments`,
        activity: [
          {
            type: 'issue_comment',
            author: 'homie',
            body: 'reviewed\n\n<!-- homie:notification:n4 -->',
            url: `https://github.com/${repo}/pull/12#issuecomment-2`,
            createdAt: '2026-03-12T00:01:00.000Z',
          },
        ],
      })),
      postReply: mock(async () => {}),
      markNotificationRead: mock(async () => {}),
    };

    const adapter = createGitHubAdapter({
      enabled: true,
      workflowsDir: './workflows/github',
      pollIntervalMs: 60_000,
      markReadOnHandled: true,
      createClient: () => client,
      discoverWorkflows: async () => [workflow],
      onEvent: async (_event, reply) => {
        await reply(
          JSON.stringify({
            handle: true,
            reason: 'direct review request',
            action: 'reply',
            reply: 'reviewed',
          }),
        );
      },
    });

    await adapter.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.stop();

    expect(client.postReply).not.toHaveBeenCalled();
    expect(client.markNotificationRead).toHaveBeenCalledWith('n4');
  });
});
