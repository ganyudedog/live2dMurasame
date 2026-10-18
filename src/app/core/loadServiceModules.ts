import type { ServiceContainer } from './di/container';
import { getServiceModuleDefinitions, type ServiceModule, type ServiceModuleExports, type WindowKind } from './di/module';
import type { ServiceToken } from './di/token';

const discoveredModules = import.meta.glob(['./plugin/module.ts','../modules/*/module.ts', '../shared/**/module.ts'], {
  eager: true,
}) as Record<string, ServiceModuleExports>;

type WindowScope = readonly (WindowKind | 'all')[];

const matchesWindow = (
  moduleWindows: WindowScope,
  windowKind: WindowKind,
  parentWindows?: WindowScope,
): boolean => {
  const matchesOwnScope = moduleWindows.includes('all') || moduleWindows.includes(windowKind);
  if (!matchesOwnScope || !parentWindows) return matchesOwnScope;
  return parentWindows.includes('all') || parentWindows.includes(windowKind);
};

/** Register one module and its children while preserving the module tree. */
export const registerServiceModuleTree = (
  container: ServiceContainer,
  module: ServiceModule,
  windowKind: WindowKind,
  parentWindows?: WindowScope,
): readonly ServiceToken<unknown>[] => {
  if (!matchesWindow(module.windows, windowKind, parentWindows)) return [];

  module.register?.(container);
  const eager: ServiceToken<unknown>[] = [...(module.eager ?? [])];
  const children = [...(module.children ?? [])].sort((left, right) => left.id.localeCompare(right.id));
  for (const child of children) {
    eager.push(...registerServiceModuleTree(container, child, windowKind, module.windows));
  }
  return eager;
};

// 注册所有模块
export const registerServiceModules = (
  container: ServiceContainer,
  windowKind: WindowKind,
): readonly ServiceToken<unknown>[] => {
  const modules = Object.values(discoveredModules)
    .flatMap(getServiceModuleDefinitions)
    .sort((left, right) => left.id.localeCompare(right.id));

  const eager: ServiceToken<unknown>[] = [];
  for (const module of modules) {
    eager.push(...registerServiceModuleTree(container, module, windowKind));
  }
  return eager;
};
