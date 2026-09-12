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
  | { type: 'cleared' };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'plot.needSnapshot'; reason?: string }
  | { type: 'pause'; paused: boolean }
  | { type: 'toggleChannel'; id: string; visible: boolean }
  | { type: 'send'; encoding: 'text' | 'hex'; payload: string; lineEnding: 'none' | 'lf' | 'cr' | 'crlf' }
  | { type: 'setRxEncoding'; encoding: 'text' | 'hex' }
  | { type: 'clearTerminal' }
  | { type: 'clearWaveform' };
