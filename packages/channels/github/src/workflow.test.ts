import { describe, expect, test } from 'bun:test';
import { loadGitHubWorkflow } from './loader';
import { matchGitHubWorkflow } from './matcher';

describe('loadGitHubWorkflow', () => {
  test('loads workflow definition and markdown from workflow directory', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/repo-watcher/WORKFLOW.md');

    expect(workflow.definition.id).toBe('repo-watcher');
    expect(workflow.definition.repos.length).toBeGreaterThan(0);
    expect(workflow.workflowMarkdown).toContain('Decision contract');
  });
});

describe('matchGitHubWorkflow', () => {
  test('matches notification within workflow scope', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/repo-watcher/WORKFLOW.md');
    const repo = workflow.definition.repos[0] ?? 'unknown/repo';
    const actor = workflow.definition.users?.[0] ?? 'someone';

    const result = matchGitHubWorkflow(workflow.definition, {
      eventId: 'test-1',
      repo,
      actor,
      subjectType: 'Issue',
      updatedAt: '2026-03-12T00:00:00.000Z',
    });

    expect(result).toEqual({ matched: true });
  });

  test('rejects notification outside workflow scope', async () => {
    const workflow = await loadGitHubWorkflow('workflows/github/repo-watcher/WORKFLOW.md');

    const result = matchGitHubWorkflow(workflow.definition, {
      eventId: 'test-2',
      repo: 'acme/web',
      actor: 'mallory',
      subjectType: 'Issue',
      updatedAt: '2026-03-12T00:00:00.000Z',
    });

    expect(result.matched).toBe(false);
    expect(result.reason).toContain('repo');
  });
});
