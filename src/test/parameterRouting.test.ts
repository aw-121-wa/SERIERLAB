import { describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => ({ workspace: { isTrusted: true, getConfiguration: () => ({ get: () => 'native' }) } }));
vi.mock('../webview/panel', () => ({ getPanel: () => undefined }));
import { AppController } from '../appController';
import { ProtocolRouter } from '../protocol/router';

describe('parameter backend routing', () => {
  it('preserves Native selection instead of falling back to JustFloat', () => {
    const c = Object.create(AppController.prototype) as any;
    c.router = new ProtocolRouter();
    c.serial = { rxBytes: 0 };
    c.applyProtocolFromState();
    expect(c.router.protocolKind).toBe('native');
  });
  it('rejects stale epochs and wrong sources before dispatch', () => {
    const c = Object.create(AppController.prototype) as any;
    c.parameterSource = 'swd'; c.parameterEpoch = 7;
    c.swd = { set: vi.fn() }; c.handleParameterSet = vi.fn();
    c.handleWebviewMessage({ type: 'parameter.set', source: 'native', epoch: 7, parameterId: 1, value: 5 });
    c.handleWebviewMessage({ type: 'parameter.set', source: 'swd', epoch: 6, parameterId: 1, value: 5 });
    expect(c.swd.set).not.toHaveBeenCalled();
    c.handleWebviewMessage({ type: 'parameter.set', source: 'swd', epoch: 7, parameterId: 1, value: 5 });
    expect(c.swd.set).toHaveBeenCalledWith(1, 5);
    expect(c.handleParameterSet).not.toHaveBeenCalled();
    c.parameterSource = 'native';
    c.handleWebviewMessage({ type: 'parameter.set', source: 'native', epoch: 7, parameterId: 1, value: 5 });
    expect(c.handleParameterSet).toHaveBeenCalledOnce();
  });
});
