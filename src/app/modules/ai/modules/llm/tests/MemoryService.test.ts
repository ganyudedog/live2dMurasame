import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryService } from '../service/MemoryService';

afterEach(() => vi.unstubAllGlobals());

describe('LLM-backed memory consolidation', () => {
  it('summarizes only a bounded new batch and persists it through the memory bridge', async () => {
    const saved = { coreText: '# 核心记忆\n', state: { conversationCount: 8, lastConsolidatedCount: 8 } };
    const consolidate = vi.fn().mockResolvedValue(saved);
    vi.stubGlobal('window', { MemoryAPI: { consolidate } });
    const request = vi.fn().mockResolvedValue(JSON.stringify({
      coreText: '# 核心记忆\n\n## 稳定偏好\n- 喜欢日语语音\n',
      processedThroughCount: 8,
    }));
    const trace = { record: vi.fn() };
    const service = new MemoryService(() => ({ globalModelConfig: { memoryModel: 'memory-model' } }) as unknown as PetConfigSnapshot, request);
    const runtime = {
      contextText: '', modelPath: 'model-a',
      memoryState: {
        modelPath: 'model-a', modelKey: 'model-a',
        coreText: '# 核心记忆\n',
        pendingEpisodeText: '用户：我更喜欢日语语音。\n角色：知道了。',
        pendingThroughCount: 8,
        state: { version: 1, conversationCount: 8, lastConversationAt: Date.now() - 86400000, lastConsolidatedCount: 0, lastDecayDate: '' },
      },
    };

    await service.consolidateIfNeeded(runtime, trace as never);
    expect(request).toHaveBeenCalledOnce();
    expect(consolidate).toHaveBeenCalledWith({
      modelPath: 'model-a',
      content: '# 核心记忆\n\n## 稳定偏好\n- 喜欢日语语音',
      processedThroughCount: 8,
    });
    expect(runtime.memoryState).toBe(saved);
    expect(trace.record).toHaveBeenCalledWith('memory.consolidated', expect.objectContaining({ processedThroughCount: 8 }));
  });

  it('does not ask the LLM before a batch threshold or accept a forged cursor', async () => {
    const consolidate = vi.fn();
    vi.stubGlobal('window', { MemoryAPI: { consolidate } });
    const request = vi.fn().mockResolvedValue(JSON.stringify({ coreText: '# 核心记忆', processedThroughCount: 99 }));
    const service = new MemoryService(() => ({ globalModelConfig: { memoryModel: 'memory-model' } }) as unknown as PetConfigSnapshot, request);
    const runtime = {
      contextText: '', modelPath: 'model-a', memoryState: {
        modelPath: 'model-a', modelKey: 'model-a',
        coreText: '# 核心记忆', pendingEpisodeText: '待整理', pendingThroughCount: 7,
        state: { version: 1, conversationCount: 7, lastConversationAt: Date.now(), lastConsolidatedCount: 0, lastDecayDate: new Date().toLocaleDateString('sv-SE') },
      },
    };

    await service.consolidateIfNeeded(runtime);
    expect(request).not.toHaveBeenCalled();

    runtime.memoryState.pendingThroughCount = 8;
    runtime.memoryState.state.conversationCount = 8;
    runtime.memoryState.state.lastConversationAt = Date.now() - 86400000;
    await service.consolidateIfNeeded(runtime);
    expect(request).toHaveBeenCalledOnce();
    expect(consolidate).not.toHaveBeenCalled();
  });

  it('skips consolidation with an explicit trace when no memory model is configured', async () => {
    const consolidate = vi.fn();
    vi.stubGlobal('window', { MemoryAPI: { consolidate } });
    const request = vi.fn();
    // 没配记忆整理模型就不调用，也不借用对话模型。
    const service = new MemoryService(() => ({ globalModelConfig: { memoryModel: '' } }) as unknown as PetConfigSnapshot, request);
    const trace = { record: vi.fn() };
    const runtime = {
      contextText: '', modelPath: 'model-a', memoryState: {
        modelPath: 'model-a', modelKey: 'model-a', coreText: '# 核心记忆',
        pendingEpisodeText: '待整理', pendingThroughCount: 8,
        state: { version: 1, conversationCount: 8, lastConversationAt: Date.now() - 86400000, lastConsolidatedCount: 0, lastDecayDate: '' },
      },
    };

    await service.consolidateIfNeeded(runtime, trace as never);
    expect(request).not.toHaveBeenCalled();
    expect(consolidate).not.toHaveBeenCalled();
    expect(trace.record).toHaveBeenCalledWith('memory.consolidation.skipped',
      expect.objectContaining({ reason: 'no-memory-model' }));
  });
});
