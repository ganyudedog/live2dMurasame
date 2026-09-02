import { describe, expect, it, vi } from 'vitest';
import { ServiceContainer } from './container';
import { createServiceToken } from './token';

describe('ServiceContainer', () => {
  it('creates each singleton exactly once', () => {
    const token = createServiceToken<{ id: number }>('singleton');
    const factory = vi.fn(() => ({ id: 1 }));
    const container = new ServiceContainer();
    container.registerSingleton(token, factory);

    const first = container.resolve(token);
    const second = container.resolve(token);

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate registrations and circular dependencies', () => {
    const first = createServiceToken<object>('first');
    const second = createServiceToken<object>('second');
    const container = new ServiceContainer();
    container.registerSingleton(first, (scope) => ({ second: scope.resolve(second) }));
    container.registerSingleton(second, (scope) => ({ first: scope.resolve(first) }));

    expect(() => container.registerValue(first, {})).toThrow(/Duplicate DI registration/);
    expect(() => container.resolve(first)).toThrow(/Circular DI dependency/);
  });

  it('starts and disposes services in lifecycle order', async () => {
    const events: string[] = [];
    const first = createServiceToken<{ start(): void; dispose(): void }>('first');
    const second = createServiceToken<{ start(): void; dispose(): void }>('second');
    const container = new ServiceContainer();
    container.registerSingleton(first, () => ({
      start: () => events.push('first:start'),
      dispose: () => events.push('first:dispose'),
    }));
    container.registerSingleton(second, () => ({
      start: () => events.push('second:start'),
      dispose: () => events.push('second:dispose'),
    }));

    container.resolve(first);
    container.resolve(second);
    await container.startServices();
    await container.dispose();

    expect(events).toEqual([
      'first:start',
      'second:start',
      'second:dispose',
      'first:dispose',
    ]);
  });
});
