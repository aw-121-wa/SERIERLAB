/**
 * Single source of truth for channel identity.
 * Builtin ids stay frozen (justfloat.ch0 / firewater.ch0 / …).
 * Custom ids are stable by protocol config id + source index, never by display name.
 */

export type BuiltinProtocolId = 'justfloat' | 'firewater' | 'raw';

/** justfloat.ch0 — frozen public identity. */
export function builtinChannelId(protocolId: string, sourceIndex: number): string {
  return `${protocolId}.ch${sourceIndex}`;
}

/** custom.<protocolConfigId>.idx<sourceIndex> — stable across renames. */
export function customChannelId(protocolConfigId: string, sourceIndex: number): string {
  return `custom.${protocolConfigId}.idx${sourceIndex}`;
}

/**
 * Semantic path for custom channels.
 * Uses configured path when present; otherwise custom.<protocolId>.ch<sourceIndex>.
 * Never derived from displayName.
 */
export function customChannelPath(
  protocolConfigId: string,
  sourceIndex: number,
  configuredPath?: string
): string {
  const p = configuredPath?.trim();
  if (p) return p;
  return `custom.${protocolConfigId}.ch${sourceIndex}`;
}

/** Builtin path === id (frozen). */
export function builtinChannelPath(protocolId: string, sourceIndex: number): string {
  return builtinChannelId(protocolId, sourceIndex);
}

/**
 * Legacy identity used before S8:
 *   `${protocolKind}.${name ?? 'ch' + sourceIndex}`
 * For custom, protocolKind was always the string "custom" (not the config id).
 */
export function legacyChannelId(protocolKind: string, sourceIndex: number, name?: string): string {
  return `${protocolKind}.${name ?? `ch${sourceIndex}`}`;
}

export function legacyCustomChannelId(sourceIndex: number, name?: string): string {
  return legacyChannelId('custom', sourceIndex, name);
}
