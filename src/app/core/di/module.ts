import type { ServiceContainer } from './container';
import type { ServiceToken } from './token';

export type WindowKind = 'pet' | 'control-panel' | 'demo' | 'test';

export interface ServiceModule {
  readonly id: string;
  readonly windows: readonly (WindowKind | 'all')[];
  readonly eager?: readonly ServiceToken<unknown>[];
  register(container: ServiceContainer): void;
}
