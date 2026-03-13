import { z } from 'zod';

export const AppConfigSchema = z.object({
  app: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    dataDir: z.string().default('./data'),
  }),
  telegram: z.object({
    botToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  }),
  provider: z.object({
    model: z.string().default(''),
    extraArgs: z.array(z.string()).default([]),
  }),
  github: z
    .object({
      enabled: z.boolean().default(false),
      token: z.string().default(''),
      workflowsDir: z.string().default('./workflows/github'),
      webhook: z
        .object({
          port: z.number().int().positive().default(3100),
          path: z.string().default('/webhooks/github'),
          secret: z.string().default(''),
        })
        .default({}),
    })
    .default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
