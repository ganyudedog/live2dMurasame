import type { MemoryRepository } from '../../modules/modelenv/application/ModelEnvironmentService.js';
import {
  loadModelMemoryDocuments,
  loadRecentModelMemoryTurns,
  recallModelMemoryEpisodes,
  appendModelMemoryConversation,
  updateModelMemoryCore,
  replaceActionCatalogChat,
  updateModelMemoryMaintenanceState,
  saveModelMemoryConsolidation,
  adjustModelMemoryRelationship,
} from '../../dao/modelMemoryDao.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class JsonModelMemoryRepository implements MemoryRepository {
  load(modelPath: string): unknown {
    return loadModelMemoryDocuments(modelPath);
  }

  loadRecentTurns(modelPath: string, query: unknown): unknown {
    return loadRecentModelMemoryTurns(modelPath, query);
  }

  recallEpisodes(modelPath: string, query: unknown): unknown {
    return recallModelMemoryEpisodes(modelPath, query);
  }

  save(modelPath: string, patch: unknown = {}): unknown {
    const input = isRecord(patch) ? patch : {};
    if (typeof input.coreText === 'string') return updateModelMemoryCore(modelPath, input.coreText);
    if (isRecord(input.maintenance)) updateModelMemoryMaintenanceState(modelPath, input.maintenance);
    return loadModelMemoryDocuments(modelPath);
  }

  appendConversation(modelPath: string, conversation: unknown): unknown {
    return appendModelMemoryConversation(modelPath, conversation);
  }

  updateCore(modelPath: string, content: unknown): unknown {
    return updateModelMemoryCore(modelPath, content);
  }

  replaceActionCatalogChat(modelPath: string, content: unknown): unknown {
    return replaceActionCatalogChat(modelPath, content);
  }

  consolidate(modelPath: string, content: unknown, processedThroughCount: unknown, relationshipEvents?: unknown): unknown {
    return saveModelMemoryConsolidation(modelPath, { content, processedThroughCount, relationshipEvents });
  }

  adjustRelationship(modelPath: string, input: unknown): unknown {
    return adjustModelMemoryRelationship(modelPath, input);
  }
}
