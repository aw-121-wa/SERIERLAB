import { describe, expect, it } from 'vitest';
import { expressionAtOffset, splitExpression } from '../runtime/sourceExpression';

describe('expressionAtOffset', () => {
  const src = 'output = controller.yaw.kp * error;\nmotors[2].speed = 1;\n';

  it('cursor at root / member / end of expression', () => {
    const root = src.indexOf('controller');
    const mid = src.indexOf('yaw') + 1;
    const end = src.indexOf('kp') + 2;
    expect(expressionAtOffset(src, root)?.text).toBe('controller.yaw.kp');
    expect(expressionAtOffset(src, mid)?.text).toBe('controller.yaw.kp');
    expect(expressionAtOffset(src, end)?.text).toBe('controller.yaw.kp');
  });

  it('array literal + member', () => {
    const off = src.indexOf('motors[2].speed') + 8;
    expect(expressionAtOffset(src, off)?.text).toBe('motors[2].speed');
  });

  it('whitespace / number → undefined', () => {
    expect(expressionAtOffset('  \n', 1)).toBeUndefined();
    expect(expressionAtOffset('x = 123;', 5)).toBeUndefined();
  });

  it('rejects pointer / call / variable index', () => {
    const ptr = 'a = ptr->kp;';
    // Entire ptr->kp is unsupported — do not offer Hover on any part of it.
    expect(expressionAtOffset(ptr, ptr.indexOf('ptr'))).toBeUndefined();
    const call = 'foo(bar);';
    // foo( is not a fixed-address expression
    expect(expressionAtOffset(call, 0)).toBeUndefined();
    const vi = 'motors[i].speed';
    expect(expressionAtOffset(vi, vi.indexOf('speed'))?.text).toBe('motors[i].speed');
  });

  it('skips string and comment', () => {
    const s = 'const char *p = "yaw_pid.kp";';
    expect(expressionAtOffset(s, s.indexOf('yaw') + 1)).toBeUndefined();
    const c = '// yaw_pid.kp\nint x;';
    expect(expressionAtOffset(c, c.indexOf('yaw') + 1)).toBeUndefined();
  });

  it('splitExpression', () => {
    expect(splitExpression('controller.yaw.kp')).toEqual({
      root: 'controller',
      path: ['yaw', 'kp'],
    });
    expect(splitExpression('motors[2].speed')).toEqual({
      root: 'motors',
      path: ['[2]', 'speed'],
    });
    expect(splitExpression('ptr->x')).toBeUndefined();
  });

  it('S14.1.1: does not slice unsupported expressions into fake globals', () => {
    const ptrSrc = 'int v = ptr->x;';
    // Any cursor inside ptr->x is unsupported — never fake `x` or slice `ptr`.
    expect(expressionAtOffset(ptrSrc, ptrSrc.indexOf('x'))).toBeUndefined();
    expect(expressionAtOffset(ptrSrc, ptrSrc.indexOf('ptr'))).toBeUndefined();
    const arrow = ptrSrc.indexOf('->');
    expect(expressionAtOffset(ptrSrc, arrow)).toBeUndefined();

    const call = 'foo(bar);';
    expect(expressionAtOffset(call, 0)).toBeUndefined();
    expect(expressionAtOffset(call, 2)).toBeUndefined();
    expect(expressionAtOffset(call, 3)).toBeUndefined();

    const vi = 'motors[i].speed = 1;';
    // full span — never just `i` or `speed` alone
    expect(expressionAtOffset(vi, vi.indexOf('speed'))?.text).toBe('motors[i].speed');
    const idxPos = vi.indexOf('[i]') + 1;
    expect(expressionAtOffset(vi, idxPos)?.text).toBe('motors[i].speed');

    const sum = 'a + b';
    expect(expressionAtOffset(sum, 0)?.text).toBe('a');
    expect(expressionAtOffset(sum, 4)?.text).toBe('b');
  });
});
