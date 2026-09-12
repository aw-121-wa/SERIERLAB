export type HostToWebview =
  | {
      type: 'plot.snapshot';
      generation: number;
      seq: number;
      series: { id: string; path: string; displayName: string; unit?: string; color: string; visible: boolean; xs: number[]; ys: number[] }[];
    }
  | {
      type: 'plot.delta';
      generation: number;
      seq: number;
      series: { id: string; xs: number[]; ys: number[] }[];
    }
  | {
      type: 'plot.reset';
      generation: number;
      seq: number;
      reason: string;
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
      channels: { id: string; path: string; displayName: string; unit?: string; color: string; visible: boolean; value?: number }[];
      droppedUiEntries?: number;
      droppedUiBytes?: number;
      tMs?: number;
    }
  | {
      type: 'parameters.snapshot';
      source?: 'native' | 'swd';
      epoch?: number;
      sessionState: string;
      deviceName?: string;
      firmwareVersion?: string;
      parameters: {
        id: number;
        path: string;
        type: 'float32' | 'int32' | 'uint32' | 'bool';
        writable: boolean;
        unit?: string;
        min?: number;
        max?: number;
        step?: number;
        confirmedValue?: number | boolean;
        pending?: { requestedValue: number | boolean };
        lastError?: { detail: string };
      }[];
    }
  | {
      type: 'parameters.update';
      source?: 'native' | 'swd';
      epoch?: number;
      parameter: {
        id: number;
        path: string;
        type: 'float32' | 'int32' | 'uint32' | 'bool';
        writable: boolean;
        unit?: string;
        min?: number;
        max?: number;
        step?: number;
        confirmedValue?: number | boolean;
        pending?: { requestedValue: number | boolean };
        lastError?: { detail: string };
      };
    }
  | { type: 'cleared' };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'parameters.source'; source: 'native' | 'swd' }
  | { type: 'swd.action'; action: 'connect' | 'disconnect' | 'elf' | 'watch' | 'refresh' | 'settings' | 'help' | 'runtime' | 'pack' }
  | { type: 'plot.needSnapshot'; reason?: string }
  | { type: 'pause'; paused: boolean }
  | { type: 'toggleChannel'; id: string; visible: boolean }
  | { type: 'send'; encoding: 'text' | 'hex'; payload: string; lineEnding: 'none' | 'lf' | 'cr' | 'crlf' }
  | { type: 'setRxEncoding'; encoding: 'text' | 'hex' }
  | { type: 'clearTerminal' }
  | { type: 'clearWaveform' }
  | { type: 'parameter.set'; parameterId: number; value: number | boolean; source: 'native' | 'swd'; epoch: number }
  | { type: 'parameter.refresh'; parameterId: number; source: 'native' | 'swd'; epoch: number };
