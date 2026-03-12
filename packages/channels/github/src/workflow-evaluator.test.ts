import { describe, expect, test } from 'bun:test';
import { parseGitHubWorkflowDecision } from './workflow-evaluator';

describe('parseGitHubWorkflowDecision', () => {
  test('parses handle=true decisions', () => {
    const result = parseGitHubWorkflowDecision(
      JSON.stringify({
        handle: true,
        reason: 'review requested',
        action: 'reply',
        reply: 'I will review this.',
      }),
    );

    expect(result).toEqual({
      handle: true,
      reason: 'review requested',
      action: 'reply',
      reply: 'I will review this.',
    });
  });

  test('parses fenced json decisions', () => {
    const result = parseGitHubWorkflowDecision(
      '```json\n{"handle":false,"reason":"not actionable"}\n```',
    );

    expect(result).toEqual({
      handle: false,
      reason: 'not actionable',
      action: undefined,
      reply: undefined,
    });
  });

  test('rejects invalid decisions', () => {
    expect(() => parseGitHubWorkflowDecision('reviewed')).toThrow(
      'GitHub workflow response was not valid JSON',
    );
  });
});
