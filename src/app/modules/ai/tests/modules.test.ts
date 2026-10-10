import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceContainer } from '@app/core/di/container';
import { TOKENS } from '@app/core/serviceTokens';
import { getServiceModuleDefinitions, type WindowKind } from '@app/core/di/module';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { LogService } from '@app/shared/logging/LogService';
import * as ai from '../module';
import { serviceModule as panel } from '../../control-panel/module';

const modules = [...getServiceModuleDefinitions(ai), panel];
const discovered = import.meta.glob('../**/module.ts');

const setup = (windowKind: WindowKind) => {
  const container = new ServiceContainer();
  container.registerValue(TOKENS.bootstrapContext, { windowKind, configSnapshot: null, startedAt: Date.now() });
  container.registerValue(TOKENS.config, { getSnapshot: () => null, globalModelConfig: null } as unknown as ConfigService);
  container.registerValue(TOKENS.stateBus, { asr: { enabled: false }, chatConfig: {} } as unknown as StateBusService);
  container.registerValue(TOKENS.electron, { bridge: {} } as ElectronService);
  container.registerValue(TOKENS.log, { contextRegistry: { register: () => ({
    beginTrace: () => ({ end: vi.fn(), fail: vi.fn() }), dispose: vi.fn(),
  }) } } as unknown as LogService);
  const eager = modules.filter((module) => module.windows.includes(windowKind)).flatMap((module) => {
    module.register(container);
    return module.eager ?? [];
  });
  eager.forEach((token) => container.resolve(token));
  return container;
};

describe('AI composition roots', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('discovers one AI entry that exports all of its registrations', () => {
    expect(Object.keys(discovered)).toEqual(['../module.ts']);
    expect(getServiceModuleDefinitions(ai).map((module) => module.id)).toEqual([
      'pet.ai', 'pet.ai.asr', 'pet.ai.llm', 'pet.ai.tts',
    ]);
    expect(getServiceModuleDefinitions({ serviceModule: panel })).toEqual([panel]);
  });

  it('resolves each pet domain once and disposes it through the container', async () => {
    const container = setup('pet');
    const domains = [container.resolve(TOKENS.llm), container.resolve(TOKENS.tts), container.resolve(TOKENS.asr)];
    const disposers = domains.map((domain) => vi.spyOn(domain, 'dispose'));
    expect(container.resolve(TOKENS.ai)).toBe(container.resolve(TOKENS.ai));
    expect(container.resolve(TOKENS.tts)).toBe(domains[1]);
    await container.startServices();
    await container.dispose();
    disposers.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
  });

  it('resolves TTS for the control panel without activating ASR or LLM', async () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null } });
    const container = setup('control-panel');
    expect(container.resolve(TOKENS.tts)).toBeDefined();
    expect(container.resolve(TOKENS.liveKit)).toBeDefined();
    expect(() => container.resolve(TOKENS.asr)).toThrow('not registered');
    expect(() => container.resolve(TOKENS.llm)).toThrow('not registered');
    await container.dispose();
  });
});
