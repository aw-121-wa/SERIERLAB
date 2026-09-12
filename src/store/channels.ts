import {
  builtinChannelId,
  builtinChannelPath,
  customChannelId,
  customChannelPath,
  legacyCustomChannelId,
} from './channelIdentity';

export type ChannelView = {
  /** Stable internal identity. Never changes when displayName/color/visible/unit change. */
  id: string;
  /** Stable semantic path for project config / recorder / native protocol. */
  path: string;
  /** User-editable presentation name. */
  displayName: string;
  unit?: string;
  color: string;
  visible: boolean;
};

/** Legacy saved-pref shape (pre-S8 used `name`). */
export type LegacyChannelPref = {
  name?: string;
  displayName?: string;
  color?: string;
  visible?: boolean;
  unit?: string;
  path?: string;
};

export type ChannelSyncResult = {
  /** Order strictly matches batch.values[i]. */
  ids: string[];
  /** Only newly registered or metadata-actually-changed channels. */
  changed: ChannelView[];
};

export type CustomChannelMeta = {
  index: number;
  name: string;
  path?: string;
  unit?: string;
  color?: string;
};

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];

function defaultColor(sourceIndex: number): string {
  return COLORS[sourceIndex % COLORS.length]!;
}

function displayNameOf(
  meta: CustomChannelMeta | undefined,
  fallbackIndex: number
): string {
  return meta?.name?.trim() || `ch${fallbackIndex}`;
}

/**
 * Registry owns control-plane metadata.
 * Data plane only carries stable channel ids + values.
 */
export class ChannelRegistry {
  private channels = new Map<string, ChannelView>();
  /** Saved prefs keyed by id (may include legacy keys until next save). */
  private saved: Record<string, LegacyChannelPref> = {};

  /**
   * Store saved prefs for apply-on-discovery.
   * Does not pre-insert channels so the first sync still reports `changed`
   * (control plane → SeriesStore.setMeta) exactly once.
   */
  applySavedPrefs(saved: Record<string, LegacyChannelPref>): void {
    this.saved = { ...saved };
  }

  /** Backward-compatible alias used by older call sites. */
  applySaved(saved: Record<string, LegacyChannelPref>): void {
    this.applySavedPrefs(saved);
  }

  toSaved(): Record<string, ChannelView> {
    const out: Record<string, ChannelView> = {};
    for (const [id, v] of this.channels) out[id] = v;
    return out;
  }

  get(id: string): ChannelView | undefined {
    return this.channels.get(id);
  }

  has(id: string): boolean {
    return this.channels.has(id);
  }

  list(): ChannelView[] {
    return [...this.channels.values()];
  }

  setDisplayName(id: string, displayName: string): void {
    const c = this.channels.get(id);
    if (c) c.displayName = displayName;
  }

  /** Legacy name — only mutates displayName. */
  setAlias(id: string, name: string): void {
    this.setDisplayName(id, name);
  }

  setColor(id: string, color: string): void {
    const c = this.channels.get(id);
    if (c) c.color = color;
  }

  setVisible(id: string, visible: boolean): void {
    const c = this.channels.get(id);
    if (c) c.visible = visible;
  }

  setUnit(id: string, unit: string | undefined): void {
    const c = this.channels.get(id);
    if (c) c.unit = unit;
  }

  /**
   * Builtin discovery: justfloat/firewater/raw.
   * id === path === protocolId.ch<sourceIndex> (frozen).
   */
  syncBuiltin(protocolId: string, count: number): ChannelSyncResult {
    const ids: string[] = [];
    const changed: ChannelView[] = [];
    for (let i = 0; i < count; i++) {
      const id = builtinChannelId(protocolId, i);
      ids.push(id);
      const path = builtinChannelPath(protocolId, i);
      const ch = this.ensure(id, path, `ch${i}`, undefined, defaultColor(i), undefined);
      if (ch) changed.push(ch);
    }
    return { ids, changed };
  }

  /**
   * Custom discovery: stable id by protocol config id + source index.
   * @param protocolConfigId CustomProtocolConfig.id (not router kind)
   */
  syncCustom(
    protocolConfigId: string,
    count: number,
    channelMeta?: CustomChannelMeta[]
  ): ChannelSyncResult {
    const ids: string[] = [];
    const changed: ChannelView[] = [];
    for (let i = 0; i < count; i++) {
      const meta = channelMeta?.find((m) => m.index === i) ?? channelMeta?.[i];
      const id = customChannelId(protocolConfigId, i);
      ids.push(id);
      const path = customChannelPath(protocolConfigId, i, meta?.path);
      const displayName = displayNameOf(meta, i);
      if (this.channels.has(id)) {
        const u = this.updateCustomMeta(id, {
          displayName: meta?.name,
          unit: meta?.unit,
          path: meta?.path ? path : undefined,
          color: meta?.color,
        });
        if (u) changed.push(u);
      } else {
        const ch = this.ensure(id, path, displayName, meta?.unit, meta?.color ?? defaultColor(i), {
          protocolConfigId,
          sourceIndex: i,
          name: meta?.name,
        });
        if (ch) changed.push(ch);
      }
    }
    return { ids, changed };
  }

  /**
   * Generic sync used by AppController.
   * For builtin protocols pass protocolKind (justfloat|firewater|raw).
   * For custom pass protocolKind='custom' and protocolConfigId.
   */
  syncFromBatch(
    count: number,
    protocolKind: string,
    options?: {
      protocolConfigId?: string;
      channelMeta?: CustomChannelMeta[];
    }
  ): ChannelSyncResult {
    if (protocolKind === 'custom') {
      const cfgId = options?.protocolConfigId || 'none';
      return this.syncCustom(cfgId, count, options?.channelMeta);
    }
    return this.syncBuiltin(protocolKind, count);
  }

  /**
   * Ensure channel exists. Returns view only when newly registered.
   * Applies saved/legacy prefs at registration time only (hot path stays cold).
   */
  private ensure(
    id: string,
    path: string,
    defaultDisplayName: string,
    unit: string | undefined,
    color: string,
    legacyHint?: { protocolConfigId: string; sourceIndex: number; name?: string }
  ): ChannelView | null {
    const existing = this.channels.get(id);
    if (existing) return null;

    const pref = this.saved[id];
    const legacyPref = !pref && legacyHint ? this.lookupLegacyPref(legacyHint) : undefined;
    const usePref = pref ?? legacyPref;

    const next: ChannelView = {
      id,
      path: usePref?.path ?? path,
      displayName: usePref?.displayName ?? usePref?.name ?? defaultDisplayName,
      unit: usePref?.unit ?? unit,
      color: usePref?.color ?? color,
      visible: usePref?.visible ?? true,
    };
    this.channels.set(id, next);
    return next;
  }

  /** Update presentation from custom config without changing id/path. */
  updateCustomMeta(
    id: string,
    meta: { displayName?: string; unit?: string; path?: string; color?: string }
  ): ChannelView | null {
    const c = this.channels.get(id);
    if (!c) return null;
    let dirty = false;
    // Do not clobber user saved prefs.
    const pref = this.saved[id];
    if (meta.displayName && !pref?.displayName && !pref?.name && c.displayName !== meta.displayName) {
      c.displayName = meta.displayName;
      dirty = true;
    }
    if (meta.unit !== undefined && !pref?.unit && c.unit !== meta.unit) {
      c.unit = meta.unit;
      dirty = true;
    }
    if (meta.path && !pref?.path && c.path !== meta.path) {
      c.path = meta.path;
      dirty = true;
    }
    if (meta.color && !pref?.color && c.color !== meta.color) {
      c.color = meta.color;
      dirty = true;
    }
    return dirty ? c : null;
  }

  private lookupLegacyPref(hint: {
    protocolConfigId: string;
    sourceIndex: number;
    name?: string;
  }): LegacyChannelPref | undefined {
    const legacyId = legacyCustomChannelId(hint.sourceIndex, hint.name);
    const pref = this.saved[legacyId];
    if (!pref) return undefined;
    // Never override an explicit pref on the new id.
    if (this.saved[customChannelId(hint.protocolConfigId, hint.sourceIndex)]) return undefined;
    return pref;
  }
}
