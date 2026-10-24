import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceContainer } from './di/container';
import { registerServiceModules, registerServiceModuleTree } from './loadServiceModules';
import { TOKENS } from './serviceTokens';
import type { WindowKind } from './di/module';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { LogService } from '@app/shared/logging/LogService';
import { serviceModule as ai } from '../modules/ai/module';
import { serviceModule as panel } from '../modules/control-panel/module';
import { serviceModule as live2d } from '../modules/live2d/module';
import { serviceModule as subtitle } from '../modules/subtitle/module';

const setup = (windowKind: WindowKind) => {
  const container = new ServiceContainer();
  container.registerValue(TOKENS.core.bootstrapContext, { windowKind, configSnapshot: null, startedAt: Date.now() });
  container.registerValue(TOKENS.shared.config, { getSnapshot: () => null, globalModelConfig: null } as unknown as ConfigService);
  container.registerValue(TOKENS.shared.stateBus, { asr: { enabled: false }, chatConfig: {}, scale: 1,
    composerDraft: '', publishChatConfig: vi.fn(), publishComposerDraft: vi.fn(), publishChatRequest: vi.fn(),
  } as unknown as StateBusService);
  container.registerValue(TOKENS.shared.electron, { bridge: {} } as ElectronService);
  container.registerValue(TOKENS.shared.log, { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), contextRegistry: { register: () => ({
    beginTrace: () => ({ end: vi.fn(), fail: vi.fn() }), dispose: vi.fn(),
  }) } } as unknown as LogService);
  const eager = [
    ...registerServiceModuleTree(container, ai, windowKind),
    ...registerServiceModuleTree(container, live2d, windowKind),
    ...registerServiceModuleTree(container, panel, windowKind),
  ];
  eager.forEach((token) => container.resolve(token));
  return container;
};

describe('renderer module discovery', () => {
  it.each(['pet', 'control-panel', 'subtitle'] as const)('registers only root service tokens for %s', (windowKind) => {
    const container = new ServiceContainer();
    const register = vi.spyOn(container, 'registerSingleton');
    const eager = registerServiceModules(container, windowKind);
    const tokens = register.mock.calls.map(([token]) => token.key);
    const roots = windowKind === 'pet' ? [TOKENS.ai, TOKENS.live2d]
      : windowKind === 'control-panel' ? [TOKENS.ai, TOKENS.controlPanel] : [TOKENS.subtitle];
    const shared = windowKind === 'subtitle'
      ? [TOKENS.shared.electron, TOKENS.shared.log, TOKENS.shared.config]
      : Object.values(TOKENS.shared);
    expect(tokens).toEqual(expect.arrayContaining([TOKENS.plugin, ...shared, ...roots].map((token) => token.key)));
    expect(tokens).toHaveLength(1 + shared.length + roots.length);
    for (const root of [TOKENS.ai, TOKENS.live2d, TOKENS.controlPanel, TOKENS.subtitle]) {
      expect(eager.includes(root)).toBe(roots.some((token) => token.key === root.key));
    }
  });
});

describe('renderer module composition', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(['pet', 'control-panel'] as const)('starts and releases AI children through their owner in %s', async (windowKind) => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: vi.fn() } });
    const container = setup(windowKind);
    const service = container.resolve(TOKENS.ai);
    const starts = [vi.spyOn(service.asr, 'start'), vi.spyOn(service.tts, 'start')];
    const domains = [service, service.llm, service.tts, service.asr, service.tts.liveKit];
    const disposers = domains.map((domain) => vi.spyOn(domain, 'dispose'));
    expect(container.resolve(TOKENS.ai)).toBe(service);
    if (windowKind === 'pet') {
      const composer = container.resolve(TOKENS.live2d).floatingComposer;
      composer.setDraft('draft');
      expect(container.resolve(TOKENS.shared.stateBus).publishComposerDraft).toHaveBeenCalledWith('draft');
    } else {
      expect(container.resolve(TOKENS.controlPanel)).toBeDefined();
      expect(() => container.resolve(TOKENS.live2d)).toThrow('not registered');
    }
    await container.startServices();
    starts.forEach((start) => expect(start).toHaveBeenCalledOnce());
    await container.dispose();
    disposers.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
  });

  it('starts the independent subtitle module without AI or Live2D', async () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    const off = vi.fn();
    const api = { onState: vi.fn(() => off), getState: vi.fn().mockResolvedValue(undefined), gesture: vi.fn() };
    const container = new ServiceContainer();
    container.registerValue(TOKENS.shared.electron, { bridge: { subtitleApi: api } } as unknown as ElectronService);
    const eager = registerServiceModuleTree(container, subtitle, 'subtitle');
    eager.forEach((token) => container.resolve(token));
    expect(() => container.resolve(TOKENS.ai)).toThrow('not registered');
    expect(() => container.resolve(TOKENS.live2d)).toThrow('not registered');
    await container.startServices();
    expect(api.onState).toHaveBeenCalledOnce();
    expect(api.getState).toHaveBeenCalledOnce();
    await container.dispose();
    expect(off).toHaveBeenCalledOnce();
  });
});
