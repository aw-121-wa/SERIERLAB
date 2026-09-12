import { FireWaterDecoder } from './firewater';
import { JustFloatDecoder } from './justfloat';
import { RawDataDecoder } from './raw';
import { BuiltinProtocolId, SampleBatch, StreamDecoder } from './types';
import { CustomProtocolConfig, CustomProtocolDecoder } from './custom';

export type ProtocolSelection =
  | { kind: BuiltinProtocolId }
  | { kind: 'custom'; config: CustomProtocolConfig };

export class ProtocolRouter {
  private decoder: StreamDecoder = new JustFloatDecoder();
  private kind: string = 'justfloat';

  get protocolKind(): string {
    return this.kind;
  }

  get errors(): number {
    return this.decoder.errors;
  }

  setProtocol(selection: BuiltinProtocolId | ProtocolSelection): void {
    const kind = typeof selection === 'string' ? selection : selection.kind;
    const config =
      typeof selection === 'object' && selection.kind === 'custom' ? selection.config : undefined;
    if (kind === this.kind && kind !== 'custom') {
      this.decoder.reset();
      return;
    }
    this.kind = kind;
    switch (kind) {
      case 'justfloat':
        this.decoder = new JustFloatDecoder();
        break;
      case 'firewater':
        this.decoder = new FireWaterDecoder();
        break;
      case 'raw':
        this.decoder = new RawDataDecoder();
        break;
      case 'custom':
        this.decoder = new CustomProtocolDecoder(config!);
        break;
    }
  }

  feed(chunk: Uint8Array, tMs: number): SampleBatch[] {
    return this.decoder.feed(chunk, tMs);
  }
}
