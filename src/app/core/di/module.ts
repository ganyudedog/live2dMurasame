import type { ServiceContainer } from './container';
import type { ServiceToken } from './token';

export type WindowKind = 'pet' | 'control-panel' | 'subtitle';

export interface ServiceModule {
  readonly id: string;
  readonly windows: readonly (WindowKind | 'all')[];
  readonly eager?: readonly ServiceToken<unknown>[];
  /** Register this module's services. Grouping modules may omit it. */
  register?(container: ServiceContainer): void;
  /** Child modules inherit this module's window scope. */
  readonly children?: readonly ServiceModule[];
}

export interface ServiceModuleExports {
  readonly serviceModule?: ServiceModule;
  readonly serviceModules?: readonly ServiceModule[];
}

export const getServiceModuleDefinitions = (exports: ServiceModuleExports): readonly ServiceModule[] =>
  exports.serviceModule ? [exports.serviceModule] : (exports.serviceModules ?? []);
