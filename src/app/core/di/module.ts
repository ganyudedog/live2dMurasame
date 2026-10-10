import type { ServiceContainer } from './container';
import type { ServiceToken } from './token';

export type WindowKind = 'pet' | 'control-panel';

export interface ServiceModule {
  readonly id: string;
  readonly windows: readonly (WindowKind | 'all')[];
  readonly eager?: readonly ServiceToken<unknown>[];
  register(container: ServiceContainer): void;
}

export interface ServiceModuleExports {
  readonly serviceModule?: ServiceModule;
  readonly serviceModules?: readonly ServiceModule[];
}

export const getServiceModuleDefinitions = (exports: ServiceModuleExports): readonly ServiceModule[] =>
  exports.serviceModules ?? (exports.serviceModule ? [exports.serviceModule] : []);
