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
    expect(tokens).toContain(TOKENS.plugin.runtime.key);
    if (windowKind === 'pet') {
      expect(tokens).toEqual(expect.arrayContaining([TOKENS.ai.runtime.key, TOKENS.ai.asr.key, TOKENS.ai.llm.key, TOKENS.ai.tts.runtime.key, TOKENS.ai.tts.liveKit.key]));
      expect(eager).toContain(TOKENS.ai.runtime);
    } else {
      expect(tokens).not.toContain(TOKENS.ai.runtime.key);
      expect(tokens).not.toContain(TOKENS.ai.asr.key);
      expect(tokens).toContain(TOKENS.ai.llm.key);
      expect(tokens).not.toContain('ActionCatalogService');
      expect(eager).not.toContain(TOKENS.ai.runtime);
      expect(tokens).toContain(TOKENS.ai.tts.runtime.key);
      expect(tokens).toContain(TOKENS.ai.tts.liveKit.key);
    }
  });
});
