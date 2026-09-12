import { SampleBatch, StreamDecoder } from './types';

export class RawDataDecoder implements StreamDecoder {
  errors = 0;
  reset(): void {}
  feed(_chunk: Uint8Array, _tMs: number): SampleBatch[] {
    return [];
  }
}
