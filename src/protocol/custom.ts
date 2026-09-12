import { SampleBatch, StreamDecoder } from './types';

export type CustomChannelMap = { index: number; name: string; color?: string };

export type CustomProtocolConfig = {
  id: string;
  name: string;
  mode: 'config' | 'script';
  lineEnding?: 'lf' | 'crlf' | 'cr';
  delimiter?: 'comma' | 'space' | 'tab' | 'semicolon' | string;
  trim?: boolean;
  skipPrefix?: string;
  channels?: CustomChannelMap[];
  allowChannelCountChange?: boolean;
  script?: string;
};

const MAX_PENDING = 64 * 1024;
const SCRIPT_SOFT_TIMEOUT_MS = 50;

function resolveDelimiter(d: CustomProtocolConfig['delimiter']): RegExp {
  switch (d) {
    case 'space':
      return /\s+/;
    case 'tab':
      return /\t+/;
    case 'semicolon':
      return /;+/;
    case 'comma':
    case undefined:
      return /,+/;
    default:
      return new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '+');
  }
}

export class CustomProtocolDecoder implements StreamDecoder {
  private pending = '';
  private runner: ((line: string) => number[] | null) | null = null;
  errors = 0;
  scriptTimeouts = 0;

  constructor(private readonly config: CustomProtocolConfig) {
    if (config.mode === 'script' && config.script) {
      try {
        this.runner = new Function('line', config.script) as (line: string) => number[] | null;
      } catch {
        this.runner = null;
        this.errors += 1;
      }
    }
  }

  reset(): void {
    this.pending = '';
  }

  feed(chunk: Uint8Array, tMs: number): SampleBatch[] {
    this.pending += new TextDecoder('utf-8', { fatal: false }).decode(chunk);
    if (this.pending.length > MAX_PENDING) {
      this.pending = this.pending.slice(-MAX_PENDING);
      this.errors += 1;
    }
    const out: SampleBatch[] = [];
    for (;;) {
      const idx = this.pending.search(/\r\n|\n|\r/);
      if (idx < 0) break;
      const line = this.pending.slice(0, idx);
      const step = this.pending.startsWith('\r\n', idx) ? 2 : 1;
      this.pending = this.pending.slice(idx + step);
      const values = this.parseLine(line);
      if (values) out.push({ tMs, values });
    }
    return out;
  }

  private parseLine(line: string): number[] | null {
    let text = line;
    if (this.config.trim !== false) text = text.trim();
    if (this.config.skipPrefix) {
      if (!text.startsWith(this.config.skipPrefix)) return null;
      text = text.slice(this.config.skipPrefix.length);
    }
    if (this.config.mode === 'script') return this.runScript(text);
    return this.parseConfig(text);
  }

  private parseConfig(text: string): number[] | null {
    const parts = text.split(resolveDelimiter(this.config.delimiter)).filter((s) => s.length > 0);
    const maps = this.config.channels;
    if (!maps || maps.length === 0) {
      const values: number[] = [];
      for (const p of parts) {
        const n = Number(p);
        if (!Number.isFinite(n)) {
          this.errors += 1;
          return null;
        }
        values.push(n);
      }
      return values.length ? values : null;
    }
    const values: number[] = [];
    for (const m of maps) {
      const n = Number(parts[m.index]);
      if (!Number.isFinite(n)) {
        this.errors += 1;
        return null;
      }
      values.push(n);
    }
    return values;
  }

  private runScript(text: string): number[] | null {
    if (!this.runner) {
      this.errors += 1;
      return null;
    }
    const start = Date.now();
    try {
      const result = this.runner(text);
      if (Date.now() - start > SCRIPT_SOFT_TIMEOUT_MS) {
        this.scriptTimeouts += 1;
        this.errors += 1;
        return null;
      }
      if (result == null) return null;
      const values = result.filter((n) => Number.isFinite(n));
      if (values.length === 0) {
        this.errors += 1;
        return null;
      }
      return values;
    } catch {
      this.errors += 1;
      return null;
    }
  }
}
