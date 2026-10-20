import {
  loadModelMemoryDocuments,
  recallModelMemoryEpisodes,
  appendModelMemoryConversation,
  updateModelMemoryCore,
  replaceActionCatalogChat,
  updateModelMemoryMaintenanceState,
  saveModelMemoryConsolidation,
} from '../../dao/modelMemoryDao.js';

export class JsonModelMemoryRepository {
  load(modelPath) {
    return loadModelMemoryDocuments(modelPath);
  }

  recallEpisodes(modelPath, query) {
    return recallModelMemoryEpisodes(modelPath, query);
  }

  save(modelPath, patch = {}) {
    // 保留旧接口，便于升级过程中未更新的渲染器继续工作；新链路使用
    // appendConversation/updateCore，不再写 recent.json、summary.json、meta.json。
    if (typeof patch.coreText === 'string') return updateModelMemoryCore(modelPath, patch.coreText);
    if (patch.maintenance && typeof patch.maintenance === 'object') {
      updateModelMemoryMaintenanceState(modelPath, patch.maintenance);
    }
    return loadModelMemoryDocuments(modelPath);
  }

  appendConversation(modelPath, conversation) {
    return appendModelMemoryConversation(modelPath, conversation);
  }

  updateCore(modelPath, content) {
    return updateModelMemoryCore(modelPath, content);
  }

  replaceActionCatalogChat(modelPath, content) {
    return replaceActionCatalogChat(modelPath, content);
  }

  consolidate(modelPath, content, processedThroughCount) {
    return saveModelMemoryConsolidation(modelPath, { content, processedThroughCount });
  }
}
