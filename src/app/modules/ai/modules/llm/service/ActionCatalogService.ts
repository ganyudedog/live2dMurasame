import { sourceContexts } from '../domain/action-catalog/sourceContext.js';
import { parseActionCatalog, type ActionDefinition, type ActionSourceData } from '../../../../../../../shared/actionCatalog.js';
import { ACTION_CATALOG_PROMPT } from '../domain/action-catalog/contract.js';

type StructuredRequest = (system: string, user: string, signal?: AbortSignal) => Promise<string>;
export interface ActionCatalogRefinement {
  sources: ActionSourceData;
  actions: ActionDefinition[];
  referencedIds: string[];
  history: Array<{ role: string; text: string }>;
  instruction: string;
}
export interface ActionCatalogReply { message?: string; actions?: ActionDefinition[] }

/** LlmService 的子服务：只负责参数理解与结构化生成，不持有 UI、缓存或 IPC。 */
export class ActionCatalogService {
  private readonly request: StructuredRequest;
  constructor(request: StructuredRequest) { this.request = request; }

  async generate(sources: ActionSourceData, signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => void): Promise<ActionDefinition[]> {
    const contexts = sourceContexts(sources);
    const input = contexts.length === 1 ? { sources: contexts[0] }
      : { parameters: sources.parameters, candidates: await this.analyze(sources, contexts, signal, onProgress) };
    const reply = await this.ask(sources, `${ACTION_CATALOG_PROMPT}\n彻底重新生成少量动作，输出 {"actions":[...]}。
如果输入为分批分析候选，请合并重复动作、补齐同类动作的参数组合，保留稳定 ID 和有证据的明显幅度。`, input, signal);
    if (!reply.actions?.length) throw new Error('LLM 未生成有效动作表');
    return reply.actions;
  }

  async refine(input: ActionCatalogRefinement, signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => void): Promise<ActionCatalogReply> {
    // 精调已引用的动作只需其参数曲线；新增动作仍读取全部曲线。参数清单始终提供完整能力。
    const referenced = input.actions.filter((action) => input.referencedIds.includes(action.id));
    const ids = new Set(referenced.flatMap((action) => action.tracks.map((track) => track.parameterId)));
    const relevant = ids.size ? { ...input.sources, motions: input.sources.motions.map((motion) => ({
      ...motion, curves: motion.curves.filter((curve) => ids.has(curve.parameterId)),
    })) } : input.sources;
    const contexts = sourceContexts(relevant);
    const evidence = contexts.length === 1 ? contexts[0]
      : { candidates: await this.analyze(input.sources, contexts, signal, onProgress) };
    return this.ask(input.sources, `${ACTION_CATALOG_PROMPT}\n输出 {"message":"答复","actions":[完整的新动作表]}。
只回答问题时省略 actions；删除全部时返回 []。当前动作表是最新状态。优先操作 referencedIds 指定的动作；保留未要求修改的动作和 ID。
根据用户反馈直接调整对应关键帧的幅度、时机或参数组合，允许新增、删除动作。`, {
      parameters: input.sources.parameters, evidence, actions: input.actions,
      referencedIds: input.referencedIds, history: input.history, instruction: input.instruction,
    }, signal);
  }

  private async analyze(sources: ActionSourceData, contexts: unknown[], signal?: AbortSignal,
    onProgress?: (completed: number, total: number) => void): Promise<ActionDefinition[]> {
    const candidates: ActionDefinition[] = [];
    onProgress?.(0, contexts.length);
    // 配置阶段串行分批，任一批次失败都不提交残缺动作表。
    for (let i = 0; i < contexts.length; i++) {
      if (signal?.aborted) throw new Error('动作分析已取消');
      const result = await this.ask(sources, `${ACTION_CATALOG_PROMPT}\n这是全部模型曲线的一个批次。
只提取本批证据充分的最多 3 个候选短动作，每个动作尽量只用 1~4 个关键参数。没有合适候选时输出 {"actions":[]}。
不要为了凑数重复动作或猜测未知参数。输出 {"actions":[...]}。`, { sources: contexts[i] }, signal);
      candidates.push(...(result.actions ?? []));
      onProgress?.(i + 1, contexts.length);
    }
    if (!candidates.length) throw new Error('未从模型参数曲线中识别到可用动作');
    return candidates;
  }

  private async ask(sources: ActionSourceData, prompt: string, input: unknown, signal?: AbortSignal): Promise<ActionCatalogReply> {
    if (!sources.motions.length || !sources.parameters.length) throw new Error('模型没有可分析的参数曲线');
    const raw = await this.request(prompt, JSON.stringify(input), signal);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('LLM 返回格式无效');
    const record = parsed as Record<string, unknown>;
    const actions = 'actions' in record ? parseActionCatalog(record.actions) : undefined;
    const allowed = new Set(sources.parameters.map(({ id }) => id));
    for (const action of actions ?? []) for (const track of action.tracks) {
      if (!allowed.has(track.parameterId)) throw new Error(`模型没有可用的动作参数：${track.parameterId}`);
    }
    const message = typeof record.message === 'string' ? record.message.trim() : undefined;
    if (!actions && !message) throw new Error('LLM 未返回调整结果');
    return { actions, message };
  }
}
