import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ trusted: true, pick: vi.fn(), input: vi.fn(), open: vi.fn(), error: vi.fn(), update: vi.fn(), request: vi.fn(), dispose: vi.fn(), python: vi.fn(), pack: vi.fn(), values: {} as Record<string, unknown> }));
vi.mock('vscode', () => ({ workspace: { get isTrusted() { return m.trusted; }, workspaceFolders: [{}], getConfiguration: () => ({ get: (k: string, d: unknown) => m.values[k] ?? d, update: m.update }) }, window: { showQuickPick: m.pick, showInputBox: m.input, showOpenDialog: m.open, showErrorMessage: m.error, showWarningMessage: m.error }, ConfigurationTarget: { Workspace: 2, Global: 1 }, Uri: { joinPath: () => ({ fsPath: 'helper.py' }) } }));
vi.mock('../swd/runtime', () => ({ resolvePython: m.python, installTargetPack: m.pack }));
vi.mock('../swd/client', () => ({ SwdClient: class { request = m.request; dispose = m.dispose; } }));
import { runConnectionWizard } from '../connectionWizard';
const context = { workspaceState: { update: vi.fn() }, extensionUri: {} } as any;
const controller = { serial: { listPorts: vi.fn() }, projectConfig: { snapshot: vi.fn(), editProjectConfig: vi.fn() }, reloadProtocol: vi.fn(), connect: vi.fn(), handleSwdAction: vi.fn(), handleWebviewMessage: vi.fn() } as any;
beforeEach(() => { vi.clearAllMocks(); m.trusted = true; m.values = {}; m.pick.mockReset(); m.input.mockReset(); m.open.mockReset(); m.request.mockReset(); m.python.mockResolvedValue('python'); controller.projectConfig.snapshot.mockReturnValue({ project: null }); controller.serial.listPorts.mockResolvedValue([{ path: 'COM7', friendly: 'Board' }]); });
it('saves the selected serial port, baud and protocol before connecting', async () => {
  m.pick.mockResolvedValueOnce({ id: 'serial' }).mockResolvedValueOnce({ path: 'COM7' }).mockResolvedValueOnce({ id: 'justfloat' }); m.input.mockResolvedValue('230400');
  await runConnectionWizard(context, controller);
  expect(context.workspaceState.update).toHaveBeenCalledWith('serialLab.selectedPort', 'COM7');
  expect(m.update).toHaveBeenCalledWith('connection', expect.objectContaining({ baudRate: 230400 }), 2);
  expect(m.update).toHaveBeenCalledWith('protocol', 'justfloat', 2); expect(controller.connect).toHaveBeenCalledOnce();
});
it('cancellation before saving leaves the connection untouched', async () => {
  m.pick.mockResolvedValueOnce({ id: 'serial' }).mockResolvedValueOnce({ path: 'COM7' }); m.input.mockResolvedValue(undefined);
  await runConnectionWizard(context, controller); expect(m.update).not.toHaveBeenCalled(); expect(controller.connect).not.toHaveBeenCalled();
});
it('offers the actual project baud before connecting instead of an ignored baud input', async () => {
  controller.projectConfig.snapshot.mockReturnValue({ project: { serial: { baudRate: 115200 } }, effective: { serial: { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' } } });
  m.pick.mockResolvedValueOnce({ id: 'serial' }).mockResolvedValueOnce({ path: 'COM7' }).mockResolvedValueOnce({ id: 'project' }).mockResolvedValueOnce({ id: 'justfloat' });
  await runConnectionWizard(context, controller);
  expect(m.pick.mock.calls[2][0][0].label).toContain('115200'); expect(m.input).not.toHaveBeenCalled();
  expect(m.update).toHaveBeenCalledWith('connection', expect.objectContaining({ baudRate: 115200 }), 2); expect(controller.connect).toHaveBeenCalledOnce();
});
it('opens project configuration and stops before saving or connecting when editing its baud', async () => {
  controller.projectConfig.snapshot.mockReturnValue({ project: { serial: { baudRate: 115200 } }, effective: { serial: { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' } } });
  m.pick.mockResolvedValueOnce({ id: 'serial' }).mockResolvedValueOnce({ path: 'COM7' }).mockResolvedValueOnce({ id: 'edit' });
  await runConnectionWizard(context, controller);
  expect(controller.projectConfig.editProjectConfig).toHaveBeenCalledOnce(); expect(m.update).not.toHaveBeenCalled(); expect(controller.connect).not.toHaveBeenCalled();
});
it('untrusted SWD never starts a helper or installs dependencies', async () => {
  m.trusted = false; m.pick.mockResolvedValue({ id: 'swd' }); await runConnectionWizard(context, controller);
  expect(m.python).not.toHaveBeenCalled(); expect(m.request).not.toHaveBeenCalled();
});
it('selects an explicit target and exact probe, inspects watches and connects', async () => {
  m.pick.mockResolvedValueOnce({ id: 'swd' }).mockResolvedValueOnce({ uid: 'probe-2' }).mockResolvedValueOnce({ label: 'stm32f767zi' }).mockResolvedValueOnce([{ label: 'counter' }]);
  m.request.mockResolvedValueOnce({ probes: [{ unique_id: 'probe-2', description: 'DAP' }] }).mockResolvedValueOnce({ targets: [{ name: 'stm32f767zi' }] }).mockResolvedValueOnce({ symbols: [{ path: 'counter', type: 'u32', address: 536870912 }] });
  m.open.mockResolvedValue([{ fsPath: 'firmware.elf' }]); await runConnectionWizard(context, controller);
  expect(m.update).toHaveBeenCalledWith('swd.target', 'stm32f767zi', 2); expect(m.update).toHaveBeenCalledWith('swd.probeId', 'probe-2', 2); expect(m.update).toHaveBeenCalledWith('swd.watch', [{ path: 'counter' }], 2);
  expect(controller.handleSwdAction.mock.calls).toEqual([['disconnect'], ['connect']]); expect(m.dispose).toHaveBeenCalledOnce();
});
it('cancelled ELF selection never connects using a stale ELF', async () => {
  m.pick.mockResolvedValueOnce({ id: 'swd' }).mockResolvedValueOnce({ uid: 'p' }).mockResolvedValueOnce({ label: 'chip' });
  m.request.mockResolvedValueOnce({ probes: [{ unique_id: 'p' }] }).mockResolvedValueOnce({ targets: [{ name: 'chip' }] }); m.open.mockResolvedValue(undefined);
  await runConnectionWizard(context, controller); expect(controller.handleSwdAction).not.toHaveBeenCalled(); expect(m.dispose).toHaveBeenCalledOnce();
});
it('rechecks missing target support after installation and stops when still absent', async () => {
  m.pick.mockResolvedValueOnce({ id: 'swd' }).mockResolvedValueOnce({ uid: 'p' }).mockResolvedValueOnce({ manual: true }); m.input.mockResolvedValue('newchip');
  m.request.mockResolvedValueOnce({ probes: [{ unique_id: 'p' }] }).mockResolvedValue({ targets: [] });
  await runConnectionWizard(context, controller);
  expect(m.pack).toHaveBeenCalledWith(context); expect(m.open).not.toHaveBeenCalled(); expect(controller.handleSwdAction).not.toHaveBeenCalled(); expect(m.dispose).toHaveBeenCalledOnce();
});
it('runtime installation failures report an error without starting discovery', async () => {
  m.pick.mockResolvedValueOnce({ id: 'swd' }); m.python.mockRejectedValueOnce(new Error('download unavailable'));
  await runConnectionWizard(context, controller); expect(m.error).toHaveBeenCalledWith(expect.stringContaining('download unavailable')); expect(m.request).not.toHaveBeenCalled();
});
it('coalesces simultaneous wizard invocations and permits another after cancellation', async () => {
  let finish!: (value: undefined) => void;
  m.pick.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const a = runConnectionWizard(context, controller); const b = runConnectionWizard(context, controller);
  expect(m.pick).toHaveBeenCalledOnce(); finish(undefined); await Promise.all([a, b]);
  m.pick.mockResolvedValueOnce(undefined); await runConnectionWizard(context, controller); expect(m.pick).toHaveBeenCalledTimes(2);
});
it('retains existing watch bounds for the same ELF and disconnects only after selection', async () => {
  m.values = { 'swd.elf': 'firmware.elf', 'swd.watch': [{ path: 'counter', min: 0, max: 10 }] };
  m.pick.mockResolvedValueOnce({ id: 'swd' }).mockResolvedValueOnce({ uid: 'p' }).mockResolvedValueOnce({ label: 'chip' }).mockImplementationOnce(() => {
    expect(controller.handleSwdAction).not.toHaveBeenCalled(); return [{ label: 'counter' }];
  });
  m.request.mockResolvedValueOnce({ probes: [{ unique_id: 'p' }] }).mockResolvedValueOnce({ targets: [{ name: 'chip' }] }).mockResolvedValueOnce({ symbols: [{ path: 'counter', type: 'u32', address: 536870912 }] });
  m.open.mockResolvedValue([{ fsPath: 'firmware.elf' }]); await runConnectionWizard(context, controller);
  expect(m.update).toHaveBeenCalledWith('swd.watch', [{ path: 'counter', min: 0, max: 10 }], 2);
  expect(controller.handleSwdAction.mock.calls).toEqual([['disconnect'], ['connect']]);
});
