import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DisplayRing } from '../store/displayRing';

/**
 * Webview main.js ships a hand-rolled DisplayRing that must stay API-compatible
 * with src/store/displayRing.ts. follow/reset use ring.count and ring.xAt().
 * A missing method silently breaks live scroll (latestSampleTime() → null).
 */
describe('Webview DisplayRing API drift guard', () => {
  const mainJs = readFileSync(
    join(__dirname, '..', 'webview', 'media', 'main.js'),
    'utf8'
  );

  it('main.js defines count / xAt / yAt on DisplayRing', () => {
    expect(mainJs).toContain('DisplayRing.prototype.xAt');
    expect(mainJs).toContain('DisplayRing.prototype.yAt');
    expect(mainJs).toMatch(/Object\.defineProperty\(DisplayRing\.prototype,\s*'count'/);
    // latestSampleTime depends on these
    expect(mainJs).toContain('latestSampleTime');
    expect(mainJs).toMatch(/ring\.count/);
    expect(mainJs).toMatch(/ring\.xAt\(/);
  });

  it('TS DisplayRing exposes the same surface used by follow logic', () => {
    const r = new DisplayRing(4);
    expect(typeof r.count).toBe('number');
    expect(typeof r.xAt).toBe('function');
    expect(typeof r.yAt).toBe('function');
    r.push(10, 1);
    r.push(20, 2);
    expect(r.count).toBe(2);
    expect(r.xAt(0)).toBe(10);
    expect(r.xAt(1)).toBe(20);
    expect(r.yAt(1)).toBe(2);
    // wrap
    r.push(30, 3);
    r.push(40, 4);
    r.push(50, 5);
    expect(r.count).toBe(4);
    expect(r.xAt(r.count - 1)).toBe(50);
  });

  it('evaluates the webview DisplayRing implementation (count/xAt)', () => {
    // Extract and run the constructor + methods from main.js in isolation.
    const start = mainJs.indexOf('function DisplayRing(capacity)');
    const end = mainJs.indexOf('var DISPLAY_CAP');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const snippet = mainJs.slice(start, end);
    const factory = new Function(
      snippet + '\nreturn DisplayRing;'
    );
    const WebDisplayRing = factory() as new (n: number) => {
      count: number;
      push(x: number, y: number): void;
      xAt(i: number): number;
      yAt(i: number): number;
      materialize(): { xs: number[]; ys: number[] };
    };
    const r = new WebDisplayRing(3);
    expect(r.count).toBe(0);
    r.push(1, 10);
    r.push(2, 20);
    expect(r.count).toBe(2);
    expect(r.xAt(1)).toBe(2);
    expect(r.yAt(0)).toBe(10);
    r.push(3, 30);
    r.push(4, 40);
    expect(r.count).toBe(3);
    expect(r.xAt(r.count - 1)).toBe(4);
    // latestSampleTime pattern
    let latest: number | null = null;
    if (r.count > 0) {
      const last = r.xAt(r.count - 1);
      if (latest === null || last > latest) latest = last;
    }
    expect(latest).toBe(4);
  });
});
