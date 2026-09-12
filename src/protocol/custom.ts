import { SampleBatch, StreamDecoder } from './types';

export type CustomChannelMap = { index: number; name: string; color?: string };

export type CustomProtocolConfig = {
  id: string;
  name: string;
  mode: 'config' | 'script';
  lineEnding?: 'lf' | 'crlf' | 'cr';
  delimiter?: 'comma' | 'space' | 'tab' | 'semicolon' | string;
  trim?: boolean;
  skipPrefix?: string;
  channels?: CustomChannelMap[];
  allowChannelCountChange?: boolean;
  script?: string;
};

export class CustomProtocolDecoder implements StreamDecoder {
  errors = 0;
  constructor(private readonly config: CustomProtocolConfig) {}
  reset(): void {}
  feed(_chunk: Uint8Array, _tMs: number): SampleBatch[] {
    return [];
  }
}
