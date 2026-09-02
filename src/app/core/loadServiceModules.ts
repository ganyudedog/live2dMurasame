import type { ServiceContainer } from './di/container';
import type { ServiceModule, WindowKind } from './di/module';
import type { ServiceToken } from './di/token';

const discoveredModules = import.meta.glob(['../modules/**/module.ts', '../shared/**/module.ts'], {
  eager: true,
  import: 'serviceModule',
}) as Record<string, ServiceModule>;

export const registerServiceModules = (
  container: ServiceContainer,
  windowKind: WindowKind,
): readonly ServiceToken<unknown>[] => {
  const modules = Object.values(discoveredModules)
    .filter((module) => module.windows.includes('all') || module.windows.includes(windowKind))
    .sort((left, right) => left.id.localeCompare(right.id));

  const eager: ServiceToken<unknown>[] = [];
  for (const module of modules) {
    module.register(container);
    eager.push(...(module.eager ?? []));
  }
  return eager;
};
