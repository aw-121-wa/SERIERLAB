export function encodeHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
}

export function decodeHex(text: string): Uint8Array {
  const cleaned = text.replace(/\s+/g, '');
  if (cleaned.length === 0) return new Uint8Array(0);
  if (cleaned.length % 2 !== 0) throw new Error('HEX length must be even');
  if (!/^[0-9A-Fa-f]+$/.test(cleaned)) throw new Error('HEX contains invalid characters');
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
