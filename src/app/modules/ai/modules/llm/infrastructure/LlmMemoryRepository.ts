export class LlmMemoryRepository {
  async get(modelPath?: string): Promise<PetModelMemoryState | null> {
    return await window.MemoryAPI?.get?.({ modelPath }) ?? null;
  }

  update(patch: Parameters<NonNullable<PetMemoryAPI['update']>>[0]) {
    return window.MemoryAPI?.update?.(patch);
  }

  readKnowledge(knowledgeBasePath: string, modelPath?: string) {
    return window.MemoryAPI?.readRagTextFile?.({ knowledgeBasePath, modelPath });
  }
}
