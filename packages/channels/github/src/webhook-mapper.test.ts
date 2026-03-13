import { describe, expect, test } from 'bun:test';
import { mapWebhookEvent } from './webhook-mapper';

describe('mapWebhookEvent', () => {
  const basePayload = {
    repository: { full_name: 'owner/repo' },
    sender: { login: 'alice' },
  };

  test('maps pull_request opened', () => {
    const result = mapWebhookEvent({
      eventType: 'pull_request',
      deliveryId: 'd1',
      payload: {
        ...basePayload,
        action: 'opened',
        pull_request: {
          title: 'Add feature',
          number: 42,
          body: 'This adds a feature',
          html_url: 'https://github.com/owner/repo/pull/42',
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.details.subjectType).toBe('PullRequest');
    expect(result?.details.title).toBe('Add feature');
    expect(result?.details.number).toBe(42);
    expect(result?.details.actor).toBe('alice');
    expect(result?.details.repo).toBe('owner/repo');
    expect(result?.summary.id).toBe('d1');
  });

  test('maps pull_request_review submitted', () => {
    const result = mapWebhookEvent({
      eventType: 'pull_request_review',
      deliveryId: 'd2',
      payload: {
        ...basePayload,
        action: 'submitted',
        pull_request: { title: 'Fix bug', number: 10, body: 'bug fix', html_url: null },
        review: {
          body: 'LGTM',
          state: 'approved',
          html_url: 'https://github.com/owner/repo/pull/10#pullrequestreview-1',
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.details.subjectType).toBe('PullRequest');
    expect(result?.details.activity[0]?.type).toBe('review');
    expect(result?.details.activity[0]?.state).toBe('approved');
    expect(result?.details.activity[0]?.body).toBe('LGTM');
  });

  test('maps issue_comment created on a PR', () => {
    const result = mapWebhookEvent({
      eventType: 'issue_comment',
      deliveryId: 'd3',
      payload: {
        ...basePayload,
        action: 'created',
        issue: {
          title: 'PR title',
          number: 5,
          body: 'PR body',
          pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/5' },
        },
        comment: {
          body: 'Nice work!',
          html_url: 'https://github.com/owner/repo/pull/5#issuecomment-1',
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.details.subjectType).toBe('PullRequest');
    expect(result?.details.triggerText).toBe('Nice work!');
  });

  test('maps issue_comment created on an issue', () => {
    const result = mapWebhookEvent({
      eventType: 'issue_comment',
      deliveryId: 'd4',
      payload: {
        ...basePayload,
        action: 'created',
        issue: { title: 'Bug report', number: 3, body: 'It crashes' },
        comment: { body: 'Can reproduce', html_url: null },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.details.subjectType).toBe('Issue');
  });

  test('maps issues opened', () => {
    const result = mapWebhookEvent({
      eventType: 'issues',
      deliveryId: 'd5',
      payload: {
        ...basePayload,
        action: 'opened',
        issue: {
          title: 'New issue',
          number: 7,
          body: 'Something is wrong',
          html_url: 'https://github.com/owner/repo/issues/7',
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.details.subjectType).toBe('Issue');
    expect(result?.details.number).toBe(7);
  });

  test('returns null for unsupported event types', () => {
    expect(
      mapWebhookEvent({
        eventType: 'push',
        deliveryId: 'd6',
        payload: basePayload,
      }),
    ).toBeNull();
  });

  test('returns null for unsupported actions', () => {
    expect(
      mapWebhookEvent({
        eventType: 'pull_request',
        deliveryId: 'd7',
        payload: {
          ...basePayload,
          action: 'closed',
          pull_request: { title: 'x', number: 1, body: null, html_url: null },
        },
      }),
    ).toBeNull();
  });

  test('returns null when repository is missing', () => {
    expect(
      mapWebhookEvent({
        eventType: 'issues',
        deliveryId: 'd8',
        payload: {
          action: 'opened',
          issue: { title: 'x', number: 1, body: null, html_url: null },
        },
      }),
    ).toBeNull();
  });
});
