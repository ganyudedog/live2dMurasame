export class LlmMemoryRepository {
  async get(modelPath?: string): Promise<PetModelMemoryState | null> {
    return await window.MemoryAPI?.get?.({ modelPath }) ?? null;
  }

  recallEpisodes(payload: {
    modelPath: string;
    dates: string[];
    query?: string;
    speaker?: 'user' | 'assistant' | 'both';
    approximate?: boolean;
    maxChars?: number;
  }) {
    return window.MemoryAPI?.recallEpisodes?.(payload);
  }

  appendConversation(payload: { modelPath: string; userText: string; assistantText: string; at?: number }) {
    return window.MemoryAPI?.appendConversation?.(payload);
  }

  updateCore(payload: { modelPath: string; content: string }) {
    return window.MemoryAPI?.updateCore?.(payload);
  }

  consolidate(payload: { modelPath: string; content: string; processedThroughCount: number }) {
    return window.MemoryAPI?.consolidate?.(payload);
  }
}
