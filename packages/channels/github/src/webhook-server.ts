import { createLogger } from '@homie/observability';
import type { WebhookOptions } from './types';
import type { WebhookEvent } from './webhook-mapper';
import { verifyWebhookSignature } from './webhook-verify';

const log = createLogger('github:webhook');

export interface WebhookServerOptions extends WebhookOptions {
  onEvent: (event: WebhookEvent) => void;
}

export interface WebhookServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createWebhookServer(opts: WebhookServerOptions): WebhookServer {
  let server: ReturnType<typeof Bun.serve> | null = null;

  return {
    async start() {
      server = Bun.serve({
        port: opts.port,
        async fetch(req: Request) {
          const url = new URL(req.url);

          if (req.method !== 'POST' || url.pathname !== opts.path) {
            return new Response('Not Found', { status: 404 });
          }

          const eventType = req.headers.get('x-github-event');

          if (eventType === 'ping') {
            log.info('Received GitHub webhook ping');
            return new Response('pong', { status: 202 });
          }

          const deliveryId = req.headers.get('x-github-delivery');
          if (!eventType || !deliveryId) {
            return new Response('Missing GitHub headers', { status: 400 });
          }

          const body = await req.text();
          const signature = req.headers.get('x-hub-signature-256');

          if (!signature || !(await verifyWebhookSignature(body, signature, opts.secret))) {
            log.warn('Webhook signature verification failed', { deliveryId });
            return new Response('Unauthorized', { status: 401 });
          }

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(body) as Record<string, unknown>;
          } catch {
            return new Response('Invalid JSON', { status: 400 });
          }

          log.info('Received GitHub webhook event', { eventType, deliveryId });
          opts.onEvent({ eventType, deliveryId, payload });

          return new Response('OK', { status: 200 });
        },
      });

      log.info('Webhook server listening', { port: opts.port, path: opts.path });
    },

    async stop() {
      if (server) {
        server.stop(true);
        server = null;
        log.info('Webhook server stopped');
      }
    },
  };
}
