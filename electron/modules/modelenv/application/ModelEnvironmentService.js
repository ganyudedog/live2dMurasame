import { parseModelInteractionCatalog } from '../infrastructure/ModelConfigParser.js';
import { parseActionCatalog } from '../../../../shared/actionCatalog.js';
import { readActionSources } from '../infrastructure/ActionSourceReader.js';

export class ModelEnvironmentService {
  constructor({ repository, memoryRepository, log, interactionCatalogReader = parseModelInteractionCatalog, actionSourceReader = readActionSources }) {
    this.repository = repository;
    this.memoryRepository = memoryRepository;
    this.log = log;
    this.interactionCatalogReader = interactionCatalogReader;
    this.actionSourceReader = actionSourceReader;
    this.cache = new Map();
  }

  getEnvironment(modelPath) {
    if (!modelPath) return null;
    if (!this.cache.has(modelPath)) this.cache.set(modelPath, this.repository.load(modelPath));
    return this.cache.get(modelPath);
  }

  getConfiguration(modelPath) {
    return this.getEnvironment(modelPath)?.configuration ?? null;
  }

  updateConfiguration(modelPath, patch = {}) {
    const environment = this.getEnvironment(modelPath);
    if (!environment) throw new Error('No model path available to update model configuration');
    const base = environment.configuration ?? {};
    const merge = (key) => patch[key] && typeof patch[key] === 'object'
      ? { ...(base[key] ?? {}), ...patch[key] }
      : base[key];
    const configuration = {
      ...base,
      ...patch,
      bubble: merge('bubble'),
      interaction: Object.prototype.hasOwnProperty.call(patch, 'interaction') ? patch.interaction : base.interaction,
      persona: merge('persona'),
      tts: merge('tts'),
    };
    delete configuration.rag;
    if (Object.prototype.hasOwnProperty.call(patch, 'actions')) {
      configuration.actions = parseActionCatalog(patch.actions);
      if (configuration.actions.length) {
        const parameters = new Set(this.getActionSources(modelPath).parameters.map(({ id }) => id));
        for (const action of configuration.actions) for (const track of action.tracks) {
          if (!parameters.has(track.parameterId)) throw new Error(`模型没有可用的动作参数：${track.parameterId}`);
        }
      }
    }
    // visualFrame was a legacy, renderer-only tuning block. Do not carry it
    // forward when an old model environment is updated.
    delete configuration.visualFrame;
    const saved = this.repository.save(environment.updateConfiguration(configuration));
    this.cache.set(modelPath, saved);
    return saved;
  }

  getInteractionView(modelPath) {
    if (!modelPath) return null;
    const catalog = this.interactionCatalogReader(modelPath);
    const saved = this.getConfiguration(modelPath)?.interaction;
    const hasSavedBindings = saved && typeof saved === 'object' && !Array.isArray(saved);
    return {
      motions: catalog.motions,
      hitAreas: catalog.hitAreas.map((area) => ({
        name: area.name,
        motions: hasSavedBindings && Array.isArray(saved[area.name])
          ? saved[area.name].map((item) => ({ ...item }))
          : area.motions.map((item) => ({ ...item })),
      })),
    };
  }

  getActionSources(modelPath) {
    if (!modelPath) throw new Error('请先选择模型');
    return this.actionSourceReader(modelPath);
  }

  saveActionCatalog(modelPath, actions) {
    this.updateConfiguration(modelPath, { actions });
    // 重新通过 repository/DAO 读取实际落盘结果，返回值不能只回显生成请求。
    this.clear(modelPath);
    return this.getEnvironment(modelPath);
  }

  getMemory(modelPath) {
    return modelPath ? this.memoryRepository.load(modelPath) : null;
  }

  recallMemoryEpisodes(modelPath, query) {
    return modelPath ? this.memoryRepository.recallEpisodes(modelPath, query) : {
      status: 'empty', dates: [], matches: [], text: '', approximate: Boolean(query?.approximate),
    };
  }

  updateMemory(modelPath, patch) {
    return modelPath ? this.memoryRepository.save(modelPath, patch) : null;
  }

  appendMemoryConversation(modelPath, conversation) {
    return modelPath ? this.memoryRepository.appendConversation(modelPath, conversation) : null;
  }

  updateMemoryCore(modelPath, content) {
    return modelPath ? this.memoryRepository.updateCore(modelPath, content) : null;
  }

  replaceActionCatalogChat(modelPath, content) {
    return modelPath ? this.memoryRepository.replaceActionCatalogChat(modelPath, content) : null;
  }

  consolidateMemory(modelPath, content, processedThroughCount) {
    return modelPath ? this.memoryRepository.consolidate(modelPath, content, processedThroughCount) : null;
  }

  clear(modelPath) {
    this.cache.delete(modelPath);
  }
}
