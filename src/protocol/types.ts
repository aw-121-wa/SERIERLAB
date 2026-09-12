export type SampleBatch = { tMs: number; values: number[] };

export interface StreamDecoder {
  feed(chunk: Uint8Array, tMs: number): SampleBatch[];
  reset(): void;
  readonly errors: number;
}

export type BuiltinProtocolId = 'justfloat' | 'firewater' | 'raw' | 'native';
