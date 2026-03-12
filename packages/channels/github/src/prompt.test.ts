import { describe, expect, test } from 'bun:test';
import { loadGitHubWorkflow } from './loader';
import { buildGitHubWorkflowPrompt } from './prompt';

describe('buildGitHubWorkflowPrompt', () => {
  test('includes trigger and recent activity', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/pr-review-mentions/WORKFLOW.md');
    const repo = workflow.definition.repos[0] ?? 'unknown/repo';
    const actor = workflow.definition.users?.[0] ?? 'someone';
    const prompt = buildGitHubWorkflowPrompt(workflow, {
      notificationId: 'n1',
      repo,
      actor,
      subjectType: 'PullRequest',
      updatedAt: '2026-03-12T00:00:00.000Z',
      title: 'Fix parser',
      url: `https://github.com/${repo}/pull/12`,
      number: 12,
      body: 'main body',
      triggerText: '@homie please review',
      commentsUrl: `/repos/${repo}/issues/12/comments`,
      activity: [
        {
          type: 'issue_comment',
          author: actor,
          body: '@homie please review',
          url: `https://github.com/${repo}/pull/12#issuecomment-1`,
          createdAt: '2026-03-12T00:00:00.000Z',
        },
        {
          type: 'review',
          author: 'bob',
          body: 'Looks risky around parser state.',
          state: 'COMMENTED',
          url: 'https://github.com/acme/api/pull/12#pullrequestreview-1',
          createdAt: '2026-03-12T00:10:00.000Z',
        },
      ],
    });

    expect(prompt).toContain('## Trigger');
    expect(prompt).toContain('@homie please review');
    expect(prompt).toContain('## Recent Activity');
    expect(prompt).toContain('review [COMMENTED] by bob');
  });
});
