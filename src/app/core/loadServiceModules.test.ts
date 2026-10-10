import { describe, expect, it, vi } from 'vitest';
import { ServiceContainer } from './di/container';
import { registerServiceModules } from './loadServiceModules';
import { TOKENS } from './serviceTokens';

describe('renderer module discovery', () => {
  it.each(['pet', 'control-panel'] as const)('registers the expected AI capabilities for %s', (windowKind) => {
    const container = new ServiceContainer();
    const register = vi.spyOn(container, 'registerSingleton');
    const eager = registerServiceModules(container, windowKind);
    const tokens = register.mock.calls.map(([token]) => token.key);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens).toContain(TOKENS.pluginRuntime.key);
    if (windowKind === 'pet') {
      expect(tokens).toEqual(expect.arrayContaining([TOKENS.ai.key, TOKENS.asr.key, TOKENS.llm.key, TOKENS.tts.key, TOKENS.liveKit.key]));
      expect(eager).toContain(TOKENS.ai);
    } else {
      expect(tokens).not.toContain(TOKENS.ai.key);
      expect(tokens).not.toContain(TOKENS.asr.key);
      expect(tokens).not.toContain(TOKENS.llm.key);
      expect(eager).not.toContain(TOKENS.ai);
      expect(tokens).toContain(TOKENS.tts.key);
      expect(tokens).toContain(TOKENS.liveKit.key);
    }
  });
});
