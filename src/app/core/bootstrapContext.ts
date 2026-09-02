import type { WindowKind } from './di/module';

export interface BootstrapContext {
  readonly windowKind: WindowKind;
  readonly configSnapshot: PetConfigSnapshot | null;
  readonly startedAt: number;
}
