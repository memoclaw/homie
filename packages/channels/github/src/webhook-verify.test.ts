import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from './webhook-verify';

function sign(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${hmac}`;
}

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret-123';
  const payload = '{"action":"opened"}';

  test('accepts a valid signature', async () => {
    const signature = sign(payload, secret);
    expect(await verifyWebhookSignature(payload, signature, secret)).toBe(true);
  });

  test('rejects an invalid signature', async () => {
    const signature = sign(payload, 'wrong-secret');
    expect(await verifyWebhookSignature(payload, signature, secret)).toBe(false);
  });

  test('rejects a missing sha256= prefix', async () => {
    const hmac = createHmac('sha256', secret).update(payload).digest('hex');
    expect(await verifyWebhookSignature(payload, hmac, secret)).toBe(false);
  });

  test('rejects a truncated signature', async () => {
    const signature = sign(payload, secret);
    expect(await verifyWebhookSignature(payload, signature.slice(0, -4), secret)).toBe(false);
  });
});
