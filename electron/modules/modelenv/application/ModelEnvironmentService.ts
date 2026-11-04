import { parseActionCatalog, type ActionDefinition } from '../../../../shared/live2d/actionCatalog.js';
import { readActionSources } from '../infrastructure/ActionSourceReader.js';
import { parseModelInteractionCatalog, type InteractionHitArea, type InteractionMotion } from '../infrastructure/ModelConfigParser.js';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export interface EnvironmentRepository {
  load(modelPath: string): Record<string, unknown>;
  save(modelPath: string, configuration: Record<string, unknown>): Record<string, unknown>;
}

export interface MemoryRepository {
  load(modelPath: string): unknown;
  loadRecentTurns(modelPath: string, query: unknown): unknown;
  recallEpisodes(modelPath: string, query: unknown): unknown;
  save(modelPath: string, patch?: unknown): unknown;
  appendConversation(modelPath: string, conversation: unknown): unknown;
  updateCore(modelPath: string, content: unknown): unknown;
  replaceActionCatalogChat(modelPath: string, content: unknown): unknown;
  consolidate(modelPath: string, content: unknown, processedThroughCount: unknown): unknown;
}

type CatalogReader = (modelPath: string) => { motions: InteractionMotion[]; hitAreas: InteractionHitArea[] };
type ActionReader = typeof readActionSources;

const emptyRecall = (query: unknown) => ({
  status: 'empty',
  dates: [] as string[],
  matches: [] as unknown[],
  text: '',
  approximate: isRecord(query) && Boolean(query.approximate),
});

export class ModelEnvironmentService {
  private readonly repository: EnvironmentRepository;
  private readonly memoryRepository: MemoryRepository;
  readonly log: unknown;
  private readonly interactionCatalogReader: CatalogReader;
  private readonly actionSourceReader: ActionReader;
  private readonly cache = new Map<string, Record<string, unknown>>();

  constructor({
    repository,
    memoryRepository,
    log,
    interactionCatalogReader = parseModelInteractionCatalog,
    actionSourceReader = readActionSources,
  }: {
    repository: EnvironmentRepository;
    memoryRepository: MemoryRepository;
    log?: unknown;
    interactionCatalogReader?: CatalogReader;
    actionSourceReader?: ActionReader;
  }) {
    this.repository = repository;
    this.memoryRepository = memoryRepository;
    this.log = log;
    this.interactionCatalogReader = interactionCatalogReader;
    this.actionSourceReader = actionSourceReader;
  }

  getConfiguration(modelPath: string | null | undefined): Record<string, unknown> | null {
    if (!modelPath) return null;
    const cached = this.cache.get(modelPath);
    if (cached) return cached;
    const loaded = this.repository.load(modelPath);
    this.cache.set(modelPath, loaded);
    return loaded;
  }

  updateConfiguration(modelPath: string, patch: object = {}): Record<string, unknown> {
    const base = this.getConfiguration(modelPath);
    if (!base) throw new Error('No model path available to update model configuration');
    const input = isRecord(patch) ? patch : {};
    const merge = (key: string): unknown => {
      const next = input[key];
      const current = base[key];
      return isRecord(next) ? { ...(isRecord(current) ? current : {}), ...next } : current;
    };
    const configuration: Record<string, unknown> = {
      ...base,
      ...input,
      bubble: merge('bubble'),
      interaction: Object.prototype.hasOwnProperty.call(input, 'interaction') ? input.interaction : base.interaction,
      persona: merge('persona'),
      tts: merge('tts'),
    };
    delete configuration.rag;
    if (Object.prototype.hasOwnProperty.call(input, 'actions')) {
      const actions: ActionDefinition[] = parseActionCatalog(input.actions);
      configuration.actions = actions;
      if (actions.length) {
        const parameters = new Set(this.getActionSources(modelPath).parameters.map(({ id }) => id));
        for (const action of actions) for (const track of action.tracks) {
          if (!parameters.has(track.parameterId)) throw new Error(`模型没有可用的动作参数：${track.parameterId}`);
        }
      }
    }
    delete configuration.visualFrame;
    const saved = this.repository.save(modelPath, configuration);
    this.cache.set(modelPath, saved);
    return saved;
  }

  getInteractionView(modelPath: string | null | undefined): { motions: InteractionMotion[]; hitAreas: InteractionHitArea[] } | null {
    if (!modelPath) return null;
    const catalog = this.interactionCatalogReader(modelPath);
    const saved = this.getConfiguration(modelPath)?.interaction;
    const hasSavedBindings = isRecord(saved);
    return {
      motions: catalog.motions,
      hitAreas: catalog.hitAreas.map((area) => {
        const bound = hasSavedBindings ? saved[area.name] : undefined;
        const motions = Array.isArray(bound)
          ? bound.flatMap((item: unknown) => {
            if (!isRecord(item) || typeof item.group !== 'string' || typeof item.index !== 'number') return [];
            const weight = typeof item.weight === 'number' && Number.isFinite(item.weight) ? item.weight : 100;
            return [{ group: item.group, index: item.index, weight }];
          })
          : area.motions.map((item) => ({ ...item }));
        return { name: area.name, motions };
      }),
    };
  }

  getActionSources(modelPath: string): ReturnType<ActionReader> {
    if (!modelPath) throw new Error('请先选择模型');
    return this.actionSourceReader(modelPath);
  }

  saveActionCatalog(modelPath: string, actions: unknown): Record<string, unknown> | null {
    this.updateConfiguration(modelPath, { actions });
    this.clear(modelPath);
    return this.getConfiguration(modelPath);
  }

  getMemory(modelPath: string | null | undefined): unknown {
    return modelPath ? this.memoryRepository.load(modelPath) : null;
  }

  loadRecentMemoryTurns(modelPath: string | null | undefined, query: unknown): unknown {
    return modelPath ? this.memoryRepository.loadRecentTurns(modelPath, query) : { turns: [] };
  }

  recallMemoryEpisodes(modelPath: string | null | undefined, query: unknown): unknown {
    return modelPath ? this.memoryRepository.recallEpisodes(modelPath, query) : emptyRecall(query);
  }

  updateMemory(modelPath: string | null | undefined, patch: unknown): unknown {
    return modelPath ? this.memoryRepository.save(modelPath, patch) : null;
  }

  appendMemoryConversation(modelPath: string | null | undefined, conversation: unknown): unknown {
    return modelPath ? this.memoryRepository.appendConversation(modelPath, conversation) : null;
  }

  updateMemoryCore(modelPath: string | null | undefined, content: unknown): unknown {
    return modelPath ? this.memoryRepository.updateCore(modelPath, content) : null;
  }

  replaceActionCatalogChat(modelPath: string | null | undefined, content: unknown): unknown {
    return modelPath ? this.memoryRepository.replaceActionCatalogChat(modelPath, content) : null;
  }

  consolidateMemory(modelPath: string | null | undefined, content: unknown, processedThroughCount: unknown): unknown {
    return modelPath ? this.memoryRepository.consolidate(modelPath, content, processedThroughCount) : null;
  }

  clear(modelPath: string): void {
    this.cache.delete(modelPath);
  }
}
