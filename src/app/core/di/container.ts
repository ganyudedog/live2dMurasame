import type { ServiceToken } from './token';

export interface ServiceLifecycle {
  start?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

type ServiceFactory<T> = (container: ServiceContainer) => T;

interface Registration<T = unknown> {
  factory: ServiceFactory<T>;
  instance?: T;
  resolving: boolean;
}

export class ServiceContainer {
  private readonly registrations = new Map<symbol, Registration>();
  private readonly creationOrder: ServiceLifecycle[] = [];
  private started = false;
  private disposed = false;

  registerSingleton<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): void {
    this.assertCanRegister(token);
    this.registrations.set(token.key, { factory, resolving: false });
  }

  registerValue<T>(token: ServiceToken<T>, value: T): void {
    this.assertCanRegister(token);
    this.registrations.set(token.key, {
      factory: () => value,
      instance: value,
      resolving: false,
    });
  }

  resolve<T>(token: ServiceToken<T>): T {
    if (this.disposed) {
      throw new Error(`DI container is disposed; cannot resolve ${token.name}`);
    }
    const registration = this.registrations.get(token.key) as Registration<T> | undefined;
    if (!registration) {
      throw new Error(`DI service is not registered: ${token.name}`);
    }
    if (registration.instance !== undefined) return registration.instance;
    if (registration.resolving) {
      throw new Error(`Circular DI dependency detected while resolving ${token.name}`);
    }

    registration.resolving = true;
    try {
      const instance = registration.factory(this);
      registration.instance = instance;
      if (isLifecycle(instance)) this.creationOrder.push(instance);
      return instance;
    } finally {
      registration.resolving = false;
    }
  }

  async startServices(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (let index = 0; index < this.creationOrder.length; index += 1) {
      await this.creationOrder[index]?.start?.();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (let index = this.creationOrder.length - 1; index >= 0; index -= 1) {
      try {
        await this.creationOrder[index]?.dispose?.();
      } catch (error) {
        console.error('[di] service dispose failed', error);
      }
    }
    this.creationOrder.length = 0;
    this.registrations.clear();
  }

  private assertCanRegister<T>(token: ServiceToken<T>): void {
    if (this.started || this.disposed) {
      throw new Error(`DI container cannot register ${token.name} after startup`);
    }
    if (this.registrations.has(token.key)) {
      throw new Error(`Duplicate DI registration: ${token.name}`);
    }
  }
}

const isLifecycle = (value: unknown): value is ServiceLifecycle => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as ServiceLifecycle;
  return typeof candidate.start === 'function' || typeof candidate.dispose === 'function';
};
