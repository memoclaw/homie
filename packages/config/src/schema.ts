import { z } from 'zod';

export const AppConfigSchema = z.object({
  app: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    dataDir: z.string().default('./data'),
  }),
  telegram: z.object({
    botToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
    allowedChatIds: z.array(z.union([z.string(), z.number()])).default([]),
  }),
  provider: z.object({
    kind: z.enum(['claude-code', 'codex']).default('claude-code'),
    model: z.string().default(''),
    extraArgs: z.array(z.string()).default([]),
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
