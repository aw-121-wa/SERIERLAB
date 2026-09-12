# Serial Lab VSCode Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VSCode extension that connects to a serial port, decodes JustFloat / FireWater / RawData / user-defined protocols, plots channels in a webview, supports text/HEX send-receive, and exports samples/logs.

**Architecture:** Extension host owns `serialport` I/O, protocol decoding, bounded buffers, and export. A single WebviewPanel renders uPlot waveform + terminal + send bar and talks to the host via batched `postMessage`. Sidebar (WebviewView) configures connection, protocol, and channels.

**Tech Stack:** TypeScript, VSCode Extension API 1.90+, `serialport` ^12, uPlot ^1.6, vitest for pure unit tests, npm + `@vscode/vsce` for packaging.

**Spec:** `docs/superpowers/specs/2026-09-10-serial-lab-vscode-extension-design.md`

## Global Constraints

- Product display name: **Serial Lab**; extension id: `local.serial-lab`.
- Default serial: 115200, 8N1, no flow control.
- Built-in protocols: JustFloat (LE float32 + tail `00 00 80 7F`), FireWater (text float line), RawData.
- Custom protocols: config mode + script mode, stored in workspace settings `serialLab.protocols`.
- RX display and send both support text and HEX; line endings none/lf/cr/crlf.
- Raw RX buffer default 2 MiB; series history default 60s; terminal display cap ~1 MiB / 2000 lines.
- Never block serial read on webview; batch UI updates (~30–60 FPS), no per-sample messages.
- Original code license MPL-2.0 in `LICENSE` + README notices for serialport/uPlot.
- Do not implement: node editor, CAN, FFT, AI, multi-serial, Dock layout, binary custom protocol.
- Work in repository root `D:\myvofa`. Prefer pure logic in `src/**` with vitest; UI verified by F5.
- Commit only when a task step says so; message style `feat:` / `fix:` / `test:` / `docs:` / `chore:`.

---

## File Structure

```text
package.json                 Extension manifest, commands, configuration schema
tsconfig.json                Strict TS compile to out/
vitest.config.ts             Unit test runner (no VSCode host)
LICENSE                      MPL-2.0
README.md                    Install, F5, usage, protocols
.vscode/launch.json          F5 Extension Development Host
.vscode/tasks.json           npm: watch
src/extension.ts             activate/deactivate, command wiring
src/log.ts                   OutputChannel logger
src/serial/types.ts          PortInfo, ConnectionState, counters
src/serial/serialService.ts  enumerate/open/close/write + events
src/protocol/types.ts        Decoder interface, SampleBatch, ProtocolId
src/protocol/hex.ts          encodeHex / decodeHex
src/protocol/justfloat.ts    JustFloatDecoder
src/protocol/firewater.ts    FireWaterDecoder
src/protocol/raw.ts          RawDataDecoder
src/protocol/custom.ts       CustomProtocolDecoder (config + script)
src/protocol/router.ts       ProtocolRouter
src/store/rawBuffer.ts       Bounded RX/TX display buffer
src/store/seriesStore.ts     Bounded per-channel series
src/store/channels.ts        ChannelRegistry
src/state/workspaceState.ts  Load/save connection, protocol, channels, custom list
src/export/exportService.ts  CSV samples + raw text log
src/webview/bridge.ts        Typed postMessage protocol
src/webview/panel.ts         Waveform/terminal WebviewPanel
src/webview/sidebar.ts       Connection/protocol/channel WebviewView
src/webview/media/main.js    Panel UI + uPlot glue
src/webview/media/main.css   Panel styles
src/webview/media/uplot.min.js  Vendored uPlot
src/webview/media/sidebar.js Sidebar UI
src/webview/media/sidebar.css
src/test/hex.test.ts
src/test/justfloat.test.ts
src/test/firewater.test.ts
src/test/custom.test.ts
src/test/rawBuffer.test.ts
src/test/seriesStore.test.ts
docs/superpowers/specs/2026-09-10-serial-lab-vscode-extension-design.md
docs/superpowers/plans/2026-09-10-serial-lab-vscode-extension.md
```

---

### Task 1: Extension scaffold and vitest harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `LICENSE`, `README.md`, `.vscode/launch.json`, `.vscode/tasks.json`, `src/extension.ts`, `src/log.ts`, `src/test/smoke.test.ts`

**Interfaces:**
- Produces: `activate(context: vscode.ExtensionContext): void`, `deactivate(): void`, `log: { info, warn, error }`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "serial-lab",
  "displayName": "Serial Lab",
  "description": "Serial debugging workbench: protocols, waveform, terminal, export",
  "version": "0.1.0",
  "publisher": "local",
  "license": "MPL-2.0",
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Other", "Debuggers"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "serialLab",
          "title": "Serial Lab",
          "icon": "$(radio-tower)"
        }
      ]
    },
    "views": {
      "serialLab": [
        {
          "id": "serialLab.sidebar",
          "name": "Workbench",
          "type": "webview"
        }
      ]
    },
    "commands": [
      { "command": "serialLab.openWorkbench", "title": "Serial Lab: Open Workbench" },
      { "command": "serialLab.refreshPorts", "title": "Serial Lab: Refresh Ports" },
      { "command": "serialLab.connect", "title": "Serial Lab: Connect" },
      { "command": "serialLab.disconnect", "title": "Serial Lab: Disconnect" },
      { "command": "serialLab.exportSamples", "title": "Serial Lab: Export Samples CSV" },
      { "command": "serialLab.exportRawLog", "title": "Serial Lab: Export Raw Log" }
    ],
    "configuration": {
      "title": "Serial Lab",
      "properties": {
        "serialLab.connection": {
          "type": "object",
          "default": { "path": "", "baudRate": 115200, "dataBits": 8, "parity": "none", "stopBits": 1 },
          "description": "Last serial connection settings"
        },
        "serialLab.protocol": {
          "type": "string",
          "default": "justfloat",
          "enum": ["justfloat", "firewater", "raw", "custom"],
          "description": "Active protocol id (custom uses serialLab.activeCustomProtocolId)"
        },
        "serialLab.activeCustomProtocolId": {
          "type": "string",
          "default": "",
          "description": "Selected custom protocol id when serialLab.protocol is custom"
        },
        "serialLab.protocols": {
          "type": "array",
          "default": [],
          "description": "User-defined custom protocols"
        },
        "serialLab.channels": {
          "type": "object",
          "default": {},
          "description": "Per-channel alias, color, visible keyed by stable id"
        },
        "serialLab.terminal": {
          "type": "object",
          "default": { "rxEncoding": "text", "txEncoding": "text", "txLineEnding": "lf" },
          "description": "Terminal encodings and TX line ending"
        },
        "serialLab.historySeconds": {
          "type": "number",
          "default": 60,
          "minimum": 5,
          "maximum": 600
        },
        "serialLab.rawBufferBytes": {
          "type": "number",
          "default": 2097152,
          "minimum": 65536
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "vsce package"
  },
  "dependencies": {
    "serialport": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/vscode": "^1.90.0",
    "@types/serialport": "^12.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

Note: `@types/serialport` may be unused if serialport ships types; if install fails, drop it.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create LICENSE** with full MPL-2.0 text (standard Mozilla MPL 2.0).

- [ ] **Step 5: Create src/log.ts**

```ts
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getLog(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Serial Lab');
  }
  return channel;
}

export const log = {
  info: (m: string) => getLog().appendLine(`[info] ${m}`),
  warn: (m: string) => getLog().appendLine(`[warn] ${m}`),
  error: (m: string) => getLog().appendLine(`[error] ${m}`),
};
```

- [ ] **Step 6: Create src/extension.ts**

```ts
import * as vscode from 'vscode';
import { log } from './log';

export function activate(context: vscode.ExtensionContext): void {
  log.info('Serial Lab activated');
  context.subscriptions.push(
    vscode.commands.registerCommand('serialLab.openWorkbench', () => {
      void vscode.window.showInformationMessage('Serial Lab workbench opens in Task 9');
    })
  );
}

export function deactivate(): void {}
```

- [ ] **Step 7: Create launch.json / tasks.json**

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/out/**/*.js"],
      "preLaunchTask": "npm: watch"
    }
  ]
}
```

`.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "problemMatcher": "$tsc-watch",
      "isBackground": true,
      "presentation": { "reveal": "never" },
      "group": { "kind": "build", "isDefault": true }
    }
  ]
}
```

- [ ] **Step 8: Create smoke test and run install/compile/test**

`src/test/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('scaffold', () => {
  it('adds', () => {
    expect(1 + 1).toBe(2);
  });
});
```

```powershell
npm install
npm run compile
npm test
```

Expected: compile succeeds; vitest PASS.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m "chore: scaffold serial-lab extension with vitest"
```

---

### Task 2: HEX codec and RawBuffer

**Files:**
- Create: `src/protocol/hex.ts`, `src/store/rawBuffer.ts`, `src/test/hex.test.ts`, `src/test/rawBuffer.test.ts`

**Interfaces:**
- Produces:
  - `encodeHex(buf: Uint8Array): string` — uppercase pairs separated by single space
  - `decodeHex(text: string): Uint8Array` — throws `Error` on invalid token
  - `class RawBuffer` with `push(chunk: Uint8Array, dir: 'RX'|'TX', tMs: number): void`, `droppedBytes: number`, `toArray(): Uint8Array`, `entries(): RawEntry[]`
  - `type RawEntry = { tMs: number; dir: 'RX'|'TX'; bytes: Uint8Array }`

- [ ] **Step 1: Write failing tests**

`src/test/hex.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeHex, encodeHex } from '../protocol/hex';

describe('hex', () => {
  it('encodes uppercase spaced pairs', () => {
    expect(encodeHex(new Uint8Array([0, 15, 255]))).toBe('00 0F FF');
  });
  it('decodes with optional whitespace', () => {
    expect(Array.from(decodeHex('00 0f\nFF'))).toEqual([0, 15, 255]);
  });
  it('rejects odd length and bad chars', () => {
    expect(() => decodeHex('0')).toThrow();
    expect(() => decodeHex('GG')).toThrow();
  });
});
```

`src/test/rawBuffer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RawBuffer } from '../store/rawBuffer';

describe('RawBuffer', () => {
  it('drops oldest when exceeding capacity', () => {
    const b = new RawBuffer(8);
    b.push(new Uint8Array([1, 2, 3, 4, 5]), 'RX', 1);
    b.push(new Uint8Array([6, 7, 8, 9, 10]), 'RX', 2);
    expect(b.droppedBytes).toBeGreaterThan(0);
    const all = b.toArray();
    expect(all.length).toBeLessThanOrEqual(8);
    expect(all[all.length - 1]).toBe(10);
  });
  it('keeps TX/RX entries', () => {
    const b = new RawBuffer(64);
    b.push(new Uint8Array([1]), 'RX', 10);
    b.push(new Uint8Array([2]), 'TX', 11);
    expect(b.entries()).toHaveLength(2);
    expect(b.entries()[1]!.dir).toBe('TX');
  });
});
```

- [ ] **Step 2: Run tests to verify fail**

```powershell
npm test
```

Expected: FAIL module not found.

- [ ] **Step 3: Implement**

`src/protocol/hex.ts`:

```ts
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
```

`src/store/rawBuffer.ts`:

```ts
export type RawDir = 'RX' | 'TX';
export type RawEntry = { tMs: number; dir: RawDir; bytes: Uint8Array };

export class RawBuffer {
  private chunks: RawEntry[] = [];
  private byteLen = 0;
  private dropped = 0;

  constructor(private readonly capacityBytes: number) {}

  get droppedBytes(): number {
    return this.dropped;
  }

  push(bytes: Uint8Array, dir: RawDir, tMs: number): void {
    this.chunks.push({ tMs, dir, bytes: bytes.slice() });
    this.byteLen += bytes.length;
    while (this.byteLen > this.capacityBytes && this.chunks.length > 0) {
      const old = this.chunks.shift()!;
      this.byteLen -= old.bytes.length;
      this.dropped += old.bytes.length;
    }
  }

  entries(): RawEntry[] {
    return this.chunks;
  }

  toArray(): Uint8Array {
    const out = new Uint8Array(this.byteLen);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c.bytes, o);
      o += c.bytes.length;
    }
    return out;
  }

  clear(): void {
    this.chunks = [];
    this.byteLen = 0;
  }
}
```

- [ ] **Step 4: Run tests to pass**

```powershell
npm test
```

Expected: PASS all hex/rawBuffer tests.

- [ ] **Step 5: Commit**

```powershell
git add src/protocol/hex.ts src/store/rawBuffer.ts src/test/hex.test.ts src/test/rawBuffer.test.ts
git commit -m "feat: add hex codec and bounded raw buffer"
```

---

### Task 3: JustFloat decoder

**Files:**
- Create: `src/protocol/types.ts`, `src/protocol/justfloat.ts`, `src/test/justfloat.test.ts`

**Interfaces:**
- Produces:
  - `type SampleBatch = { tMs: number; values: number[] }`
  - `interface StreamDecoder { feed(chunk: Uint8Array, tMs: number): SampleBatch[]; reset(): void; readonly errors: number }`
  - `class JustFloatDecoder implements StreamDecoder` — tail `00 00 80 7F`, LE float32, first frame locks channel count

- [ ] **Step 1: Write types and failing tests**

`src/protocol/types.ts`:

```ts
export type SampleBatch = { tMs: number; values: number[] };

export interface StreamDecoder {
  feed(chunk: Uint8Array, tMs: number): SampleBatch[];
  reset(): void;
  readonly errors: number;
}

export type BuiltinProtocolId = 'justfloat' | 'firewater' | 'raw';
```

`src/test/justfloat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { JustFloatDecoder } from '../protocol/justfloat';

function frame(values: number[]): Uint8Array {
  const buf = new ArrayBuffer(4 * values.length + 4);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  view.setUint8(4 * values.length, 0x00);
  view.setUint8(4 * values.length + 1, 0x00);
  view.setUint8(4 * values.length + 2, 0x80);
  view.setUint8(4 * values.length + 3, 0x7f);
  return new Uint8Array(buf);
}

describe('JustFloatDecoder', () => {
  it('decodes a full frame', () => {
    const d = new JustFloatDecoder();
    const batches = d.feed(frame([1.5, -2, 0.25]), 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.values[0]).toBeCloseTo(1.5);
    expect(batches[0]!.values[1]).toBeCloseTo(-2);
    expect(batches[0]!.values[2]).toBeCloseTo(0.25);
  });

  it('handles fragmented frames', () => {
    const d = new JustFloatDecoder();
    const f = frame([1, 2]);
    expect(d.feed(f.subarray(0, 5), 1)).toHaveLength(0);
    const b = d.feed(f.subarray(5), 2);
    expect(b).toHaveLength(1);
    expect(b[0]!.values).toEqual([expect.closeTo(1), expect.closeTo(2)]);
  });

  it('locks channel count and errors on mismatch', () => {
    const d = new JustFloatDecoder();
    d.feed(frame([1, 2, 3]), 1);
    const bad = d.feed(frame([1, 2]), 2);
    expect(bad).toHaveLength(0);
    expect(d.errors).toBe(1);
  });

  it('resets pending on reset', () => {
    const d = new JustFloatDecoder();
    const f = frame([1, 2]);
    d.feed(f.subarray(0, 6), 1);
    d.reset();
    expect(d.feed(f, 2)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run fail**

```powershell
npm test -- src/test/justfloat.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement JustFloatDecoder**

`src/protocol/justfloat.ts`:

```ts
import { SampleBatch, StreamDecoder } from './types';

const TAIL = [0x00, 0x00, 0x80, 0x7f];
const MAX_PENDING = 64 * 1024;

export class JustFloatDecoder implements StreamDecoder {
  private pending: number[] = [];
  private channelCount: number | null = null;
  errors = 0;

  reset(): void {
    this.pending = [];
    this.channelCount = null;
  }

  feed(chunk: Uint8Array, tMs: number): SampleBatch[] {
    const out: SampleBatch[] = [];
    for (const b of chunk) this.pending.push(b);
    if (this.pending.length > MAX_PENDING) {
      this.pending = this.pending.slice(-MAX_PENDING);
      this.errors += 1;
    }
    for (;;) {
      const idx = this.findTail();
      if (idx < 0) break;
      const frameBytes = this.pending.slice(0, idx);
      this.pending = this.pending.slice(idx + 4);
      if (frameBytes.length === 0 || frameBytes.length % 4 !== 0) {
        this.errors += 1;
        continue;
      }
      const count = frameBytes.length / 4;
      if (this.channelCount === null) this.channelCount = count;
      if (count !== this.channelCount) {
        this.errors += 1;
        continue;
      }
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        const u =
          frameBytes[i * 4]! |
          (frameBytes[i * 4 + 1]! << 8) |
          (frameBytes[i * 4 + 2]! << 16) |
          (frameBytes[i * 4 + 3]! << 24);
        values.push(new Float32Array(new Uint32Array([u >>> 0]).buffer)[0]!);
      }
      out.push({ tMs, values });
    }
    return out;
  }

  private findTail(): number {
    const p = this.pending;
    for (let i = 0; i + 4 <= p.length; i++) {
      if (
        p[i] === TAIL[0] &&
        p[i + 1] === TAIL[1] &&
        p[i + 2] === TAIL[2] &&
        p[i + 3] === TAIL[3]
      ) {
        return i;
      }
    }
    return -1;
  }
}
```

- [ ] **Step 4: Run pass**

```powershell
npm test -- src/test/justfloat.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/protocol/types.ts src/protocol/justfloat.ts src/test/justfloat.test.ts
git commit -m "feat: decode JustFloat frames with channel lock"
```

---

### Task 4: FireWater, RawData, ProtocolRouter

**Files:**
- Create: `src/protocol/firewater.ts`, `src/protocol/raw.ts`, `src/protocol/router.ts`, `src/test/firewater.test.ts`, `src/test/router.test.ts`

**Interfaces:**
- Produces:
  - `class FireWaterDecoder` — line-based finite floats, comma or whitespace split
  - `class RawDataDecoder` — always returns `[]`, errors stays 0
  - `class ProtocolRouter` with `setProtocol(id, custom?)`, `feed(chunk, tMs): SampleBatch[]`

- [ ] **Step 1: Failing tests**

`src/test/firewater.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FireWaterDecoder } from '../protocol/firewater';

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('FireWaterDecoder', () => {
  it('parses comma lines', () => {
    const d = new FireWaterDecoder();
    const b = d.feed(enc('1.5,2,3\n'), 5);
    expect(b).toHaveLength(1);
    expect(b[0]!.values).toEqual([1.5, 2, 3]);
  });
  it('parses space separated scientific', () => {
    const d = new FireWaterDecoder();
    const b = d.feed(enc('1e-3 2.5\n'), 1);
    expect(b[0]!.values[0]).toBeCloseTo(0.001);
  });
  it('handles CRLF and fragments', () => {
    const d = new FireWaterDecoder();
    expect(d.feed(enc('1,2'), 1)).toHaveLength(0);
    expect(d.feed(enc(',3\r\n'), 2)).toHaveLength(1);
  });
  it('skips bad lines and counts errors', () => {
    const d = new FireWaterDecoder();
    d.feed(enc('1,abc\n2,3\n'), 1);
    expect(d.errors).toBe(1);
  });
});
```

`src/test/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ProtocolRouter } from '../protocol/router';

describe('ProtocolRouter', () => {
  it('switches decoders and resets pending', () => {
    const r = new ProtocolRouter();
    r.setProtocol('firewater');
    r.feed(new TextEncoder().encode('1,2'), 1);
    r.setProtocol('raw');
    expect(r.feed(new Uint8Array([1, 2, 3]), 2)).toHaveLength(0);
    r.setProtocol('firewater');
    const b = r.feed(new TextEncoder().encode('3,4\n'), 3);
    expect(b).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run fail**

```powershell
npm test
```

- [ ] **Step 3: Implement**

`src/protocol/firewater.ts`:

```ts
import { SampleBatch, StreamDecoder } from './types';

const MAX_PENDING = 64 * 1024;

export class FireWaterDecoder implements StreamDecoder {
  private pending = '';
  errors = 0;

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
    let idx: number;
    while ((idx = this.pending.search(/\r\n|\n|\r/)) >= 0) {
      const line = this.pending.slice(0, idx);
      this.pending = this.pending.slice(idx + (this.pending.startsWith('\r\n', idx) ? 2 : 1));
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/[,\s]+/).filter(Boolean);
      const values: number[] = [];
      let ok = parts.length > 0;
      for (const p of parts) {
        const n = Number(p);
        if (!Number.isFinite(n)) {
          ok = false;
          break;
        }
        values.push(n);
      }
      if (!ok) {
        this.errors += 1;
        continue;
      }
      out.push({ tMs, values });
    }
    return out;
  }
}
```

`src/protocol/raw.ts`:

```ts
import { SampleBatch, StreamDecoder } from './types';

export class RawDataDecoder implements StreamDecoder {
  errors = 0;
  reset(): void {}
  feed(_chunk: Uint8Array, _tMs: number): SampleBatch[] {
    return [];
  }
}
```

`src/protocol/router.ts`:

```ts
import { FireWaterDecoder } from './firewater';
import { JustFloatDecoder } from './justfloat';
import { RawDataDecoder } from './raw';
import { BuiltinProtocolId, SampleBatch, StreamDecoder } from './types';
import { CustomProtocolConfig, CustomProtocolDecoder } from './custom';

export type ProtocolSelection =
  | { kind: BuiltinProtocolId }
  | { kind: 'custom'; config: CustomProtocolConfig };

export class ProtocolRouter {
  private decoder: StreamDecoder = new JustFloatDecoder();
  private kind: string = 'justfloat';

  get protocolKind(): string {
    return this.kind;
  }

  get errors(): number {
    return this.decoder.errors;
  }

  setProtocol(selection: ProtocolSelection): void {
    if (selection.kind === this.kind && selection.kind !== 'custom') {
      this.decoder.reset();
      return;
    }
    this.kind = selection.kind;
    switch (selection.kind) {
      case 'justfloat':
        this.decoder = new JustFloatDecoder();
        break;
      case 'firewater':
        this.decoder = new FireWaterDecoder();
        break;
      case 'raw':
        this.decoder = new RawDataDecoder();
        break;
      case 'custom':
        this.decoder = new CustomProtocolDecoder(selection.config);
        break;
    }
  }

  feed(chunk: Uint8Array, tMs: number): SampleBatch[] {
    return this.decoder.feed(chunk, tMs);
  }
}
```

Note: Task 4 creates a temporary stub `custom.ts` if needed — real custom logic is Task 5. Create `src/protocol/custom.ts` stub:

```ts
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

export class CustomProtocolDecoder implements StreamDecoder {
  errors = 0;
  constructor(private readonly config: CustomProtocolConfig) {}
  reset(): void {}
  feed(_chunk: Uint8Array, _tMs: number): SampleBatch[] {
    return [];
  }
}
```

- [ ] **Step 4: Run pass**

```powershell
npm test
```

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: add FireWater, RawData, protocol router"
```

---

### Task 5: Custom protocol decoder (config + script)

**Files:**
- Create/Modify: `src/protocol/custom.ts`, `src/test/custom.test.ts`

**Interfaces:**
- Consumes: `CustomProtocolConfig` from Task 4
- Produces: Working `CustomProtocolDecoder` implementing config field mapping and script body execution

- [ ] **Step 1: Failing tests**

`src/test/custom.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CustomProtocolDecoder } from '../protocol/custom';

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('CustomProtocolDecoder', () => {
  it('maps config fields', () => {
    const d = new CustomProtocolDecoder({
      id: 'c1',
      name: 'imu',
      mode: 'config',
      delimiter: 'comma',
      skipPrefix: 'DATA,',
      channels: [
        { index: 0, name: 'ax' },
        { index: 2, name: 'az' },
      ],
    });
    const b = d.feed(enc('DATA,1.25,9.9,-0.5\n'), 1);
    expect(b).toHaveLength(1);
    expect(b[0]!.values).toEqual([1.25, -0.5]);
  });

  it('runs script mode', () => {
    const d = new CustomProtocolDecoder({
      id: 'c2',
      name: 's',
      mode: 'script',
      script: "return line.split(';').slice(1).map(Number);",
    });
    const b = d.feed(enc('X;1;2;3\n'), 1);
    expect(b[0]!.values).toEqual([1, 2, 3]);
  });

  it('counts script errors', () => {
    const d = new CustomProtocolDecoder({
      id: 'c3',
      name: 'bad',
      mode: 'script',
      script: 'throw new Error("x")',
    });
    d.feed(enc('abc\n'), 1);
    expect(d.errors).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run fail**

```powershell
npm test -- src/test/custom.test.ts
```

- [ ] **Step 3: Implement full custom.ts**

Replace stub with full implementation: line assembly (same as FireWater), delimiter resolve, skipPrefix, config index map, script via `new Function('line', script)` with timing (50ms soft timeout → errors++).

Key implementation body (complete file):

```ts
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
```

- [ ] **Step 4: Run pass**

```powershell
npm test -- src/test/custom.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add src/protocol/custom.ts src/test/custom.test.ts
git commit -m "feat: implement custom protocol config and script modes"
```

---

### Task 6: SeriesStore and ChannelRegistry

**Files:**
- Create: `src/store/seriesStore.ts`, `src/store/channels.ts`, `src/test/seriesStore.test.ts`

**Interfaces:**
- Produces:
  - `class SeriesStore` — `append(tMs, values: number[], channelIds: string[])`, `getWindow(maxPoints): { id, name, color, visible, xs: number[], ys: number[] }[]`, `exportCsv(channelIds?): string`
  - `class ChannelRegistry` — `syncFromBatch(values: number[], protocolId: string, names?: string[])`, `setVisible`, `setAlias`, `setColor`, `list()`

- [ ] **Step 1: Failing series test**

`src/test/seriesStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SeriesStore } from '../store/seriesStore';

describe('SeriesStore', () => {
  it('appends and exports csv', () => {
    const s = new SeriesStore(60_000, 1000);
    s.append(0, [1, 2], ['p.a', 'p.b']);
    s.append(10, [3, 4], ['p.a', 'p.b']);
    const csv = s.exportCsv();
    expect(csv.split('\n')[0]).toContain('t_ms');
    expect(csv).toContain('1');
    expect(csv).toContain('4');
  });
  it('evicts old samples', () => {
    const s = new SeriesStore(100, 1000);
    s.append(0, [1], ['p.a']);
    s.append(200, [2], ['p.a']);
    const w = s.getWindow(100);
    expect(w[0]!.ys[w[0]!.ys.length - 1]).toBe(2);
    expect(w[0]!.ys.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run fail**

```powershell
npm test -- src/test/seriesStore.test.ts
```

- [ ] **Step 3: Implement**

`src/store/seriesStore.ts`:

```ts
export type SeriesPointMeta = { id: string; name: string; color: string; visible: boolean };

export class SeriesStore {
  private xs = new Map<string, number[]>();
  private ys = new Map<string, number[]>();
  private meta = new Map<string, SeriesPointMeta>();

  constructor(
    private readonly windowMs: number,
    private readonly maxPointsPerChannel = 20_000
  ) {}

  setMeta(id: string, meta: Partial<SeriesPointMeta> & { name?: string }): void {
    const prev = this.meta.get(id) ?? {
      id,
      name: meta.name ?? id,
      color: '#3b82f6',
      visible: true,
    };
    this.meta.set(id, { ...prev, ...meta, id });
    if (!this.xs.has(id)) {
      this.xs.set(id, []);
      this.ys.set(id, []);
    }
  }

  append(tMs: number, values: number[], channelIds: string[]): void {
    for (let i = 0; i < channelIds.length; i++) {
      const id = channelIds[i]!;
      const v = values[i];
      if (v === undefined || !Number.isFinite(v)) continue;
      if (!this.xs.has(id)) {
        this.xs.set(id, []);
        this.ys.set(id, []);
      }
      const xs = this.xs.get(id)!;
      const ys = this.ys.get(id)!;
      xs.push(tMs);
      ys.push(v);
      while (xs.length > this.maxPointsPerChannel) {
        xs.shift();
        ys.shift();
      }
      const cutoff = tMs - this.windowMs;
      while (xs.length && xs[0]! < cutoff) {
        xs.shift();
        ys.shift();
      }
    }
  }

  getWindow(maxPoints = 4000): SeriesPointMeta[] & { xs: number[]; ys: number[] }[] {
    const out: (SeriesPointMeta & { xs: number[]; ys: number[] })[] = [];
    for (const [id, meta] of this.meta) {
      if (!meta.visible) continue;
      const xs = this.xs.get(id) ?? [];
      const ys = this.ys.get(id) ?? [];
      const stride = Math.max(1, Math.ceil(xs.length / maxPoints));
      const oxs: number[] = [];
      const oys: number[] = [];
      for (let i = 0; i < xs.length; i += stride) {
        oxs.push(xs[i]!);
        oys.push(ys[i]!);
      }
      out.push({ ...meta, xs: oxs, ys: oys });
    }
    return out as never;
  }

  exportCsv(aliasMap?: Map<string, string>): string {
    const ids = [...this.meta.keys()];
    const headers = ['t_ms', 'iso_time', ...ids.map((id) => aliasMap?.get(id) ?? this.meta.get(id)!.name)];
    const maxLen = Math.max(0, ...ids.map((id) => (this.xs.get(id) ?? []).length));
    const lines: string[] = [headers.join(',')];
    for (let i = 0; i < maxLen; i++) {
      const t = this.xs.get(ids[0] ?? '')?.[i];
      const iso = t !== undefined ? new Date(t).toISOString() : '';
      const row = [String(t ?? ''), iso];
      for (const id of ids) {
        const v = this.ys.get(id)?.[i];
        row.push(v === undefined ? '' : String(v));
      }
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }

  clear(): void {
    for (const id of this.xs.keys()) {
      this.xs.set(id, []);
      this.ys.set(id, []);
    }
  }
}
```

`src/store/channels.ts`:

```ts
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
```

Fix `getWindow` return typing to a clean exported type if TS complains:

```ts
export type ChannelWindow = SeriesPointMeta & { xs: number[]; ys: number[] };
```

- [ ] **Step 4: Run pass**

```powershell
npm test
```

- [ ] **Step 5: Commit**

```powershell
git add src/store/seriesStore.ts src/store/channels.ts src/test/seriesStore.test.ts
git commit -m "feat: add series store and channel registry"
```

---

### Task 7: SerialService with injectable port list

**Files:**
- Create: `src/serial/types.ts`, `src/serial/serialService.ts`

**Interfaces:**
- Produces:
  - `type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'`
  - `class SerialService` — `listPorts()`, `connect(path, baudRate)`, `disconnect()`, `write(bytes)`, events `onData`, `onState`
  - Optional `SerialPortCtor` injection for tests without hardware

- [ ] **Step 1: Implement SerialService**

`src/serial/types.ts`:

```ts
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export type PortInfo = {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  friendly: string;
};

export type RuntimeCounters = {
  rxBytes: number;
  txBytes: number;
  decoderErrors: number;
  droppedBytes: number;
};
```

`src/serial/serialService.ts`:

```ts
import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';
import { ConnectionState, PortInfo } from './types';

export class SerialService extends EventEmitter {
  private port: SerialPort | null = null;
  private state: ConnectionState = 'disconnected';
  rxBytes = 0;
  txBytes = 0;
  lastError = '';

  getState(): ConnectionState {
    return this.state;
  }

  async listPorts(): Promise<PortInfo[]> {
    const ports = await SerialPort.list();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
      serialNumber: p.serialNumber,
      friendly: p.path + (p.manufacturer ? ` — ${p.manufacturer}` : ''),
    }));
  }

  async connect(path: string, baudRate: number): Promise<void> {
    await this.disconnect();
    this.setState('connecting');
    await new Promise<void>((resolve, reject) => {
      const port = new SerialPort({ path, baudRate, autoOpen: false });
      port.open((err) => {
        if (err) {
          this.lastError = err.message;
          this.setState('error');
          reject(err);
          return;
        }
        this.port = port;
        port.on('data', (buf: Buffer) => {
          this.rxBytes += buf.length;
          this.emit('data', new Uint8Array(buf));
        });
        port.on('error', (e: Error) => {
          this.lastError = e.message;
          this.setState('error');
        });
        port.on('close', () => {
          this.port = null;
          this.setState('disconnected');
        });
        this.setState('connected');
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    if (!port) {
      this.setState('disconnected');
      return;
    }
    await new Promise<void>((resolve) => {
      port.close(() => resolve());
    });
    this.setState('disconnected');
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.port) throw new Error('Not connected');
    await new Promise<void>((resolve, reject) => {
      this.port!.write(Buffer.from(bytes), (err) => {
        if (err) reject(err);
        else {
          this.txBytes += bytes.length;
          resolve();
        }
      });
    });
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    this.emit('state', s);
  }
}
```

- [ ] **Step 2: Compile check**

```powershell
npm run compile
```

Expected: no TS errors (serialport types from package).

- [ ] **Step 3: Manual smoke (optional)**  
F5 → later wired in Task 9. For now compile success is the gate.

- [ ] **Step 4: Commit**

```powershell
git add src/serial
git commit -m "feat: add serial service with port list and counters"
```

---

### Task 8: Workspace state and export service

**Files:**
- Create: `src/state/workspaceState.ts`, `src/export/exportService.ts`, `src/test/export.test.ts`

**Interfaces:**
- Produces:
  - `loadConnection`, `saveConnection`, `loadProtocols`, `saveProtocols`, etc. using `vscode.workspace.getConfiguration('serialLab')`
  - `formatRawLog(entries: RawEntry[]): string`
  - `samplesCsvFromStore(store: SeriesStore): string` (re-export helper)

- [ ] **Step 1: Export log test**

`src/test/export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatRawLog } from '../export/exportService';

describe('formatRawLog', () => {
  it('formats direction and hex payload', () => {
    const text = formatRawLog([
      { tMs: 0, dir: 'RX', bytes: new Uint8Array([1, 2]) },
      { tMs: 5, dir: 'TX', bytes: new Uint8Array([0x41]) },
    ]);
    expect(text).toContain('RX');
    expect(text).toContain('01 02');
    expect(text).toContain('41');
  });
});
```

- [ ] **Step 2: Run fail, implement**

`src/export/exportService.ts` (full):

```ts
import { RawEntry } from '../store/rawBuffer';
import { encodeHex } from '../protocol/hex';
import { SeriesStore } from '../store/seriesStore';

export function formatRawLog(entries: RawEntry[]): string {
  const lines = ['timestamp_iso,t_ms,dir,payload_hex'];
  for (const e of entries) {
    const iso = new Date(e.tMs).toISOString();
    lines.push(`${iso},${e.tMs},${e.dir},${encodeHex(e.bytes)}`);
  }
  return lines.join('\n');
}

export function samplesCsvFromStore(store: SeriesStore): string {
  return store.exportCsv();
}
```

`src/state/workspaceState.ts`:

```ts
import * as vscode from 'vscode';
import { CustomProtocolConfig } from '../protocol/custom';
import { ChannelView } from '../store/channels';

const cfg = () => vscode.workspace.getConfiguration('serialLab');

export type ConnSettings = {
  path: string;
  baudRate: number;
  dataBits: 8;
  parity: 'none' | 'even' | 'odd';
  stopBits: 1;
};

export function loadConnection(): ConnSettings {
  return cfg().get<ConnSettings>('connection') ?? {
    path: '',
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
  };
}

export async function saveConnection(c: ConnSettings): Promise<void> {
  await cfg().update('connection', c, vscode.ConfigurationTarget.Workspace);
}

export function loadProtocol(): string {
  return cfg().get<string>('protocol') ?? 'justfloat';
}

export async function saveProtocol(id: string): Promise<void> {
  await cfg().update('protocol', id, vscode.ConfigurationTarget.Workspace);
}

export function loadActiveCustomId(): string {
  return cfg().get<string>('activeCustomProtocolId') ?? '';
}

export async function saveActiveCustomId(id: string): Promise<void> {
  await cfg().update('activeCustomProtocolId', id, vscode.ConfigurationTarget.Workspace);
}

export function loadCustomProtocols(): CustomProtocolConfig[] {
  return cfg().get<CustomProtocolConfig[]>('protocols') ?? [];
}

export async function saveCustomProtocols(list: CustomProtocolConfig[]): Promise<void> {
  await cfg().update('protocols', list, vscode.ConfigurationTarget.Workspace);
}

export function loadChannelPrefs(): Record<string, Partial<ChannelView>> {
  return cfg().get('channels') ?? {};
}

export async function saveChannelPrefs(v: Record<string, Partial<ChannelView>>): Promise<void> {
  await cfg().update('channels', v, vscode.ConfigurationTarget.Workspace);
}

export function loadTerminal() {
  return (
    cfg().get('terminal') ?? {
      rxEncoding: 'text',
      txEncoding: 'text',
      txLineEnding: 'lf',
    }
  );
}

export async function saveTerminal(t: unknown): Promise<void> {
  await cfg().update('terminal', t, vscode.ConfigurationTarget.Workspace);
}
```

- [ ] **Step 3: Run pass + compile**

```powershell
npm test
npm run compile
```

- [ ] **Step 4: Commit**

```powershell
git add src/state src/export src/test/export.test.ts
git commit -m "feat: add workspace state helpers and raw log export"
```

---

### Task 9: Webview panel, bridge, waveform, terminal, send

**Files:**
- Create: `src/webview/bridge.ts`, `src/webview/panel.ts`, `src/webview/media/main.js`, `src/webview/media/main.css`, `src/webview/media/uplot.min.js` (download), `src/webview/media/uplot.min.css` (if needed)
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: SerialService, ProtocolRouter, RawBuffer, SeriesStore, ChannelRegistry, workspaceState
- Produces: `openWorkbenchPanel(context)`, host `AppController` wiring commands

- [ ] **Step 1: Vendor uPlot**

```powershell
npm install uplot --save
Copy-Item node_modules\uplot\dist\uPlot.min.js src\webview\media\uplot.min.js
Copy-Item node_modules\uplot\dist\uPlot.min.css src\webview\media\uplot.min.css
```

Use filename `uplot.min.js` consistently.

- [ ] **Step 2: Bridge types**

`src/webview/bridge.ts`:

```ts
export type HostToWebview =
  | {
      type: 'samples';
      t: number;
      series: { id: string; name: string; color: string; visible: boolean; xs: number[]; ys: number[] }[];
    }
  | { type: 'raw'; entries: { tMs: number; dir: 'RX' | 'TX'; text: string; hex: string }[] }
  | {
      type: 'status';
      state: string;
      path: string;
      protocol: string;
      rxBytes: number;
      txBytes: number;
      errors: number;
      channels: { id: string; name: string; color: string; visible: boolean }[];
    }
  | { type: 'cleared' };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'pause'; paused: boolean }
  | { type: 'toggleChannel'; id: string; visible: boolean }
  | { type: 'send'; encoding: 'text' | 'hex'; payload: string; lineEnding: 'none' | 'lf' | 'cr' | 'crlf' }
  | { type: 'setRxEncoding'; encoding: 'text' | 'hex' }
  | { type: 'clearTerminal' }
  | { type: 'clearWaveform' };
```

- [ ] **Step 3: AppController + panel**

Create `src/appController.ts` that owns services and ticks UI at 50ms:

```ts
import * as vscode from 'vscode';
import { SerialService } from './serial/serialService';
import { ProtocolRouter } from './protocol/router';
import { RawBuffer } from './store/rawBuffer';
import { SeriesStore } from './store/seriesStore';
import { ChannelRegistry } from './store/channels';
import * as state from './state/workspaceState';
import { decodeHex, encodeHex } from './protocol/hex';
import { log } from './log';
import { HostToWebview, WebviewToHost } from './webview/bridge';
import { formatRawLog } from './export/exportService';
import { getPanel, revealPanel } from './webview/panel';

export class AppController implements vscode.Disposable {
  readonly serial = new SerialService();
  readonly router = new ProtocolRouter();
  readonly raw = new RawBuffer(state.loadConnection ? 2 * 1024 * 1024 : 2 * 1024 * 1024);
  readonly series = new SeriesStore(60_000);
  readonly channels = new ChannelRegistry();
  private pendingRaw: { tMs: number; dir: 'RX' | 'TX'; bytes: Uint8Array }[] = [];
  private paused = false;
  private rxEncoding: 'text' | 'hex' = 'text';
  private timer: NodeJS.Timeout | undefined;
  private sessionT0 = Date.now();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.raw = new RawBuffer(vscode.workspace.getConfiguration('serialLab').get<number>('rawBufferBytes') ?? 2 * 1024 * 1024);
    this.series = new SeriesStore(
      (vscode.workspace.getConfiguration('serialLab').get<number>('historySeconds') ?? 60) * 1000
    );
    this.channels.applySaved(state.loadChannelPrefs());
    this.applyProtocolFromState();
    this.serial.on('data', (bytes: Uint8Array) => this.onRx(bytes));
    this.serial.on('state', () => this.pushStatus());
    this.timer = setInterval(() => this.flushUi(), 50);
  }

  private nowMs(): number {
    return Date.now() - this.sessionT0;
  }

  private applyProtocolFromState(): void {
    const p = state.loadProtocol();
    if (p === 'custom') {
      const id = state.loadActiveCustomId();
      const cfg = state.loadCustomProtocols().find((c) => c.id === id) ?? {
        id: 'none',
        name: 'none',
        mode: 'config' as const,
      };
      this.router.setProtocol({ kind: 'custom', config: cfg });
    } else if (p === 'firewater') this.router.setProtocol({ kind: 'firewater' });
    else if (p === 'raw') this.router.setProtocol({ kind: 'raw' });
    else this.router.setProtocol({ kind: 'justfloat' });
  }

  private onRx(bytes: Uint8Array): void {
    const t = this.nowMs();
    this.raw.push(bytes, 'RX', t);
    this.pendingRaw.push({ tMs: t, dir: 'RX', bytes });
    if (this.router.protocolKind === 'raw') return;
    const batches = this.router.feed(bytes, t);
    for (const b of batches) {
      const ids = this.channels.syncFromBatch(
        b.values.length,
        this.router.protocolKind,
        this.router.protocolKind === 'custom'
          ? undefined
          : undefined
      );
      for (const id of ids) {
        const view = this.channels.list().find((c) => c.id === id);
        this.series.setMeta(id, { name: view?.name ?? id, color: view?.color, visible: view?.visible });
      }
      this.series.append(b.tMs, b.values, ids);
    }
  }

  handleWebviewMessage(msg: WebviewToHost): void {
    switch (msg.type) {
      case 'ready':
        this.pushStatus();
        this.flushUi();
        break;
      case 'pause':
        this.paused = msg.paused;
        break;
      case 'toggleChannel': {
        this.channels.setVisible(msg.id, msg.visible);
        void state.saveChannelPrefs(this.channels.toSaved());
        this.pushStatus();
        break;
      }
      case 'send':
        void this.send(msg.encoding, msg.payload, msg.lineEnding);
        break;
      case 'setRxEncoding':
        this.rxEncoding = msg.encoding;
        break;
      case 'clearTerminal':
        this.raw.clear();
        this.post({ type: 'cleared' });
        break;
      case 'clearWaveform':
        this.series.clear();
        break;
    }
  }

  async send(encoding: 'text' | 'hex', payload: string, lineEnding: 'none' | 'lf' | 'cr' | 'crlf'): Promise<void> {
    try {
      let bytes: Uint8Array;
      if (encoding === 'hex') bytes = decodeHex(payload);
      else bytes = new TextEncoder().encode(payload);
      if (encoding === 'text' && lineEnding !== 'none') {
        const eol =
          lineEnding === 'lf' ? '\n' : lineEnding === 'cr' ? '\r' : '\r\n';
        const withEol = new Uint8Array(bytes.length + eol.length);
        withEol.set(bytes, 0);
        withEol.set(new TextEncoder().encode(eol), bytes.length);
        bytes = withEol;
      }
      await this.serial.write(bytes);
      const t = this.nowMs();
      this.raw.push(bytes, 'TX', t);
      this.pendingRaw.push({ tMs: t, dir: 'TX', bytes });
      this.pushStatus();
    } catch (e) {
      void vscode.window.showErrorMessage(`Serial Lab send failed: ${(e as Error).message}`);
    }
  }

  async connect(): Promise<void> {
    const conn = state.loadConnection();
    if (!conn.path) {
      void vscode.window.showWarningMessage('Serial Lab: select a serial port first');
      return;
    }
    try {
      await this.serial.connect(conn.path, conn.baudRate);
      log.info(`Connected ${conn.path} @ ${conn.baudRate}`);
    } catch (e) {
      void vscode.window.showErrorMessage(`Serial Lab connect failed: ${(e as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    await this.serial.disconnect();
  }

  exportSamples(uri: vscode.Uri): void {
    void vscode.workspace.fs.writeFile(uri, Buffer.from(this.series.exportCsv(), 'utf8'));
  }

  exportRaw(uri: vscode.Uri): void {
    const text = formatRawLog(this.raw.entries());
    void vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
  }

  private post(msg: HostToWebview): void {
    getPanel()?.webview.postMessage(msg);
  }

  private pushStatus(): void {
    this.post({
      type: 'status',
      state: this.serial.getState(),
      path: state.loadConnection().path,
      protocol: this.router.protocolKind,
      rxBytes: this.serial.rxBytes,
      txBytes: this.serial.txBytes,
      errors: this.router.errors,
      channels: this.channels.list(),
    });
  }

  private flushUi(): void {
    if (this.paused) return;
    const raw = this.pendingRaw;
    this.pendingRaw = [];
    if (raw.length) {
      this.post({
        type: 'raw',
        entries: raw.map((r) => ({
          tMs: r.tMs,
          dir: r.dir,
          text: new TextDecoder('utf-8', { fatal: false }).decode(r.bytes),
          hex: encodeHex(r.bytes),
        })),
      });
    }
    const series = this.series.getWindow(3000) as {
      id: string;
      name: string;
      color: string;
      visible: boolean;
      xs: number[];
      ys: number[];
    }[];
    if (series.some((s) => s.xs.length)) {
      this.post({ type: 'samples', t: this.nowMs(), series });
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    void this.serial.disconnect();
  }
}
```

`src/webview/panel.ts`:

```ts
import * as vscode from 'vscode';
import { getNonce } from './nonce';

let panel: vscode.WebviewPanel | undefined;

export function getPanel(): vscode.WebviewPanel | undefined {
  return panel;
}

export function revealPanel(
  context: vscode.ExtensionContext,
  onMessage: (m: unknown) => void
): vscode.WebviewPanel {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside);
    return panel;
  }
  panel = vscode.window.createWebviewPanel(
    'serialLabWorkbench',
    'Serial Lab',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = getHtml(panel.webview, context.extensionUri);
  panel.webview.onDidReceiveMessage(onMessage, undefined, context.subscriptions);
  panel.onDidDispose(() => {
    panel = undefined;
  });
  return panel;
}

function getHtml(webview: vscode.Webview, ext: vscode.Uri): string {
  const nonce = getNonce();
  const script = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'src', 'webview', 'media', 'main.js'));
  const css = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'src', 'webview', 'media', 'main.css'));
  const uplotJs = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'src', 'webview', 'media', 'uplot.min.js'));
  const uplotCss = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'src', 'webview', 'media', 'uplot.min.css'));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <link href="${uplotCss}" rel="stylesheet" />
  <link href="${css}" rel="stylesheet" />
  <title>Serial Lab</title>
</head>
<body>
  <div class="toolbar">
    <button id="pause">暂停</button>
    <button id="clear-term">清空终端</button>
    <button id="clear-wave">清空波形</button>
    <label>RX <select id="rx-enc"><option value="text">文本</option><option value="hex">HEX</option></select></label>
    <span id="status" class="status"></span>
  </div>
  <div id="plot"></div>
  <div id="legend"></div>
  <div class="term-wrap">
    <div id="term" class="term"></div>
  </div>
  <div class="send-wrap">
    <select id="tx-enc">
      <option value="text">文本</option>
      <option value="hex">HEX</option>
    </select>
    <select id="tx-eol">
      <option value="lf">LF</option>
      <option value="crlf">CRLF</option>
      <option value="cr">CR</option>
      <option value="none">无</option>
    </select>
    <input id="tx-input" placeholder="发送内容" />
    <button id="tx-send">发送</button>
  </div>
  <script nonce="${nonce}" src="${uplotJs}"></script>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
```

`src/webview/nonce.ts`:

```ts
export function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
```

`src/webview/media/main.js` (core):

```js
/* global uPlot */
(function () {
  const vscode = acquireVsCodeApi();
  let paused = false;
  let uplot = null;
  const seriesMap = new Map();

  function ensurePlot() {
    const el = document.getElementById('plot');
    if (uplot) return uplot;
    const opts = {
      width: el.clientWidth || 600,
      height: 280,
      series: [{},],
      axes: [{}, {}],
      cursor: { show: true },
    };
    uplot = new uPlot(opts, [[], []], el);
    return uplot;
  }

  function rebuildSeries(series) {
    ensurePlot();
    const names = series.map((s) => s.name);
    const data = [series[0] ? series[0].xs : []];
    for (const s of series) data.push(s.ys);
    uplot.setSize({ width: document.getElementById('plot').clientWidth, height: 280 });
    const opts = {
      width: document.getElementById('plot').clientWidth,
      height: 280,
      series: [{}, ...series.map((s) => ({ label: s.name, stroke: s.color, show: s.visible }))],
    };
    // simple path: destroy/recreate when channel set changes
    const key = names.join('|');
    if (uplot.__key !== key) {
      uplot.destroy();
      uplot = new uPlot(opts, data, document.getElementById('plot'));
      uplot.__key = key;
    } else {
      uplot.setData(data);
    }
    renderLegend(series);
  }

  function renderLegend(series) {
    const legend = document.getElementById('legend');
    legend.innerHTML = '';
    for (const s of series) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = s.visible;
      cb.addEventListener('change', () => {
        vscode.postMessage({ type: 'toggleChannel', id: s.id, visible: cb.checked });
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + s.name));
      label.style.color = s.color;
      legend.appendChild(label);
    }
  }

  function appendTerm(entries) {
    const term = document.getElementById('term');
    const rxEnc = document.getElementById('rx-enc').value;
    for (const e of entries) {
      const line = document.createElement('div');
      const show = rxEnc === 'hex' ? e.hex : JSON.stringify(e.text);
      line.textContent = `[${e.dir}] ${show}`;
      term.appendChild(line);
    }
    while (term.childElementCount > 2000) term.removeChild(term.firstChild);
    term.scrollTop = term.scrollHeight;
  }

  document.getElementById('pause').addEventListener('click', () => {
    paused = !paused;
    document.getElementById('pause').textContent = paused ? '继续' : '暂停';
    vscode.postMessage({ type: 'pause', paused });
  });
  document.getElementById('clear-term').addEventListener('click', () => {
    document.getElementById('term').innerHTML = '';
    vscode.postMessage({ type: 'clearTerminal' });
  });
  document.getElementById('clear-wave').addEventListener('click', () => {
    vscode.postMessage({ type: 'clearWaveform' });
  });
  document.getElementById('rx-enc').addEventListener('change', (e) => {
    vscode.postMessage({ type: 'setRxEncoding', encoding: e.target.value });
  });
  document.getElementById('tx-send').addEventListener('click', () => {
    const payload = document.getElementById('tx-input').value;
    vscode.postMessage({
      type: 'send',
      encoding: document.getElementById('tx-enc').value,
      lineEnding: document.getElementById('tx-eol').value,
      payload,
    });
  });
  document.getElementById('tx-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('tx-send').click();
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'samples') rebuildSeries(msg.series);
    if (msg.type === 'raw') appendTerm(msg.entries);
    if (msg.type === 'status') {
      document.getElementById('status').textContent =
        msg.state + ' · ' + msg.path + ' · ' + msg.protocol + ' · RX ' + msg.rxBytes + ' · TX ' + msg.txBytes + ' · err ' + msg.errors;
    }
    if (msg.type === 'cleared') document.getElementById('term').innerHTML = '';
  });

  vscode.postMessage({ type: 'ready' });
})();
```

`src/webview/media/main.css`: basic dark-friendly flex layout (plot 280px, terminal flex 1, send row).

- [ ] **Step 4: Wire extension.ts**

```ts
import * as vscode from 'vscode';
import { log } from './log';
import { AppController } from './appController';
import { revealPanel } from './webview/panel';
import * as state from './state/workspaceState';
import { SerialService } from './serial/serialService';

let controller: AppController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  log.info('Serial Lab activated');
  controller = new AppController(context);
  context.subscriptions.push(controller);

  context.subscriptions.push(
    vscode.commands.registerCommand('serialLab.openWorkbench', () => {
      revealPanel(context, (m) => controller!.handleWebviewMessage(m as never));
    }),
    vscode.commands.registerCommand('serialLab.connect', () => controller!.connect()),
    vscode.commands.registerCommand('serialLab.disconnect', () => controller!.disconnect()),
    vscode.commands.registerCommand('serialLab.refreshPorts', async () => {
      const ports = await controller!.serial.listPorts();
      const picked = await vscode.window.showQuickPick(
        ports.map((p) => ({ label: p.friendly, description: p.path })),
        { placeHolder: '选择串口' }
      );
      if (picked) {
        const conn = state.loadConnection();
        conn.path = picked.description!;
        await state.saveConnection(conn);
        void vscode.window.showInformationMessage(`Serial Lab: port set to ${conn.path}`);
      }
    }),
    vscode.commands.registerCommand('serialLab.exportSamples', async () => {
      const uri = await vscode.window.showSaveDialog({ filters: { CSV: ['csv'] }, defaultUri: vscode.Uri.file('samples.csv') });
      if (uri) controller!.exportSamples(uri);
    }),
    vscode.commands.registerCommand('serialLab.exportRawLog', async () => {
      const uri = await vscode.window.showSaveDialog({ filters: { Log: ['csv', 'log', 'txt'] }, defaultUri: vscode.Uri.file('raw-log.csv') });
      if (uri) controller!.exportRaw(uri);
    })
  );
}

export function deactivate(): void {
  controller?.dispose();
}
```

Also register sidebar in a later mini-step of this task: `src/webview/sidebar.ts` can initially reuse QuickPick commands; full sidebar UI in Task 10.

- [ ] **Step 5: Compile + F5 manual check**

```powershell
npm run compile
```

F5 → Open Workbench → select port via Refresh Ports → Connect → see status. With simulator not yet present, use loopback or STM32.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat: add workbench webview, app controller, send/terminal/waveform"
```

---

### Task 10: Sidebar configuration view

**Files:**
- Create: `src/webview/sidebar.ts`, `src/webview/media/sidebar.js`, `src/webview/media/sidebar.css`
- Modify: `src/extension.ts`, `package.json` (if needed)

**Interfaces:**
- Produces: `registerSidebar(context, controller)` providing port list, baud, connect, protocol select, custom protocol JSON open, channel list mirror

- [ ] **Step 1: Implement WebviewViewProvider**

`src/webview/sidebar.ts`:

```ts
import * as vscode from 'vscode';
import { AppController } from '../appController';
import * as state from '../state/workspaceState';
import { getNonce } from './nonce';

export function registerSidebar(
  context: vscode.ExtensionContext,
  controller: AppController
): void {
  const provider = new SidebarViewProvider(context, controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('serialLab.sidebar', provider)
  );
}

class SidebarViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: AppController
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'media')],
    };
    const nonce = getNonce();
    const js = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'media', 'sidebar.js')
    );
    const css = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'media', 'sidebar.css')
    );
    const conn = state.loadConnection();
    webviewView.webview.html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webviewView.webview.cspSource}; script-src 'nonce-${nonce}';" />
<link href="${css}" rel="stylesheet"/>
</head><body>
  <h3>连接</h3>
  <select id="port"></select>
  <button id="refresh">刷新</button>
  <label>波特率 <input id="baud" value="${conn.baudRate}"/></label>
  <button id="connect">连接</button>
  <button id="disconnect">断开</button>
  <h3>协议</h3>
  <select id="protocol">
    <option value="justfloat">JustFloat</option>
    <option value="firewater">FireWater</option>
    <option value="raw">RawData</option>
    <option value="custom">Custom…</option>
  </select>
  <button id="edit-custom">编辑自定义协议</button>
  <h3>通道</h3>
  <ul id="channels"></ul>
  <script nonce="${nonce}" src="${js}"></script>
</body></html>`;

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'refreshPorts': {
          const ports = await this.controller.serial.listPorts();
          await webviewView.webview.postMessage({ type: 'ports', ports, selected: state.loadConnection().path });
          break;
        }
        case 'saveConn': {
          const c = state.loadConnection();
          c.path = msg.path;
          c.baudRate = Number(msg.baudRate) || 115200;
          await state.saveConnection(c);
          break;
        }
        case 'connect':
          await this.controller.connect();
          break;
        case 'disconnect':
          await this.controller.disconnect();
          break;
        case 'setProtocol': {
          await state.saveProtocol(msg.protocol);
          if (msg.protocol === 'custom') {
            const list = state.loadCustomProtocols();
            const pick = await vscode.window.showQuickPick(
              list.map((p) => ({ label: p.name, description: p.id })),
              { placeHolder: '选择自定义协议' }
            );
            if (pick) await state.saveActiveCustomId(pick.description!);
          }
          // reload protocol on controller — expose method
          this.controller.reloadProtocol();
          break;
        }
        case 'editCustom': {
          const doc = await vscode.workspace.openTextDocument({
            language: 'json',
            content: JSON.stringify(state.loadCustomProtocols(), null, 2),
          });
          await vscode.window.showTextDocument(doc);
          break;
        }
      }
    });

    void webviewView.webview.postMessage({
      type: 'init',
      connection: conn,
      protocol: state.loadProtocol(),
    });
  }
}
```

Add to `AppController`:

```ts
reloadProtocol(): void {
  this.applyProtocolFromState();
  this.pushStatus();
}
```

`sidebar.js` ports list refresh, connect buttons, protocol change — wire messages as above.

Register in `extension.ts` activate: `registerSidebar(context, controller);`

- [ ] **Step 2: Compile + F5 verify sidebar**

```powershell
npm run compile
```

- [ ] **Step 3: Commit**

```powershell
git add -A
git commit -m "feat: add sidebar for port, protocol, channels"
```

---

### Task 11: README, polish, acceptance checklist

**Files:**
- Create/Modify: `README.md`, fix any UX gaps found in F5

**Steps:**

- [ ] **Step 1: Write README** covering: install, F5, protocols (incl. custom JSON example), send HEX example `01 0A FF`, export commands, troubleshooting (port busy vs VOFA), MPL-2.0 + third-party.

Custom protocol JSON example for README:

```json
{
  "id": "stm32-csv",
  "name": "STM32 CSV",
  "mode": "config",
  "delimiter": "comma",
  "channels": [
    { "index": 0, "name": "ch0" },
    { "index": 1, "name": "ch1" }
  ]
}
```

Script example:

```json
{
  "id": "tagged",
  "name": "Tagged fields",
  "mode": "script",
  "script": "return line.split(',').slice(1).map(Number).filter(Number.isFinite);"
}
```

- [ ] **Step 2: Run full tests and compile**

```powershell
npm test
npm run compile
```

- [ ] **Step 3: Manual acceptance against spec checklist**

- [ ] Port select + 115200 8N1 connect  
- [ ] JustFloat / FireWater waveform; RawData terminal only  
- [ ] Text/HEX terminal switch without buffer wipe  
- [ ] Send text and HEX with line ending  
- [ ] Custom config protocol produces channels  
- [ ] Export CSV and raw log  
- [ ] Errors visible; app stays responsive  

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m "docs: readme and acceptance polish for serial-lab v0.1"
```

---

## Self-Review Notes

- Spec coverage: serial ports (T7/T9/T10), three protocols (T3/T4), custom (T5/T10), text/HEX RX/TX (T2/T9), export (T8/T9), waveform (T9), workspace persistence (T8), sidebar (T10), README (T11).
- Placeholder scan: no TBD; FireWater custom delimiter covered in T5.
- Type consistency: `StreamDecoder`, `SampleBatch`, `CustomProtocolConfig`, `RawEntry`, `AppController.reloadProtocol` used across tasks.
- Known follow-ups (not v0.1): min/max envelope downsampling, true script worker timeout/kill, multi-serial, scripted binary protocols.
