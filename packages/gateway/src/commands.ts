import type { ReplyFn, TaskStatus, TaskStore } from '@homie/core';
import type { UsageStore } from '@homie/persistence';
import { elapsedSince, formatElapsed, formatTokens, shortId, timeSince, truncate } from './format';
import type { TaskRunner } from './task-runner';

export interface CommandDeps {
  taskStore: TaskStore;
  taskRunner: TaskRunner;
  usageStore?: UsageStore;
  startedAt?: Date;
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
  const { taskStore, taskRunner, usageStore } = deps;

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
    const uptime = deps.startedAt
      ? formatElapsed(Math.floor((Date.now() - deps.startedAt.getTime()) / 1000))
      : 'unknown';

    const lines = [`Uptime: ${uptime}`];

    const [running, queued] = await Promise.all([
      taskStore.getRunningTask(ctx.channel, ctx.chatId),
      taskStore.getQueuedTasks(ctx.channel, ctx.chatId),
    ]);

    if (running) {
      lines.push(
        '',
        `Running task: \`${shortId(running.id)}\``,
        running.text ? `Message: ${truncate(running.text, 80)}` : '',
        `Elapsed: ${elapsedSince(running.createdAt)}`,
      );
    }

    if (queued.length > 0) {
      lines.push('', `Queued: ${queued.length} task(s)`);
    }

    if (usageStore) {
      const lifetime = usageStore.getLifetimeSummary();
      if (lifetime.runs > 0) {
        const total = lifetime.inputTokens + lifetime.outputTokens;
        lines.push('', `Lifetime: ${lifetime.runs} runs, ${formatTokens(total)} tokens`);
      }
    }

    await ctx.reply(lines.join('\n'));
    return true;
  }

  async function cmdAbort(ctx: CommandContext): Promise<true> {
    const aborted = await taskRunner.abort(ctx.channel, ctx.chatId);
    await ctx.reply(aborted ? 'Task aborted.' : 'No running task to abort.');
    return true;
  }

  async function cmdDelete(ctx: CommandContext): Promise<true> {
    const idPrefix = ctx.args.trim();
    if (!idPrefix) {
      await ctx.reply('Usage: /delete <task-id>');
      return true;
    }

    const tasks = await taskStore.listTasks(ctx.channel, ctx.chatId, 50);
    const match = tasks.filter((t) => t.id.startsWith(idPrefix));

    if (match.length === 0) {
      await ctx.reply('No task found with that ID.');
      return true;
    }
    if (match.length > 1) {
      await ctx.reply('Ambiguous ID — provide more characters.');
      return true;
    }

    const task = match[0]!;
    if (task.status === 'running' || task.status === 'queued') {
      await ctx.reply('Cannot delete a running or queued task. Use /abort first.');
      return true;
    }

    await taskStore.deleteTask(task.id);
    await ctx.reply(`Deleted task \`${shortId(task.id)}\``);
    return true;
  }

  async function cmdHelp(ctx: CommandContext): Promise<true> {
    const help = [
      'Send any message and Homie will work on it.',
      '',
      'Commands:',
      '/list — Recent tasks',
      '/status — System status & running task',
      '/abort — Cancel running task',
      '/delete <id> — Delete a task from history',
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
        case 'delete':
          return cmdDelete(ctx);
        case 'help':
        case 'start':
          return cmdHelp(ctx);
        default:
          return false;
      }
    },
  };
}
