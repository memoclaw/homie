import type { GitHubNotificationDetails, LoadedGitHubWorkflow } from './types';

export function buildGitHubWorkflowPrompt(
  workflow: LoadedGitHubWorkflow,
  details: GitHubNotificationDetails,
): string {
  const activity =
    details.activity.length > 0
      ? details.activity
          .slice(-6)
          .map((item) => {
            const state = item.state ? ` [${item.state}]` : '';
            return [
              `- ${item.type}${state} by ${item.author ?? '(unknown)'} at ${item.createdAt}`,
              item.body ? indentBlock(item.body) : '  (no body)',
            ].join('\n');
          })
          .join('\n')
      : '(no recent activity available)';

  return [
    workflow.workflowMarkdown,
    '',
    '## Notification',
    `Workflow ID: ${workflow.definition.id}`,
    `Repository: ${details.repo}`,
    `Subject type: ${details.subjectType}`,
    `Title: ${details.title}`,
    `URL: ${details.url}`,
    `Actor: ${details.actor ?? '(unknown)'}`,
    `Number: ${details.number ?? '(unknown)'}`,
    '',
    '## Trigger',
    details.triggerText ? details.triggerText : details.body ? details.body : '(no body available)',
    '',
    '## Recent Activity',
    activity,
  ].join('\n');
}

function indentBlock(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}
