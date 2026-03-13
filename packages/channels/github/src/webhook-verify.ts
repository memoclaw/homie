import { timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();
let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function getKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.secret === secret) {
    return cachedKey.key;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  cachedKey = { secret, key };
  return key;
}

export async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const key = await getKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expected = Buffer.from(new Uint8Array(signature)).toString('hex');
  const actual = signatureHeader.slice('sha256='.length);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}
