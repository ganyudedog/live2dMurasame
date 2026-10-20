import { makeAutoObservable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx';
import type { ActionCatalogService } from '@app/modules/ai/modules/llm/service/ActionCatalogService.js';
import { parseActionCatalog, type ActionSourceData } from '../../../../../../../shared/actionCatalog.js';
import type { ActionSettingsView } from '../domain/view';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { ActionDefinition } from '@app/modules/live2d/modules/actions/domain/types';
import { ACTION_SESSION_MESSAGE_LIMIT, referencedActionIds, type ActionCatalogMessage } from '../domain/session';
import { readActionSession, writeActionSession } from '../infrastructure/sessionCache';
import type { GenerationConstraints, GenerationProgress, GenerationReviewReport, GenerationTaskState } from '@app/modules/ai/modules/llm/domain/action-catalog/generation';
import { clearGenerationCheckpoint, generationKey, readGenerationCheckpoint, writeGenerationCheckpoint } from '../infrastructure/generationCache';

interface CatalogRequest { path: string; epoch: number; controller: AbortController }

export class ActionSettingsService {
  actions: ActionDefinition[] = [];
  sources: ActionSourceData | null = null;
  selectedId: string | null = null;
  messages: ActionCatalogMessage[] = [];
  draft = '';
  busy = false;
  canCancel = false;
  taskNotice: string | null = null;
  error: string | null = null;
  private disposers: IReactionDisposer[] = [];
  private scope = '';
  private epoch = 0;
  private controller: AbortController | null = null;
  private persistedActionTranscript = '';
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
    this.canCancel = false;
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
  }

  private syncModel(): void {
    this.cacheSession();
    this.controller?.abort();
    this.controller = null;
    this.epoch++;
    this.scope = this.config.activeModelPath ?? '';
    this.persistedActionTranscript = '';
    const session = readActionSession(this.scope);
    this.messages = session.messages;
    this.draft = session.draft;
    this.actions = (this.config.modelConfig?.actions ?? []) as ActionDefinition[];
    this.sources = null;
    this.taskNotice = null;
    this.selectedId = null;
    this.busy = false;
    this.canCancel = false;
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
    this.canCancel = true;
    this.taskNotice = null;
    const pending = this.addMessage('assistant', '正在重新生成动作表…', 'sending');
    try {
      await this.load();
      if (!this.isCurrent(request)) return;
      if (this.error) throw new Error(this.error);
      if (!this.sources?.motions.length) throw new Error('当前模型没有可用于生成动作表的参数曲线');
      const constraints = this.constraints();
      const key = await generationKey({ sources: this.sources, constraints, llm: this.config.globalModelConfig });
      if (!this.isCurrent(request)) return;
      const checkpoint = readGenerationCheckpoint(request.path, key);
      if (checkpoint) runInAction(() => {
        if (checkpoint.task) pending.task = this.taskView(checkpoint.task, '从 checkpoint 恢复任务');
        const batches = Object.keys(checkpoint.batches).length;
        const draft = checkpoint.composition?.draft;
        const composed = draft?.length ?? Object.keys(checkpoint.composition?.completed ?? {}).length;
        this.taskNotice = draft
          ? `已恢复 ${batches} 批曲线分析和 ${draft.length} 个已编排动作，将从最终检查继续。`
          : `已恢复 ${batches} 批曲线分析和 ${composed} 个已编排动作，将从上次中断处继续。`;
      });
      let report: GenerationReviewReport | undefined;
      const next = await this.generator.generate(this.sources, request.controller.signal,
        (progress) => this.showProgress(request, pending, progress), {
          constraints, checkpoint,
          onReviewReport: (value) => { report = value; },
          onReasoningSummary: (summary) => { if (this.isCurrent(request)) runInAction(() => {
            pending.reasoningSummary = summary.slice(-2000);
          }); },
          onTaskState: (state) => { if (this.isCurrent(request)) runInAction(() => { pending.task = this.taskView(state); this.cacheSession(); }); },
          onCheckpoint: (checkpoint) => {
            if (!this.isCurrent(request)) return;
            const persisted = writeGenerationCheckpoint(request.path, key, checkpoint);
            runInAction(() => {
              const count = Object.keys(checkpoint.batches).length;
              const composed = checkpoint.composition?.draft?.length ?? Object.keys(checkpoint.composition?.completed ?? {}).length;
              this.taskNotice = persisted ? `已缓存 ${count} 批分析、${composed} 个已编排动作；任务中断可继续。`
                : `本地缓存写入失败；${count} 批分析、${composed} 个动作仅保留在当前窗口，请勿关闭或刷新。`;
            });
            if (this.isCurrent(request) && checkpoint.task) runInAction(() => { pending.task = this.taskView(checkpoint.task!); });
          },
        });
      if (!this.isCurrent(request)) return;
      if (!next.length) throw new Error('LLM 未生成有效动作表');
      await this.persist(next, request);
      if (!this.isCurrent(request)) return;
      clearGenerationCheckpoint(request.path);
      runInAction(() => {
        this.taskNotice = null;
        // 保留可见会话记录；后续微调的 LLM 上下文从此次重建开始。
        pending.role = 'system';
        pending.text = `已重新生成并保存 ${next.length} 个动作，旧动作表已替换。${this.reviewSummary(report)}`;
        pending.reviewNotes = report?.issues.map(({ actionId, message }) => ({ actionId, message }));
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
    this.canCancel = true;
    const contextStart = this.messages.map((message) => message.resetsContext === true).lastIndexOf(true);
    const history = this.messages.slice(Math.max(0, contextStart)).filter((message) => message.status === 'done')
      .map(({ role, text, reviewNotes }) => ({ role, text: reviewNotes?.length
        ? `${text}\n待预览的模型建议（非视觉事实）：${JSON.stringify(reviewNotes)}` : text }));
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
      const constraints = this.constraints();
      const key = await generationKey({ mode: 'refine', sources: this.sources, actions: this.actions,
        instruction, constraints, llm: this.config.globalModelConfig });
      if (!this.isCurrent(request)) return;
      const checkpoint = readGenerationCheckpoint(request.path, key, 'refine');
      if (checkpoint?.task) runInAction(() => { pending.task = this.taskView(checkpoint.task!, '恢复微调任务'); });
      let report: GenerationReviewReport | undefined;
      const reply = await this.generator.refine({ sources: this.sources, actions: parseActionCatalog(this.actions),
        referencedIds: ids, history, instruction }, request.controller.signal,
        (progress) => this.showProgress(request, pending, progress), { constraints, checkpoint,
          onCheckpoint: (value) => {
            if (!this.isCurrent(request)) return;
            const persisted = writeGenerationCheckpoint(request.path, key, value, 'refine');
            if (!persisted) runInAction(() => {
              this.taskNotice = '微调检查点仅保留在当前窗口：本地缓存写入失败，请勿刷新。';
            });
          },
          onReviewReport: (value) => { report = value; },
          onTaskState: (state) => { if (this.isCurrent(request)) runInAction(() => { pending.task = this.taskView(state); this.cacheSession(); }); },
          onReasoningSummary: (summary) => { if (this.isCurrent(request)) runInAction(() => {
            pending.reasoningSummary = summary.slice(-2000);
          }); } });
      if (!this.isCurrent(request)) return;
      if (reply.actions) await this.persist(reply.actions, request);
      else if (typeof reply.message !== 'string' || !reply.message.trim()) throw new Error('LLM 未返回调整结果');
      if (!this.isCurrent(request)) return;
      clearGenerationCheckpoint(request.path, 'refine');
      runInAction(() => {
        pending.text = typeof reply.message === 'string' && reply.message.trim()
          ? reply.message.trim() : '已更新并保存动作表。';
        if (reply.actions && report) {
          pending.text += `\n${this.reviewSummary(report)}`;
          pending.reviewNotes = report.issues.map(({ actionId, message }) => ({ actionId, message }));
        }
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
      messages: this.messages.map((message) => ({ ...message,
        reviewNotes: message.reviewNotes?.map((note) => ({ ...note })),
        task: message.task ? JSON.parse(JSON.stringify(message.task)) : undefined })), draft: this.draft, busy: this.busy, canCancel: this.canCancel,
      taskNotice: this.taskNotice, error: this.error };
  }

  cancel(): void {
    if (!this.canCancel) return;
    this.controller?.abort();
    this.controller = null;
    this.epoch++;
    this.busy = false;
    this.canCancel = false;
    this.messages.filter((message) => message.status === 'sending').forEach((message) => {
      message.text = '已取消，原动作表未更改。重新生成时可复用已完成的曲线分析。';
      message.status = 'error';
      if (message.task) message.task = { ...message.task, status: 'paused', stopReason: 'cancelled' };
    });
    this.cacheSession();
  }

  private constraints(): GenerationConstraints {
    const config = this.config.live2denvConfig;
    const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    // 与PetCanvas使用相同配置默认值；窗口调试覆盖不属于持久配置。
    return { parameterMax: { ParamEyeBallY: finite(config?.eyeMaxUp, 0.5), ParamAngleY: finite(config?.angleMaxUp, 20) },
      parameterMin: { ParamEyeBallY: -1, ParamAngleY: -40 } };
  }

  private reviewSummary(report?: GenerationReviewReport): string {
    return report?.status === 'needs-preview'
      ? `执行检查通过；${new Set(report.issues.map((issue) => issue.actionId)).size} 个动作仍有表现建议，已保存，待预览确认。`
      : '执行检查通过，编排审查无剩余建议；实际表现请通过预览或试聊确认。';
  }

  private showProgress(request: CatalogRequest, pending: ActionCatalogMessage, progress: GenerationProgress): void {
    if (!this.isCurrent(request)) return;
    const labels = { analyzing: '分析联合动作片段', planning: '规划对话反应目录', composing: '编排完整对话反应', checking: '检查参数与时间轴',
      reviewing: '审查动作组合与表现', repairing: '定向修订问题动作' };
    runInAction(() => {
      pending.text = `正在${labels[progress.stage]}（${progress.completed}/${progress.total}）${progress.reused ? `，已复用${progress.reused}项` : ''}${progress.round ? `，第${progress.round}轮修订` : ''}…`;
      if (progress.task) pending.task = this.taskView(progress.task, labels[progress.stage]);
    });
  }

  private taskView(state: GenerationTaskState, plan?: string): NonNullable<ActionCatalogMessage['task']> {
    return { ...state, plan: [...state.plan], issues: state.issues.map((i) => ({ ...i })),
      openIssueIds: [...state.openIssueIds], history: state.history.map((h) => ({ ...h, issueIds: [...h.issueIds] })),
      budget: { ...state.budget }, currentStep: plan };
  }

  private beginRequest(): CatalogRequest | null {
    if (this.busy) return null;
    if (!this.scope) { this.error = '请先选择模型'; return null; }
    this.busy = true;
    this.canCancel = false;
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
    this.canCancel = false;
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
    runInAction(() => { this.canCancel = false; }); // IPC提交开始后不能撤销落盘，禁止虚假的“已取消”。
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
    try { writeActionSession(this.scope, { draft: this.draft, messages: this.messages }); }
    catch { this.taskNotice = '编辑会话缓存写入失败；已完成步骤保留在当前窗口，请勿刷新。'; }
    const transcript = this.messages.filter((message) => message.status !== 'sending')
      .map((message) => `### ${message.role}\n\n${message.text.trim()}`)
      .filter((block) => block.trim())
      .join('\n\n');
    if (!this.scope || transcript === this.persistedActionTranscript) return;
    this.persistedActionTranscript = transcript;
    const replace = this.config.replaceActionCatalogChat;
    if (replace) void replace.call(this.config, this.scope, transcript).catch(() => {
      // Markdown 会话归档属于辅助数据，失败不阻断动作表保存或微调。
    });
  }

}
