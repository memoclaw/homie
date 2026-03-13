export type GitHubSubjectType = 'PullRequest' | 'Issue' | 'Discussion';

export interface GitHubWorkflowScope {
  repos: string[];
  users?: string[];
  excludeUsers?: string[];
  subjectTypes?: GitHubSubjectType[];
}

export interface GitHubWorkflowDefinition extends GitHubWorkflowScope {
  id: string;
  name: string;
  description?: string;
  agentModel?: string | null;
  postMode?: 'comment' | 'review';
}

export interface LoadedGitHubWorkflow {
  definition: GitHubWorkflowDefinition;
  workflowMarkdown: string;
  definitionPath: string;
  workflowPath: string;
}

export interface GitHubEventContext {
  eventId: string;
  repo: string;
  actor: string | null;
  subjectType: GitHubSubjectType;
  updatedAt: string;
}

export interface GitHubEventSummary {
  id: string;
  repo: string;
  subjectType: GitHubSubjectType;
  updatedAt: string;
}

export interface GitHubEventDetails extends GitHubEventContext {
  title: string;
  url: string;
  number: number | null;
  body: string | null;
  triggerText: string | null;
  commentsUrl: string | null;
  activity: GitHubActivityItem[];
}

export interface GitHubWorkflowMatch {
  matched: boolean;
  reason?: string;
}

export interface GitHubWorkflowDecision {
  handle: boolean;
  reason: string;
  action?: 'reply';
  reply?: string;
}

export interface GitHubActivityItem {
  type: 'issue_comment' | 'review';
  author: string | null;
  body: string | null;
  state?: string | null;
  url: string | null;
  createdAt: string;
}

export interface WebhookOptions {
  port: number;
  path: string;
  secret: string;
}
