import { describe, expect, mock, test } from 'bun:test';
import { createGitHubAdapter } from './adapter';
import type { GitHubClient } from './client';
import { loadGitHubWorkflow } from './loader';
import type { WebhookEvent } from './webhook-mapper';
import type { WebhookServer } from './webhook-server';

function createTestClient(overrides?: Partial<GitHubClient>): GitHubClient {
  return {
    verifyAuth: mock(async () => {}),
    postReply: mock(async () => {}),
    ...overrides,
  };
}

function webhookOpts() {
  return { port: 3100, path: '/webhooks/github', secret: 'secret' };
}

describe('GitHubAdapter', () => {
  test('starts webhook server and dispatches matched events', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/repo-watcher/WORKFLOW.md');
    const repo = workflow.definition.repos[0] ?? 'unknown/repo';
    const client = createTestClient();
    let capturedOnEvent: ((event: WebhookEvent) => void) | null = null;
    const fakeServer: WebhookServer = {
      start: mock(async () => {}),
      stop: mock(async () => {}),
    };

    const adapter = createGitHubAdapter({
      enabled: true,
      workflowsDir: './workflows/github',
      webhook: webhookOpts(),
      token: 'test-token',
      createClient: () => client,
      discoverWorkflows: async () => [workflow],
      createWebhookServer: (opts) => {
        capturedOnEvent = opts.onEvent;
        return fakeServer;
      },
      onEvent: async (_event, reply) => {
        await reply(
          JSON.stringify({
            handle: true,
            reason: 'webhook test',
            action: 'reply',
            reply: 'webhook response',
          }),
        );
      },
    });

    await adapter.start();
    expect(fakeServer.start).toHaveBeenCalled();
    expect(capturedOnEvent).not.toBeNull();

    capturedOnEvent?.({
      eventType: 'issue_comment',
      deliveryId: 'wh-1',
      payload: {
        action: 'created',
        repository: { full_name: repo },
        sender: { login: 'someone' },
        issue: {
          title: 'Test PR',
          number: 99,
          body: 'test body',
          pull_request: { url: `https://api.github.com/repos/${repo}/pulls/99` },
        },
        comment: {
          body: 'please review',
          html_url: `https://github.com/${repo}/pull/99#issuecomment-1`,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await adapter.stop();

    expect(client.postReply).toHaveBeenCalled();
    expect(fakeServer.stop).toHaveBeenCalled();
  });

  test('does not dispatch when workflow decides not to handle', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/repo-watcher/WORKFLOW.md');
    const repo = workflow.definition.repos[0] ?? 'unknown/repo';
    const client = createTestClient();
    let capturedOnEvent: ((event: WebhookEvent) => void) | null = null;

    const adapter = createGitHubAdapter({
      enabled: true,
      workflowsDir: './workflows/github',
      webhook: webhookOpts(),
      token: 'test-token',
      createClient: () => client,
      discoverWorkflows: async () => [workflow],
      createWebhookServer: (opts) => {
        capturedOnEvent = opts.onEvent;
        return { start: mock(async () => {}), stop: mock(async () => {}) };
      },
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
    capturedOnEvent?.({
      eventType: 'pull_request',
      deliveryId: 'wh-2',
      payload: {
        action: 'opened',
        repository: { full_name: repo },
        sender: { login: 'someone' },
        pull_request: {
          title: 'Some PR',
          number: 10,
          body: 'ambient work',
          html_url: `https://github.com/${repo}/pull/10`,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await adapter.stop();

    expect(client.postReply).not.toHaveBeenCalled();
  });

  test('ignores webhook events for unrelated repos', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/repo-watcher/WORKFLOW.md');
    const client = createTestClient();
    let capturedOnEvent: ((event: WebhookEvent) => void) | null = null;

    const adapter = createGitHubAdapter({
      enabled: true,
      workflowsDir: './workflows/github',
      webhook: webhookOpts(),
      token: 'test-token',
      createClient: () => client,
      discoverWorkflows: async () => [workflow],
      createWebhookServer: (opts) => {
        capturedOnEvent = opts.onEvent;
        return { start: mock(async () => {}), stop: mock(async () => {}) };
      },
      onEvent: async () => {
        throw new Error('should not dispatch for unrelated repo');
      },
    });

    await adapter.start();
    capturedOnEvent?.({
      eventType: 'issues',
      deliveryId: 'wh-3',
      payload: {
        action: 'opened',
        repository: { full_name: 'unrelated/repo' },
        sender: { login: 'someone' },
        issue: {
          title: 'Bug',
          number: 1,
          body: 'crash',
          html_url: 'https://github.com/unrelated/repo/issues/1',
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await adapter.stop();

    expect(client.postReply).not.toHaveBeenCalled();
  });

  test('does not repost when the reply marker already exists', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/repo-watcher/WORKFLOW.md');
    const repo = workflow.definition.repos[0] ?? 'unknown/repo';
    const client = createTestClient();
    let capturedOnEvent: ((event: WebhookEvent) => void) | null = null;

    const adapter = createGitHubAdapter({
      enabled: true,
      workflowsDir: './workflows/github',
      webhook: webhookOpts(),
      token: 'test-token',
      createClient: () => client,
      discoverWorkflows: async () => [workflow],
      createWebhookServer: (opts) => {
        capturedOnEvent = opts.onEvent;
        return { start: mock(async () => {}), stop: mock(async () => {}) };
      },
      onEvent: async (_event, reply) => {
        await reply(
          JSON.stringify({
            handle: true,
            reason: 'test',
            action: 'reply',
            reply: 'response',
          }),
        );
      },
    });

    await adapter.start();

    capturedOnEvent?.({
      eventType: 'issue_comment',
      deliveryId: 'wh-marker',
      payload: {
        action: 'created',
        repository: { full_name: repo },
        sender: { login: 'homie' },
        issue: {
          title: 'Test PR',
          number: 12,
          body: 'test',
          pull_request: { url: `https://api.github.com/repos/${repo}/pulls/12` },
        },
        comment: {
          body: 'response\n\n<!-- homie:event:wh-marker -->',
          html_url: `https://github.com/${repo}/pull/12#issuecomment-2`,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await adapter.stop();

    expect(client.postReply).not.toHaveBeenCalled();
  });

  test('does nothing when disabled', async () => {
    const adapter = createGitHubAdapter({
      enabled: false,
      workflowsDir: './workflows/github',
      webhook: webhookOpts(),
      token: '',
      onEvent: async () => {
        throw new Error('should not dispatch');
      },
    });

    await adapter.start();
    await adapter.stop();
  });
});
