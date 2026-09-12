import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Cross-language gate: compile/run desktop C tests when gcc is available.
 * Skips (does not fail) if the binary/toolchain is missing.
 */
describe('S11 C SDK desktop tests', () => {
  const binCandidates = [
    join(__dirname, '..', '..', 'sdk', 'c', 'tests', 'seriallab-native-c-tests'),
    join(__dirname, '..', '..', 'sdk', 'c', 'tests', 'seriallab-native-c-tests.exe'),
  ];
  const bin = binCandidates.find((p) => existsSync(p));

  it('C test binary runs and passes', () => {
    if (!bin) {
      console.warn('[skip] seriallab-native-c-tests not built (run sdk/c/tests make test)');
      return;
    }
    const out = execFileSync(bin, { encoding: 'utf8' });
    expect(out).toContain('all passed');
  });
});
