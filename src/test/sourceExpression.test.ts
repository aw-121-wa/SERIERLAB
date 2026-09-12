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
    expect(expressionAtOffset(ptr, ptr.indexOf('ptr'))?.text).toBe('ptr');
    const call = 'foo(bar);';
    // foo( is not a fixed-address expression
    expect(expressionAtOffset(call, 0)).toBeUndefined();
    const vi = 'motors[i].speed';
    expect(expressionAtOffset(vi, 0)?.text).toBe('motors');
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
});
