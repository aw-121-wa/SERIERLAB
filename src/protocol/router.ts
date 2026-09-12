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
  private blocked = false;

  get protocolKind(): string {
    return this.kind;
  }

  get errors(): number {
    return this.decoder.errors;
  }

  /** True when the active custom script protocol was blocked (e.g. untrusted workspace). */
  get scriptBlocked(): boolean {
    return this.blocked;
  }

  setProtocol(
    selection: BuiltinProtocolId | ProtocolSelection,
    options?: { scriptAllowed?: boolean }
  ): void {
    const kind = typeof selection === 'string' ? selection : selection.kind;
    const config =
      typeof selection === 'object' && selection.kind === 'custom' ? selection.config : undefined;
    if (kind === this.kind && kind !== 'custom') {
      this.decoder.reset();
      this.blocked = false;
      return;
    }
    this.kind = kind;
    switch (kind) {
      case 'justfloat':
        this.decoder = new JustFloatDecoder();
        this.blocked = false;
        break;
      case 'firewater':
        this.decoder = new FireWaterDecoder();
        this.blocked = false;
        break;
      case 'raw':
        this.decoder = new RawDataDecoder();
        this.blocked = false;
        break;
      case 'custom': {
        const d = new CustomProtocolDecoder(config!, { scriptAllowed: options?.scriptAllowed });
        this.decoder = d;
        this.blocked = d.scriptBlocked;
        break;
      }
    }
  }

  feed(chunk: Uint8Array, tMs: number): SampleBatch[] {
    return this.decoder.feed(chunk, tMs);
  }
}
