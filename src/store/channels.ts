export type ChannelView = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
};

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];

export class ChannelRegistry {
  private channels = new Map<string, ChannelView>();

  syncFromBatch(count: number, protocolId: string, names?: string[]): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const name = names?.[i] ?? `ch${i}`;
      const id = `${protocolId}.${name}`;
      ids.push(id);
      if (!this.channels.has(id)) {
        this.channels.set(id, {
          id,
          name,
          color: COLORS[i % COLORS.length]!,
          visible: true,
        });
      }
    }
    return ids;
  }

  setVisible(id: string, visible: boolean): void {
    const c = this.channels.get(id);
    if (c) c.visible = visible;
  }

  setAlias(id: string, name: string): void {
    const c = this.channels.get(id);
    if (c) c.name = name;
  }

  setColor(id: string, color: string): void {
    const c = this.channels.get(id);
    if (c) c.color = color;
  }

  list(): ChannelView[] {
    return [...this.channels.values()];
  }

  applySaved(saved: Record<string, Partial<ChannelView>>): void {
    for (const [id, v] of Object.entries(saved)) {
      const prev = this.channels.get(id);
      this.channels.set(id, {
        id,
        name: v.name ?? prev?.name ?? id,
        color: v.color ?? prev?.color ?? '#3b82f6',
        visible: v.visible ?? prev?.visible ?? true,
      });
    }
  }

  toSaved(): Record<string, ChannelView> {
    const out: Record<string, ChannelView> = {};
    for (const [id, v] of this.channels) out[id] = v;
    return out;
  }
}
