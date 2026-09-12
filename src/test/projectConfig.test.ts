import { describe, expect, it } from 'vitest';
import {
  EXTENSION_DEFAULTS,
  minimalProjectConfigText,
  nextProjectLayer,
  parseProjectConfig,
  resolveEffectiveConfig,
} from '../config/projectConfig';

describe('parseProjectConfig', () => {
  it('1: version=1 minimal is valid', () => {
    const r = parseProjectConfig('{"version":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.version).toBe(1);
  });

  it('2: unsupported version reject', () => {
    const r = parseProjectConfig('{"version":2}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsupported version/);
  });

  it('3: invalid JSON reject', () => {
    const r = parseProjectConfig('{version:');
    expect(r.ok).toBe(false);
  });

  it('9: custom protocol requires customId', () => {
    const r = parseProjectConfig('{"version":1,"protocol":{"kind":"custom"}}');
    expect(r.ok).toBe(false);
    const ok = parseProjectConfig(
      '{"version":1,"protocol":{"kind":"custom","customId":"robot"}}'
    );
    expect(ok.ok).toBe(true);
  });

  it('10: invalid parity / stopBits / color reject', () => {
    expect(parseProjectConfig('{"version":1,"serial":{"parity":"yes"}}').ok).toBe(false);
    expect(parseProjectConfig('{"version":1,"serial":{"stopBits":3}}').ok).toBe(false);
    expect(
      parseProjectConfig('{"version":1,"channels":{"justfloat.ch0":{"color":"red"}}}').ok
    ).toBe(false);
  });

  it('7-8: channels keyed by id; cannot override id/path', () => {
    const ok = parseProjectConfig(
      '{"version":1,"channels":{"justfloat.ch0":{"displayName":"Target","unit":"rpm","color":"#3b82f6","visible":true}}}'
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.config.channels!['justfloat.ch0']!.displayName).toBe('Target');
    const bad = parseProjectConfig(
      '{"version":1,"channels":{"justfloat.ch0":{"path":"nope"}}}'
    );
    expect(bad.ok).toBe(false);
    const bad2 = parseProjectConfig(
      '{"version":1,"channels":{"Target Speed":{"displayName":"x"}}}'
    );
    // key is allowed syntactically as id string but not displayName-as-key rule in schema —
    // we only enforce no path/id fields; keys are opaque ids.
    expect(bad2.ok).toBe(true);
  });

  it('14: no port field in schema/model', () => {
    const text = minimalProjectConfigText();
    expect(text).not.toMatch(/port/i);
    const r = parseProjectConfig('{"version":1,"serial":{"baudRate":115200}}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.serial).toEqual({ baudRate: 115200 });
  });
});

describe('resolveEffectiveConfig precedence', () => {
  it('4: project field overrides VS Code', () => {
    const project = parseProjectConfig(
      '{"version":1,"serial":{"baudRate":921600},"protocol":{"kind":"firewater"}}'
    );
    expect(project.ok).toBe(true);
    if (!project.ok) return;
    const eff = resolveEffectiveConfig(project.config, {
      baudRate: 115200,
      protocolKind: 'justfloat',
    });
    expect(eff.serial.baudRate).toBe(921600);
    expect(eff.protocol.kind).toBe('firewater');
    expect(eff.sources.serial).toBe('project');
    expect(eff.sources.protocol).toBe('project');
  });

  it('5: absent project field falls back', () => {
    const project = parseProjectConfig('{"version":1,"serial":{"baudRate":57600}}');
    if (!project.ok) throw new Error('parse');
    const eff = resolveEffectiveConfig(project.config, {
      baudRate: 115200,
      dataBits: 7,
      protocolKind: 'raw',
    });
    expect(eff.serial.baudRate).toBe(57600);
    expect(eff.serial.dataBits).toBe(7);
    expect(eff.protocol.kind).toBe('raw');
  });

  it('6: partial nested merge + defaults', () => {
    const project = parseProjectConfig('{"version":1,"serial":{"parity":"even"}}');
    if (!project.ok) throw new Error('parse');
    const eff = resolveEffectiveConfig(project.config, {});
    expect(eff.serial.parity).toBe('even');
    expect(eff.serial.baudRate).toBe(EXTENSION_DEFAULTS.baudRate);
    expect(eff.protocol.kind).toBe(EXTENSION_DEFAULTS.protocolKind);
  });

  it('21: null project uses vscode then defaults', () => {
    const eff = resolveEffectiveConfig(null, {});
    expect(eff.serial.baudRate).toBe(115200);
    expect(eff.protocol.kind).toBe('justfloat');
    expect(eff.sources.protocol).toBe('default');
  });

  it('11: malformed reload keeps last-known-good', () => {
    const good = parseProjectConfig('{"version":1,"serial":{"baudRate":921600}}');
    if (!good.ok) throw new Error('seed');
    const next = nextProjectLayer(good.config, parseProjectConfig('{oops'));
    expect(next.project?.serial?.baudRate).toBe(921600);
    expect(next.error).toBeTruthy();
  });

  it('12: valid reload replaces last-known-good', () => {
    const a = parseProjectConfig('{"version":1,"serial":{"baudRate":9600}}');
    if (!a.ok) throw new Error('a');
    const b = parseProjectConfig('{"version":1,"serial":{"baudRate":57600}}');
    if (!b.ok) throw new Error('b');
    const next = nextProjectLayer(a.config, b);
    expect(next.project?.serial?.baudRate).toBe(57600);
    expect(next.error).toBeNull();
  });

  it('13: delete project config clears project layer', () => {
    const a = parseProjectConfig('{"version":1}');
    if (!a.ok) throw new Error('a');
    const next = nextProjectLayer(a.config, { ok: true, config: null });
    expect(next.project).toBeNull();
    const eff = resolveEffectiveConfig(next.project, { baudRate: 115200 });
    expect(eff.sources.serial).toBe('vscode');
  });
});
