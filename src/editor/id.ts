export function createId(prefix: string): string {
  const browserCrypto = typeof crypto !== 'undefined'
    ? (crypto as Crypto & { randomUUID?: () => string })
    : undefined;

  if (browserCrypto?.randomUUID) {
    return `${prefix}-${browserCrypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
