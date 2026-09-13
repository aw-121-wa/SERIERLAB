import { expect, it } from 'vitest';
import { serialDiagnosis } from '../connectionDiagnostics';
it('distinguishes closed, no bytes, undecoded data and raw data', () => {
  expect(serialDiagnosis('disconnected', 0, 0, 'raw')).toContain('未打开');
  expect(serialDiagnosis('connected', 0, 0, 'raw')).toContain('RX 为 0');
  expect(serialDiagnosis('connected', 10, 0, 'justfloat')).toContain('尚未解析');
  expect(serialDiagnosis('connected', 10, 0, 'raw')).toContain('原始数据');
  expect(serialDiagnosis('connected', 10, 1, 'firewater')).toContain('已解析');
  expect(serialDiagnosis('connected', 10, 0, 'native')).toContain('Native');
});
