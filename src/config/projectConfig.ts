/**
 * Pure project-config parse / validate / merge.
 * No vscode imports — unit-testable.
 */

export type SerialLabParity = 'none' | 'even' | 'odd' | 'mark' | 'space';
export type SerialLabStopBits = 1 | 1.5 | 2;
export type SerialLabFlowControl = 'none' | 'hardware' | 'software';
export type SerialLabProtocolKind = 'raw' | 'justfloat' | 'firewater' | 'custom';

export type ProjectSerialConfig = {
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  parity?: SerialLabParity;
  stopBits?: SerialLabStopBits;
  flowControl?: SerialLabFlowControl;
};

export type ProjectProtocolConfig = {
  kind: SerialLabProtocolKind;
  /** Required when kind === 'custom'. References CustomProtocolConfig.id. */
  customId?: string;
};

/** Presentation only — never id/path. */
export type ProjectChannelOverride = {
  displayName?: string;
  unit?: string;
  color?: string;
  visible?: boolean;
};

export type SerialLabProjectConfig = {
  version: 1;
  serial?: ProjectSerialConfig;
  protocol?: ProjectProtocolConfig;
  /** Keyed by stable Channel.id. */
  channels?: Record<string, ProjectChannelOverride>;
};

export type ParseProjectConfigResult =
  | { ok: true; config: SerialLabProjectConfig }
  | { ok: false; error: string };

const COLOR_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseSerial(raw: unknown): { ok: true; serial: ProjectSerialConfig } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'serial must be an object' };
  const serial: ProjectSerialConfig = {};
  if (raw.baudRate !== undefined) {
    if (typeof raw.baudRate !== 'number' || !Number.isInteger(raw.baudRate) || raw.baudRate <= 0) {
      return { ok: false, error: 'serial.baudRate must be a positive integer' };
    }
    serial.baudRate = raw.baudRate;
  }
  if (raw.dataBits !== undefined) {
    if (![5, 6, 7, 8].includes(raw.dataBits as number)) {
      return { ok: false, error: 'serial.dataBits must be 5|6|7|8' };
    }
    serial.dataBits = raw.dataBits as 5 | 6 | 7 | 8;
  }
  if (raw.parity !== undefined) {
    if (!['none', 'even', 'odd', 'mark', 'space'].includes(raw.parity as string)) {
      return { ok: false, error: 'serial.parity must be none|even|odd|mark|space' };
    }
    serial.parity = raw.parity as SerialLabParity;
  }
  if (raw.stopBits !== undefined) {
    if (![1, 1.5, 2].includes(raw.stopBits as number)) {
      return { ok: false, error: 'serial.stopBits must be 1|1.5|2' };
    }
    serial.stopBits = raw.stopBits as SerialLabStopBits;
  }
  if (raw.flowControl !== undefined) {
    if (!['none', 'hardware', 'software'].includes(raw.flowControl as string)) {
      return { ok: false, error: 'serial.flowControl must be none|hardware|software' };
    }
    serial.flowControl = raw.flowControl as SerialLabFlowControl;
  }
  return { ok: true, serial };
}

function parseProtocol(
  raw: unknown
): { ok: true; protocol: ProjectProtocolConfig } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'protocol must be an object' };
  const kind = raw.kind;
  if (!['raw', 'justfloat', 'firewater', 'custom'].includes(kind as string)) {
    return { ok: false, error: 'protocol.kind must be raw|justfloat|firewater|custom' };
  }
  if (kind === 'custom') {
    if (typeof raw.customId !== 'string' || !raw.customId.trim()) {
      return { ok: false, error: 'protocol.customId is required when kind is custom' };
    }
    return { ok: true, protocol: { kind: 'custom', customId: raw.customId.trim() } };
  }
  return { ok: true, protocol: { kind: kind as Exclude<SerialLabProtocolKind, 'custom'> } };
}

function parseChannels(
  raw: unknown
): { ok: true; channels: Record<string, ProjectChannelOverride> } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'channels must be an object keyed by channel id' };
  const channels: Record<string, ProjectChannelOverride> = {};
  for (const [id, val] of Object.entries(raw)) {
    if (!id.trim()) return { ok: false, error: 'channel id must be non-empty' };
    if (!isObj(val)) return { ok: false, error: `channels["${id}"] must be an object` };
    // Reject identity fields — project config cannot override id/path.
    if ('id' in val || 'path' in val) {
      return {
        ok: false,
        error: `channels["${id}"] must not override id or path (use protocol metadata)`,
      };
    }
    const ch: ProjectChannelOverride = {};
    if (val.displayName !== undefined) {
      if (typeof val.displayName !== 'string') {
        return { ok: false, error: `channels["${id}"].displayName must be a string` };
      }
      ch.displayName = val.displayName;
    }
    if (val.unit !== undefined) {
      if (typeof val.unit !== 'string') {
        return { ok: false, error: `channels["${id}"].unit must be a string` };
      }
      ch.unit = val.unit;
    }
    if (val.color !== undefined) {
      if (typeof val.color !== 'string' || !COLOR_RE.test(val.color)) {
        return { ok: false, error: `channels["${id}"].color must be #RGB or #RRGGBB` };
      }
      ch.color = val.color;
    }
    if (val.visible !== undefined) {
      if (typeof val.visible !== 'boolean') {
        return { ok: false, error: `channels["${id}"].visible must be a boolean` };
      }
      ch.visible = val.visible;
    }
    channels[id] = ch;
  }
  return { ok: true, channels };
}

/** Parse and validate project JSON text. */
export function parseProjectConfig(text: string): ParseProjectConfigResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
  return parseProjectConfigValue(raw);
}

export function parseProjectConfigValue(raw: unknown): ParseProjectConfigResult {
  if (!isObj(raw)) return { ok: false, error: 'config root must be an object' };
  if (raw.version !== 1) {
    return { ok: false, error: `unsupported version: ${String(raw.version)} (expected 1)` };
  }
  const config: SerialLabProjectConfig = { version: 1 };
  if (raw.serial !== undefined) {
    const s = parseSerial(raw.serial);
    if (!s.ok) return s;
    config.serial = s.serial;
  }
  if (raw.protocol !== undefined) {
    const p = parseProtocol(raw.protocol);
    if (!p.ok) return p;
    config.protocol = p.protocol;
  }
  if (raw.channels !== undefined) {
    const c = parseChannels(raw.channels);
    if (!c.ok) return c;
    config.channels = c.channels;
  }
  return { ok: true, config };
}

/** Defaults used when neither project nor VS Code settings provide a value. */
export const EXTENSION_DEFAULTS = {
  baudRate: 115200,
  dataBits: 8 as const,
  parity: 'none' as const,
  stopBits: 1 as const,
  flowControl: 'none' as const,
  protocolKind: 'justfloat' as const,
};

export type VsCodeLayer = {
  baudRate?: number;
  dataBits?: number;
  parity?: string;
  stopBits?: number;
  protocolKind?: string;
  customId?: string;
};

export type EffectiveSerial = {
  baudRate: number;
  dataBits: number;
  parity: string;
  stopBits: number;
  flowControl: string;
};

export type EffectiveProtocol = {
  kind: string;
  customId?: string;
};

export type EffectiveConfig = {
  serial: EffectiveSerial;
  protocol: EffectiveProtocol;
  /** Channel overrides from project only (id → override). */
  channels: Record<string, ProjectChannelOverride>;
  /** Which layer supplied protocol.kind (for debugging). */
  sources: {
    serial: 'project' | 'vscode' | 'default';
    protocol: 'project' | 'vscode' | 'default';
  };
};

/**
 * Merge: .seriallab.json > VS Code settings > extension defaults.
 * Project fields only override when present.
 */
export function resolveEffectiveConfig(
  project: SerialLabProjectConfig | null,
  vs: VsCodeLayer
): EffectiveConfig {
  const pSerial = project?.serial;
  const pProto = project?.protocol;

  const serialSource: EffectiveConfig['sources']['serial'] = pSerial?.baudRate !== undefined
    ? 'project'
    : vs.baudRate !== undefined
      ? 'vscode'
      : 'default';

  const protocolSource: EffectiveConfig['sources']['protocol'] = pProto?.kind
    ? 'project'
    : vs.protocolKind
      ? 'vscode'
      : 'default';

  return {
    serial: {
      baudRate: pSerial?.baudRate ?? vs.baudRate ?? EXTENSION_DEFAULTS.baudRate,
      dataBits: (pSerial?.dataBits ?? vs.dataBits ?? EXTENSION_DEFAULTS.dataBits) as number,
      parity: (pSerial?.parity ?? vs.parity ?? EXTENSION_DEFAULTS.parity) as string,
      stopBits: (pSerial?.stopBits ?? vs.stopBits ?? EXTENSION_DEFAULTS.stopBits) as number,
      flowControl: pSerial?.flowControl ?? EXTENSION_DEFAULTS.flowControl,
    },
    protocol: {
      kind: pProto?.kind ?? vs.protocolKind ?? EXTENSION_DEFAULTS.protocolKind,
      customId: pProto?.customId ?? vs.customId,
    },
    channels: project?.channels ? { ...project.channels } : {},
    sources: {
      serial: serialSource,
      protocol: protocolSource,
    },
  };
}

export const PROJECT_CONFIG_FILENAME = '.seriallab.json';

export function minimalProjectConfigText(): string {
  return `${JSON.stringify({ version: 1 }, null, 2)}\n`;
}

/**
 * Transactional last-known-good update.
 * Invalid parse keeps previous project config; valid replaces it; file deleted clears.
 */
export function nextProjectLayer(
  lastGood: SerialLabProjectConfig | null,
  parse: ParseProjectConfigResult | { ok: true; config: null }
): { project: SerialLabProjectConfig | null; error: string | null } {
  if ('config' in parse && parse.config === null) {
    return { project: null, error: null };
  }
  if (!parse.ok) {
    return { project: lastGood, error: parse.error };
  }
  return { project: parse.config, error: null };
}
