import type {
  AccountUsageProvider,
  AccountUsageWindow,
  ReplyFn,
  TaskStatus,
  TaskStore,
} from '@homie/core';
import type { UsageStore } from '@homie/persistence';
import { formatTokens, shortId, timeSince, truncate } from './format';
import type { TaskRunner } from './task-runner';

export interface CommandDeps {
  taskStore: TaskStore;
  taskRunner: TaskRunner;
  usageStore?: UsageStore;
  accountUsage?: AccountUsageProvider;
}

export interface CommandContext {
  channel: string;
  chatId: string;
  userId: string | null;
  sessionId: string;
  command: string;
  args: string;
  reply: ReplyFn;
}

export interface CommandHandler {
  handle(ctx: CommandContext): Promise<boolean>;
}

const STATUS_ICON: Record<TaskStatus, string> = {
  queued: '⏳',
  running: '▶️',
  done: '✅',
  failed: '❌',
  aborted: '⛔',
};

export function createCommandHandler(deps: CommandDeps): CommandHandler {
  const { taskStore, taskRunner, usageStore, accountUsage } = deps;

  async function cmdList(ctx: CommandContext): Promise<true> {
    const tasks = await taskStore.listTasks(ctx.channel, ctx.chatId, 10);

    if (tasks.length === 0) {
      await ctx.reply('No tasks yet. Send a message to start one.');
      return true;
    }

    const lines = tasks.map((t) => {
      const icon = STATUS_ICON[t.status];
      const age = timeSince(t.createdAt);
      return `${icon} \`${shortId(t.id)}\` ${truncate(t.text ?? '(no text)', 60)} (${age} ago)`;
    });

    await ctx.reply(`Recent tasks:\n${lines.join('\n')}`);
    return true;
  }

  async function cmdStatus(ctx: CommandContext): Promise<true> {
    const lines = buildLifetimeUsageLines(usageStore);
    appendAccountUsageLines(lines, await accountUsage?.getAccountUsage());

    await ctx.reply(lines.length > 0 ? lines.join('\n') : 'No usage data yet.');
    return true;
  }

  async function cmdAbort(ctx: CommandContext): Promise<true> {
    const aborted = await taskRunner.abort(ctx.channel, ctx.chatId);
    await ctx.reply(aborted ? 'Task aborted.' : 'No running task to abort.');
    return true;
  }

  async function cmdHelp(ctx: CommandContext): Promise<true> {
    const help = [
      'Send any message and Homie will work on it.',
      '',
      'Commands:',
      '/list — Recent tasks',
      '/status — Usage & token costs',
      '/abort — Cancel running task',
      '/help — Show this help',
    ].join('\n');
    await ctx.reply(help);
    return true;
  }

  return {
    async handle(ctx) {
      switch (ctx.command) {
        case 'list':
          return cmdList(ctx);
        case 'status':
          return cmdStatus(ctx);
        case 'abort':
          return cmdAbort(ctx);
        case 'help':
        case 'start':
          return cmdHelp(ctx);
        default:
          return false;
      }
    },
  };
}

// --- Usage formatting ---

function buildLifetimeUsageLines(usageStore: UsageStore | undefined): string[] {
  if (!usageStore) {
    return [];
  }

  const lifetime = usageStore.getLifetimeSummary();
  if (lifetime.runs === 0) {
    return [];
  }

  return [
    `Token costs: $${lifetime.totalCostUsd.toFixed(2)}`,
    `${lifetime.runs} runs · ${formatTokens(lifetime.inputTokens + lifetime.outputTokens)} tokens`,
  ];
}

function appendAccountUsageLines(
  lines: string[],
  windows: AccountUsageWindow[] | null | undefined,
): void {
  if (!windows) {
    return;
  }

  for (const window of windows) {
    lines.push('', formatUsageSummary(window));
  }
}

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  hour12: true,
  timeZoneName: 'short',
});

const DATE_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  hour12: true,
  timeZoneName: 'short',
});

function formatUsageSummary(window: AccountUsageWindow): string {
  const pct = Math.round(window.percentUsed);
  const resetStr = formatResetTime(window.resetsAt);
  return `${window.label} ${pct}% used Resets ${resetStr}`;
}

function formatResetTime(iso: string): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  const now = new Date();

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return sameDay ? TIME_FMT.format(date) : DATE_TIME_FMT.format(date);
}
