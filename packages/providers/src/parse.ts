export function asNumber(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
