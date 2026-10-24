import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceContainer } from './di/container';
import { registerServiceModules, registerServiceModuleTree } from './loadServiceModules';
import { TOKENS } from './serviceTokens';
import { getServiceModuleDefinitions, type WindowKind } from './di/module';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { LogService } from '@app/shared/logging/LogService';
import * as ai from '../modules/ai/module';
import { serviceModule as panel } from '../modules/control-panel/module';

const setup = (windowKind: WindowKind) => {
  const container = new ServiceContainer();
  container.registerValue(TOKENS.core.bootstrapContext, { windowKind, configSnapshot: null, startedAt: Date.now() });
  container.registerValue(TOKENS.shared.config, { getSnapshot: () => null, globalModelConfig: null } as unknown as ConfigService);
  container.registerValue(TOKENS.shared.stateBus, { asr: { enabled: false }, chatConfig: {} } as unknown as StateBusService);
  container.registerValue(TOKENS.shared.electron, { bridge: {} } as ElectronService);
  container.registerValue(TOKENS.shared.log, { contextRegistry: { register: () => ({
    beginTrace: () => ({ end: vi.fn(), fail: vi.fn() }), dispose: vi.fn(),
  }) } } as unknown as LogService);
  const eager = [
    ...getServiceModuleDefinitions(ai).flatMap((module) => registerServiceModuleTree(container, module, windowKind)),
    ...registerServiceModuleTree(container, panel, windowKind),
  ];
  eager.forEach((token) => container.resolve(token));
  return container;
};

describe('renderer module discovery', () => {
  it.each(['pet', 'control-panel'] as const)('registers the expected AI capabilities for %s', (windowKind) => {
    const container = new ServiceContainer();
    const register = vi.spyOn(container, 'registerSingleton');
    const eager = registerServiceModules(container, windowKind);
    const tokens = register.mock.calls.map(([token]) => token.key);
    expect(tokens).toContain(TOKENS.plugin.runtime.key);
    if (windowKind === 'pet') {
      expect(tokens).toEqual(expect.arrayContaining([TOKENS.ai.runtime.key, TOKENS.ai.asr.key, TOKENS.ai.llm.key, TOKENS.ai.tts.runtime.key, TOKENS.ai.tts.liveKit.key]));
      expect(eager).toContain(TOKENS.ai.runtime);
    } else {
      expect(tokens).not.toContain(TOKENS.ai.runtime.key);
      expect(tokens).not.toContain(TOKENS.ai.asr.key);
      expect(tokens).toContain(TOKENS.ai.llm.key);
      expect(eager).not.toContain(TOKENS.ai.runtime);
      expect(tokens).toContain(TOKENS.ai.tts.runtime.key);
      expect(tokens).toContain(TOKENS.ai.tts.liveKit.key);
    }
  });
});

describe('renderer module composition', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves pet services and disposes them through the container', async () => {
    const container = setup('pet');
    const domains = [container.resolve(TOKENS.ai.llm), container.resolve(TOKENS.ai.tts.runtime), container.resolve(TOKENS.ai.asr)];
    const disposers = domains.map((domain) => vi.spyOn(domain, 'dispose'));
    await container.startServices();
    await container.dispose();
    disposers.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
  });

  it('resolves TTS and the configuration LLM for the control panel without activating ASR', async () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null } });
    const container = setup('control-panel');
    expect(container.resolve(TOKENS.ai.tts.runtime)).toBeDefined();
    expect(container.resolve(TOKENS.ai.tts.liveKit)).toBeDefined();
    expect(() => container.resolve(TOKENS.ai.asr)).toThrow('not registered');
    expect(container.resolve(TOKENS.ai.llm)).toBeDefined();
    await container.dispose();
  });
});
