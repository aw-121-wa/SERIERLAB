export type HostToWebview =
  | {
      type: 'samples';
      t: number;
      series: { id: string; name: string; color: string; visible: boolean; xs: number[]; ys: number[] }[];
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
      channels: { id: string; name: string; color: string; visible: boolean }[];
      droppedUiEntries?: number;
      droppedUiBytes?: number;
    }
  | { type: 'cleared' };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'pause'; paused: boolean }
  | { type: 'toggleChannel'; id: string; visible: boolean }
  | { type: 'send'; encoding: 'text' | 'hex'; payload: string; lineEnding: 'none' | 'lf' | 'cr' | 'crlf' }
  | { type: 'setRxEncoding'; encoding: 'text' | 'hex' }
  | { type: 'clearTerminal' }
  | { type: 'clearWaveform' };
