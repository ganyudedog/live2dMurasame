import { makeAutoObservable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx';
import type { ActionCatalogService } from '@app/modules/ai/modules/llm/service/ActionCatalogService.js';
import { parseActionCatalog, type ActionSourceData } from '../../../../../../../shared/actionCatalog.js';
import type { ActionSettingsView } from '../domain/view';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { ActionDefinition } from '@app/modules/live2d/modules/actions/domain/types';
import { ACTION_SESSION_MESSAGE_LIMIT, referencedActionIds, type ActionCatalogMessage } from '../domain/session';
import { readActionSession, writeActionSession } from '../infrastructure/sessionCache';

interface CatalogRequest { path: string; epoch: number; controller: AbortController }

export class ActionSettingsService {
  actions: ActionDefinition[] = [];
  sources: ActionSourceData | null = null;
  selectedId: string | null = null;
  messages: ActionCatalogMessage[] = [];
  draft = '';
  busy = false;
  error: string | null = null;
  private disposers: IReactionDisposer[] = [];
  private scope = '';
  private epoch = 0;
  private controller: AbortController | null = null;
  private readonly generator: ActionCatalogService;
  private readonly config: ConfigService;

  constructor(generator: ActionCatalogService, config: ConfigService) {
    this.generator = generator;
    this.config = config;
    makeAutoObservable<this, 'generator' | 'config' | 'controller' | 'disposers'>(this,
      { generator: false, config: false, controller: false, disposers: false, sources: observableRef }, { autoBind: true });
    this.syncModel();
  }

  start(): void {
    if (this.disposers.length) return;
    this.disposers.push(
      reaction(() => this.config.activeModelPath, () => {
        this.syncModel();
        void this.load();
      }, { fireImmediately: true }),
      reaction(() => this.config.modelConfig?.actions, () => {
        this.actions = (this.config.modelConfig?.actions ?? []) as ActionDefinition[];
        if (!this.actions.some((action) => action.id === this.selectedId)) this.selectedId = null;
      }),
    );
  }

  dispose(): void {
    this.cacheSession();
    this.controller?.abort();
    this.epoch++;
    this.busy = false;
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
  }

  private syncModel(): void {
    this.cacheSession();
    this.controller?.abort();
    this.controller = null;
    this.epoch++;
    this.scope = this.config.activeModelPath ?? '';
    const session = readActionSession(this.scope);
    this.messages = session.messages;
    this.draft = session.draft;
    this.actions = (this.config.modelConfig?.actions ?? []) as ActionDefinition[];
    this.sources = null;
    this.selectedId = null;
    this.busy = false;
    this.error = null;
  }

  async load(): Promise<void> {
    const path = this.scope;
    const epoch = this.epoch;
    try {
      const sources = path ? await this.config.getActionSources(path) : null;
      if (path !== this.scope || epoch !== this.epoch) return;
      runInAction(() => {
        this.sources = sources;
      });
    } catch (error) {
      if (path === this.scope && epoch === this.epoch) runInAction(() => {
        this.sources = null;
        this.error = `读取原生动作失败：${error instanceof Error ? error.message : String(error)}`;
      });
    }
  }

  select(id: string): void { this.selectedId = id; }
  setDraft(value: string): void { this.draft = value; this.cacheSession(); }
  clearChat(): void {
    if (this.busy) return;
    this.messages = [];
    this.error = null;
    this.cacheSession();
  }

  /** 重建重新读取原生参数曲线，不复用旧动作表或微调会话。成功后建立新的会话边界。 */
  async generate(): Promise<void> {
    const request = this.beginRequest();
    if (!request) return;
    const pending = this.addMessage('assistant', '正在重新生成动作表…', 'sending');
    try {
      await this.load();
      if (!this.isCurrent(request)) return;
      if (this.error) throw new Error(this.error);
      if (!this.sources?.motions.length) throw new Error('当前模型没有可用于生成动作表的参数曲线');
      const next = await this.generator.generate(this.sources, request.controller.signal, (completed, total) => {
        if (this.isCurrent(request)) runInAction(() => { pending.text = `正在分析模型参数（${completed}/${total}），完成后生成并保存动作表…`; });
      });
      if (!this.isCurrent(request)) return;
      if (!next.length) throw new Error('LLM 未生成有效动作表');
      await this.persist(next, request);
      if (!this.isCurrent(request)) return;
      runInAction(() => {
        // 保留可见会话记录；后续微调的 LLM 上下文从此次重建开始。
        pending.role = 'system';
        pending.text = `已重新生成并保存 ${next.length} 个动作，旧动作表已替换。`;
        pending.status = 'done';
        pending.resetsContext = true;
        this.cacheSession();
      });
    } catch (error) { this.failRequest(request, pending, error); }
    finally { this.finishRequest(request); }
  }

  async submit(): Promise<void> {
    const instruction = this.draft.trim();
    if (!instruction || this.busy) return;
    await this.refine(instruction);
  }

  async refine(instruction: string): Promise<void> {
    if (!instruction.trim()) return;
    const request = this.beginRequest();
    if (!request) return;
    const contextStart = this.messages.map((message) => message.resetsContext === true).lastIndexOf(true);
    const history = this.messages.slice(Math.max(0, contextStart)).filter((message) => message.status === 'done')
      .map(({ role, text }) => ({ role, text }));
    this.setDraft('');
    this.addMessage('user', instruction);
    const pending = this.addMessage('assistant', '正在调整动作表…', 'sending');
    try {
      if (!this.sources) await this.load();
      if (!this.sources) throw new Error(this.error ?? '无法读取模型动作参数');
      if (!this.isCurrent(request)) return;
      const ids = referencedActionIds(instruction);
      const missing = ids.filter((id) => !this.actions.some((action) => action.id === id));
      if (missing.length) throw new Error(`引用的动作不存在：${missing.join('、')}。请从动作表重新选择。`);
      const reply = await this.generator.refine({ sources: this.sources, actions: parseActionCatalog(this.actions),
        referencedIds: ids, history, instruction }, request.controller.signal, (completed, total) => {
        if (this.isCurrent(request)) runInAction(() => { pending.text = `正在分析动作参数（${completed}/${total}）…`; });
      });
      if (!this.isCurrent(request)) return;
      if (reply.actions) await this.persist(reply.actions, request);
      else if (typeof reply.message !== 'string' || !reply.message.trim()) throw new Error('LLM 未返回调整结果');
      if (!this.isCurrent(request)) return;
      runInAction(() => {
        pending.text = typeof reply.message === 'string' && reply.message.trim()
          ? reply.message.trim() : '已更新并保存动作表。';
        pending.status = 'done';
        this.cacheSession();
      });
    } catch (error) {
      this.failRequest(request, pending, error);
      if (this.isCurrent(request)) runInAction(() => { this.setDraft(instruction); });
    } finally { this.finishRequest(request); }
  }

  async deleteAction(id: string): Promise<void> {
    const action = this.actions.find((item) => item.id === id);
    if (!action) return;
    const request = this.beginRequest();
    if (!request) return;
    const pending = this.addMessage('system', `正在删除「${action.label}」…`, 'sending');
    try {
      await this.persist(this.actions.filter((item) => item.id !== id), request);
      if (!this.isCurrent(request)) return;
      runInAction(() => {
        pending.text = `已删除「${action.label}」（${id}）。`;
        pending.status = 'done';
        this.cacheSession();
      });
    } catch (error) { this.failRequest(request, pending, error); }
    finally { this.finishRequest(request); }
  }

  async updateMetadata(id: string, label: string, description: string): Promise<boolean> {
    if (!label.trim()) { this.error = '动作名称不能为空'; return false; }
    if (!this.actions.some((action) => action.id === id)) { this.error = '动作不存在'; return false; }
    const request = this.beginRequest();
    if (!request) return false;
    try {
      // 仅修正语义信息，保持 ID、关键帧和时序；统一走后端保存及快照广播。
      await this.persist(this.actions.map((action) => action.id === id
        ? { ...action, label: label.trim(), description: description.trim() } : action), request);
      return this.isCurrent(request);
    } catch (error) {
      if (this.isCurrent(request)) runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      return false;
    } finally { this.finishRequest(request); }
  }

  async preview(id: string): Promise<void> {
    const path = this.scope;
    const epoch = this.epoch;
    try { await this.config.previewAction(path, id); }
    catch (error) {
      if (path === this.scope && epoch === this.epoch) runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
    }
  }

  /** UI 只拿数据快照；服务、IPC 与 observable 引用不进入展示组件。 */
  get view(): ActionSettingsView {
    return { modelPath: this.scope, actions: parseActionCatalog(this.actions), selectedId: this.selectedId,
      messages: this.messages.map((message) => ({ ...message })), draft: this.draft, busy: this.busy, error: this.error };
  }

  private beginRequest(): CatalogRequest | null {
    if (this.busy) return null;
    if (!this.scope) { this.error = '请先选择模型'; return null; }
    this.busy = true;
    this.error = null;
    this.controller = new AbortController();
    return { path: this.scope, epoch: this.epoch, controller: this.controller };
  }

  private isCurrent(request: CatalogRequest): boolean {
    return request.path === this.config.activeModelPath && request.epoch === this.epoch
      && !request.controller.signal.aborted;
  }

  private finishRequest(request: CatalogRequest): void {
    if (!this.isCurrent(request)) return;
    this.busy = false;
    this.controller = null;
  }

  private failRequest(request: CatalogRequest, pending: ActionCatalogMessage, error: unknown): void {
    if (!this.isCurrent(request)) return;
    this.error = error instanceof Error ? error.message : String(error);
    pending.text = this.error;
    pending.status = 'error';
    this.cacheSession();
  }

  private async persist(actions: ActionDefinition[], request: CatalogRequest): Promise<void> {
    // 使用请求开始时的模型路径，禁止将延迟返回的结果写入新切换的模型。
    if (!this.isCurrent(request)) return;
    const saved = await this.config.saveActionCatalog(request.path, actions);
    if (!this.isCurrent(request)) return;
    runInAction(() => {
      this.actions = saved;
      if (!saved.some((action) => action.id === this.selectedId)) this.selectedId = null;
    });
  }

  private addMessage(role: ActionCatalogMessage['role'], text: string,
    status: ActionCatalogMessage['status'] = 'done'): ActionCatalogMessage {
    this.messages.push({ id: crypto.randomUUID(), role, text, status });
    this.messages = this.messages.slice(-ACTION_SESSION_MESSAGE_LIMIT);
    this.cacheSession();
    return this.messages[this.messages.length - 1];
  }

  private cacheSession(): void {
    writeActionSession(this.scope, { draft: this.draft, messages: this.messages });
  }

}
