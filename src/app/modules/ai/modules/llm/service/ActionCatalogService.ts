import { sourceContexts, type SourceContext } from '../domain/action-catalog/sourceContext.js';
import { type ActionDefinition, type ActionSourceData } from '../../../../../../../shared/actionCatalog.js';
import { ACTION_CATALOG_PROMPT, ACTION_RUNTIME_CONTRACT } from '../domain/action-catalog/contract.js';
import { inspectActions, validateActions } from '../domain/action-catalog/quality.js';
import { describeCandidates, parseReactionPlans } from '../domain/action-catalog/planning.js';
import type { CompositionCheckpoint, GenerationBudget, GenerationOptions, GenerationProgress, GenerationTaskState, ProgressListener, QualityIssue, ReviewCheckpoint } from '../domain/action-catalog/generation.js';
import { checkGenerationCancelled as cancelled } from '../domain/action-catalog/generation.js';

type StructuredRequest = (system: string, user: string, signal?: AbortSignal, options?: {
  onReasoningSummary?: (text: string) => void;
  task?: { taskId: string; versionId: string; stage?: GenerationProgress['stage'] };
}) => Promise<string>;
export interface ActionCatalogRefinement {
  sources: ActionSourceData; actions: ActionDefinition[]; referencedIds: string[];
  history: Array<{ role: string; text: string }>; instruction: string;
}
export interface ActionCatalogReply { message?: string; actions?: ActionDefinition[] }
const DEFAULT_BUDGET: Required<GenerationBudget> = { maxCalls: 48, maxDurationMs: 15 * 60_000, maxNoProgress: 2 };

class ActionTaskBudgetError extends Error {}

/** 每次 generate/refine 拥有独立运行时；不注册新服务，不持有持久化实现。 */
class ActionTaskRuntime {
  readonly budget: Required<GenerationBudget>;
  readonly checkpoint: NonNullable<GenerationOptions['checkpoint']>;
  private readonly runStartedAt = Date.now();
  private readonly previousElapsed: number;
  private state: GenerationTaskState;
  private readonly options: GenerationOptions;

  static fingerprint(value: unknown): string {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return text.length + '-' + (hash >>> 0).toString(16);
  }

  constructor(options: GenerationOptions) {
    this.options = options;
    this.checkpoint = JSON.parse(JSON.stringify(options.checkpoint ?? { batches: {} }));
    const seed = this.checkpoint.task?.schemaVersion === 1 ? this.checkpoint.task : undefined;
    const configured = { ...DEFAULT_BUDGET, ...options.budget };
    for (const key of Object.keys(DEFAULT_BUDGET) as Array<keyof GenerationBudget>) {
      const value = configured[key];
      if (!Number.isFinite(value) || value < 1) throw new Error('动作任务预算 ' + key + ' 必须为正数');
      configured[key] = Math.floor(value);
    }
    this.budget = configured;
    this.previousElapsed = seed?.elapsedMs ?? 0;
    // 用户主动继续时补充本次预算；累计调用和版本不清零，关窗等待不计费。
    this.state = {
      schemaVersion: 1, taskId: seed?.taskId ?? crypto.randomUUID(),
      revision: seed?.revision ?? 0, currentVersionId: seed?.currentVersionId ?? 'v0',
      bestVersionId: seed?.bestVersionId ?? 'v0', calls: seed?.calls ?? 0,
      startedAt: seed?.startedAt ?? Date.now(), run: (seed?.run ?? 0) + 1, runCalls: 0,
      elapsedMs: this.previousElapsed, budget: this.budget, status: 'running',
      noProgressCount: seed?.noProgressCount ?? 0, openIssueIds: [...(seed?.openIssueIds ?? [])],
      issues: seed?.issues ?? [], history: seed?.history ?? [], lastSummary: seed?.lastSummary,
      plan: seed?.plan ?? ['分析模型联合曲线', '规划并编排组合反应', '检查执行约束与表现建议', '按问题修订，保留最佳版本'],
    };
  }

  snapshot(): GenerationTaskState {
    return { ...this.state, budget: { ...this.budget }, elapsedMs: this.previousElapsed + Date.now() - this.runStartedAt,
      openIssueIds: [...this.state.openIssueIds], issues: this.state.issues.map((i) => ({ ...i })),
      plan: [...this.state.plan], history: this.state.history.map((h) => ({ ...h, issueIds: [...h.issueIds] })) };
  }
  save(): void {
    this.checkpoint.task = this.snapshot();
    // 回调拿纯数据副本，后续修改不能悄悄改掉已保存的 checkpoint。
    this.options.onCheckpoint?.(JSON.parse(JSON.stringify(this.checkpoint)));
    this.options.onTaskState?.(this.snapshot());
  }
  progress(value: GenerationProgress, listener?: ProgressListener): void {
    this.state.stage = value.stage;
    this.save();
    listener?.({ ...value, task: this.snapshot() });
  }
  consume(): void {
    if (this.state.runCalls >= this.budget.maxCalls || Date.now() - this.runStartedAt >= this.budget.maxDurationMs)
      throw new ActionTaskBudgetError('动作任务已达到调用预算或时间预算，检查点已保存，可继续任务');
    this.state.calls++;
    this.state.runCalls++;
    this.save();
  }
  async invoke(request: StructuredRequest, prompt: string, input: unknown, signal?: AbortSignal): Promise<string> {
    cancelled(signal);
    const text = JSON.stringify(input);
    const key = ActionTaskRuntime.fingerprint([prompt, text]);
    if (this.checkpoint.lastResponse?.key === key) return this.checkpoint.lastResponse.text;
    this.consume();
    cancelled(signal);
    const controller = new AbortController();
    const relay = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', relay, { once: true });
    const remaining = Math.max(1, this.budget.maxDurationMs - (Date.now() - this.runStartedAt));
    const timer = setTimeout(() => controller.abort(new ActionTaskBudgetError('动作任务时间预算耗尽')), remaining);
    let rejectAborted: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAborted = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', rejectAborted, { once: true });
      });
      const raw = await Promise.race([request(prompt, text, controller.signal, {
        task: { taskId: this.state.taskId, versionId: this.state.currentVersionId, stage: this.state.stage },
        onReasoningSummary: (summary) => {
          if (!signal?.aborted && !controller.signal.aborted) this.options.onReasoningSummary?.(summary);
        },
      }), aborted]);
      cancelled(signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      this.checkpoint.lastResponse = { key, text: raw };
      this.save();
      return raw;
    } catch (error) {
      cancelled(signal);
      if (controller.signal.reason instanceof ActionTaskBudgetError) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
      if (rejectAborted) controller.signal.removeEventListener('abort', rejectAborted);
    }
  }
  discardResponse(): void { delete this.checkpoint.lastResponse; }
  summary(text: string): void {
    const summary = text.trim().slice(0, 2000);
    if (!summary) return;
    this.state.lastSummary = summary;
    this.state.history.push({ versionId: this.state.currentVersionId, summary, issueIds: [...this.state.openIssueIds] });
    this.state.history = this.state.history.slice(-24);
    this.options.onReasoningSummary?.(summary);
    this.save();
  }
  completeReply(): void {
    this.state.status = 'completed';
    this.state.lastSummary = '调整答复已生成，等待工作区保存';
    this.save();
  }
  setPlan(plans: Array<{ label: string; description: string }>): void {
    this.state.plan = ['分析模型联合曲线', ...plans.map((plan) => '编排：' + plan.label + '（' + plan.description + '）'),
      '检查执行约束与表现建议', '按问题修订，保留最佳版本'];
    this.save();
  }
  candidate(actions: ActionDefinition[]): void {
    const current = this.checkpoint.composition?.draft;
    if (JSON.stringify(current) !== JSON.stringify(actions) || this.state.currentVersionId === 'v0') {
      this.state.revision++;
      this.state.currentVersionId = 'v' + this.state.revision;
    }
    this.checkpoint.composition ??= { version: 'reaction-plan-v1', completed: {} };
    this.checkpoint.composition.draft = actions;
    this.save();
  }
  identify(issues: QualityIssue[], previous: QualityIssue[]): QualityIssue[] {
    const used = new Set<string>();
    let next = 1;
    return issues.map((issue) => {
      // 旧 issueId 必须指向同一动作/规则。无 ID 时按同动作/规则匹配。
      const old = previous.find((p) => p.issueId && !used.has(p.issueId)
        && p.actionId === issue.actionId && p.code === issue.code
        && (!issue.issueId || p.issueId === issue.issueId));
      let id = old?.issueId;
      if (!id) {
        do { id = 'issue-' + this.state.revision + '-' + next++; } while (used.has(id));
      }
      used.add(id);
      return { ...issue, issueId: id };
    });
  }
  observed(issues: QualityIssue[], improved: boolean, summary: string): void {
    this.state.issues = issues;
    this.state.openIssueIds = issues.map((i) => i.issueId!);
    this.state.lastSummary = summary;
    this.state.noProgressCount = improved ? 0 : this.state.noProgressCount + 1;
    if (improved) this.state.bestVersionId = this.state.currentVersionId;
    this.state.history.push({ versionId: this.state.currentVersionId, summary, issueIds: [...this.state.openIssueIds] });
    this.state.history = this.state.history.slice(-24);
    this.save();
  }
  finish(best: NonNullable<ReviewCheckpoint['best']>, reason?: GenerationTaskState['stopReason']): void {
    this.state.status = 'completed';
    this.state.stopReason = reason;
    this.state.currentVersionId = best.versionId;
    this.state.bestVersionId = best.versionId;
    this.state.issues = best.issues;
    this.state.openIssueIds = best.issues.map((i) => i.issueId!);
    this.checkpoint.composition!.draft = best.actions;
    this.state.lastSummary = (reason === 'no-progress' ? '停止无进展修订' : reason === 'budget' ? '预算已用完' : '检查完成')
      + '；选择最佳版本 ' + best.versionId + '，剩余 ' + best.issues.length + ' 条建议';
    this.save();
  }
  fail(error: unknown, signal?: AbortSignal): void {
    this.state.status = signal?.aborted || error instanceof ActionTaskBudgetError ? 'paused' : 'failed';
    this.state.stopReason = signal?.aborted ? 'cancelled' : error instanceof ActionTaskBudgetError ? 'budget' : 'error';
    this.state.lastSummary = (error instanceof Error ? error.message : String(error)) + '；已保留分析、草稿和最佳版本';
    this.save();
  }
}

/** LlmService 子域：仅编排生成任务；存储、UI、IPC 仍由配置工作区负责。 */
export class ActionCatalogService {
  private readonly request: StructuredRequest;
  constructor(request: StructuredRequest) { this.request = request; }

  async generate(sources: ActionSourceData, signal?: AbortSignal,
    onProgress?: ProgressListener, options: GenerationOptions = {}): Promise<ActionDefinition[]> {
    const runtime = new ActionTaskRuntime(options);
    try {
      const progress = (value: GenerationProgress): void => runtime.progress(value, onProgress);
      const contexts = this.contexts(sources);
      const candidates: ActionDefinition[] = [];
      const origins = new WeakMap<ActionDefinition, string[]>();
      const batches = runtime.checkpoint.batches;
      runtime.save();
      let reused = 0;
      for (let i = 0; i < contexts.length; i++) {
        cancelled(signal);
        progress({ stage: 'analyzing', completed: i, total: contexts.length, reused });
        const key = String(i);
        const cached = batches[key];
        if (cached) reused++;
        const actions = cached ? validateActions(cached, sources) : (await this.askActions(sources,
          `${ACTION_CATALOG_PROMPT}\n分析当前联合窗口，输出 {"actions":[...]}，最多6个有证据的完整对话反应候选。保留主姿态及辅助部位的相对时序。不要限制为1~4个参数，不要将每个窗口机械生成一个动作。没有合适证据时允许空数组。`,
          { sources: contexts[i], parameters: sources.parameters, constraints: options.constraints }, signal, progress, runtime, false, options.onReasoningSummary)).actions!;
        candidates.push(...actions);
        actions.forEach((action) => origins.set(action, contexts[i].windows.map((clip) => clip.id)));
        batches[key] = actions;
        cancelled(signal);
        runtime.save();
        progress({ stage: 'analyzing', completed: i + 1, total: contexts.length, reused });
      }
      if (!candidates.length) throw new Error('未从联合曲线中识别到对话反应');
      // 不以候选数量变少判断收敛：多参数动画变大也可能是正确的编排结果。
      // 大目录先用语义摘要确定有限计划，再逐个生成，工作量不依赖LLM是否主动压缩数量。
      const saved = runtime.checkpoint.composition;
      const composition: CompositionCheckpoint = saved?.version === 'reaction-plan-v1'
        ? { ...saved, completed: { ...saved.completed } } : { version: 'reaction-plan-v1', completed: {} };
      runtime.checkpoint.composition = composition;
      const checkpoint = () => runtime.save();
      let next: ActionDefinition[];
      if (composition.draft) next = validateActions(composition.draft, sources);
      else if (!composition.plans && this.pack(candidates).length === 1) {
        progress({ stage: 'composing', completed: 0, total: 1 });
        const sourceIds = new Set(candidates.flatMap((action) => origins.get(action) ?? []));
        const evidence = this.relatedEvidence(contexts, candidates, sourceIds);
        const result = await this.askActions(sources, `${ACTION_CATALOG_PROMPT}\n彻底重建动作表。按对话用途编排完整反应，最多12个；不要求数量少于候选。输出 {"actions":[...]}，禁止空表。`,
          { candidates, evidence, parameters: sources.parameters, constraints: options.constraints }, signal, progress, runtime, false, options.onReasoningSummary);
        if (!result.actions?.length || result.actions.length > 12) {
          runtime.discardResponse();
          throw new Error('组合整理必须返回1至12个动作');
        }
        next = result.actions;
        next.forEach((action) => origins.set(action, [...sourceIds]));
        runtime.candidate(next);
      } else {
        progress({ stage: 'planning', completed: 0, total: 1 });
        if (!composition.plans) {
          let problem = '';
          let attempt = 0;
          let previousPlanRaw = '';
          while (true) {
            const result = await this.json(`${ACTION_CATALOG_PROMPT}\n当前只规划语义目录，不生成关键帧。输出 {"plans":[{"id":"稳定ID","label":"反应名称","description":"使用场景、主姿态与节奏","candidateIndexes":[0,1]}]}。全表1至12项，每项引用1至3个真实候选下标。以完整反应覆盖不同对话场景，避免同义重复。候选下标可跨反应复用，不要求逐项保留所有候选。`,
              { candidates: describeCandidates(candidates), validationError: problem || undefined }, signal, runtime, options.onReasoningSummary);
            try { composition.plans = parseReactionPlans(result.plans, candidates.length); break; }
            catch (error) {
              problem = error instanceof Error ? error.message : String(error);
              const raw = JSON.stringify(result);
              if (raw === previousPlanRaw) attempt += 1; else attempt = 0;
              previousPlanRaw = raw;
              runtime.discardResponse();
              runtime.save();
              if (attempt >= runtime.budget.maxNoProgress) throw new Error(`编排计划校验失败：${problem}`);
            }
          }
          checkpoint();
        }
        const plans = parseReactionPlans(composition.plans, candidates.length);
        runtime.setPlan(plans);
        next = [];
        for (let i = 0; i < plans.length; i++) {
          cancelled(signal);
          const plan = plans[i];
          const sourceCandidates = plan.candidateIndexes.map((index) => candidates[index]);
          const sourceIds = new Set(sourceCandidates.flatMap((action) => origins.get(action) ?? []));
          progress({ stage: 'composing', completed: i, total: plans.length,
            reused: plans.slice(0, i).filter((p) => saved?.completed[p.id]).length });
          let action = composition.completed[plan.id];
          if (action) action = validateActions([action], sources)[0];
          else {
            const reply = await this.askActions(sources, `${ACTION_CATALOG_PROMPT}\n只生成计划中的一个完整组合反应，输出 {"actions":[一个动作]}。动作id必须等于plan.id；根据计划和候选联合曲线协调参数，不能仅改名返回单部位零件。`,
              { plan, candidates: sourceCandidates, evidence: this.relatedEvidence(contexts, sourceCandidates, sourceIds),
                parameters: sources.parameters, constraints: options.constraints }, signal, progress, runtime, false, options.onReasoningSummary);
            if (reply.actions?.length !== 1 || reply.actions[0].id !== plan.id) {
              runtime.discardResponse();
              throw new Error(`组合反应 ${plan.id} 返回了错误的ID或数量，已保留完成进度`);
            }
            action = reply.actions[0];
            composition.completed[plan.id] = action;
            checkpoint();
          }
          if (action.id !== plan.id) throw new Error('已缓存的组合反应与计划不匹配');
          origins.set(action, [...sourceIds]);
          next.push(action);
        }
        runtime.candidate(next);
      }
      cancelled(signal);
      if (!next.length || next.length > 12) throw new Error('组合整理必须返回1至12个动作');
      runtime.candidate(next);
      return await this.review(sources, next, contexts, signal, progress, options, runtime, undefined, origins);
    } catch (error) { runtime.fail(error, signal); throw error; }
  }

  async refine(input: ActionCatalogRefinement, signal?: AbortSignal,
    onProgress?: ProgressListener, options: GenerationOptions = {}): Promise<ActionCatalogReply> {
    const runtime = new ActionTaskRuntime(options);
    try {
      const progress = (value: GenerationProgress): void => runtime.progress(value, onProgress);
      runtime.save();
      // 不再裁掉引用动作以外的部位。完整关联窗口允许为脸红补充头身/视线的真实证据。
      const contexts = this.contexts(input.sources);
      const evidence = this.relatedEvidence(contexts, input.actions.filter((a) => input.referencedIds.includes(a.id)));
      const reply = runtime.checkpoint.refinement ?? await this.askActions(input.sources, `${ACTION_CATALOG_PROMPT}\n根据用户反馈微调，输出 {"message":"答复","actions":[完整新动作表]}。只回答问题时省略actions，删除全部时返回[]。保留未要求修改的动作及ID。可增加相关部位，evidence是完整联合窗口；evidenceCoverage注明是否仅为相关摘选，不能认为未展示的能力不存在。`,
        { parameters: input.sources.parameters, evidence, evidenceCoverage: { selected: evidence.windows.length,
          total: contexts.reduce((n, c) => n + c.windows.length, 0) }, constraints: options.constraints,
        actions: input.actions, referencedIds: input.referencedIds, history: input.history, instruction: input.instruction }, signal, progress, runtime, true, options.onReasoningSummary);
      runtime.checkpoint.refinement = reply;
      runtime.save();
      if (!reply.actions?.length) { runtime.completeReply(); return reply; }
      const draft = runtime.checkpoint.composition?.draft ?? reply.actions;
      runtime.candidate(draft);
      const original = new Map(input.actions.map((a) => [a.id, JSON.stringify(a)]));
      const changed = new Set(draft.filter((a) => original.get(a.id) !== JSON.stringify(a)).map((a) => a.id));
      return { ...reply, actions: await this.review(input.sources, draft, contexts, signal, progress, options, runtime, changed) };
    } catch (error) { runtime.fail(error, signal); throw error; }
  }

  private contexts(sources: ActionSourceData): SourceContext[] {
    if (!sources.motions.length || !sources.parameters.length) throw new Error('模型没有可分析的参数曲线');
    const contexts = sourceContexts(sources);
    if (!contexts.length) throw new Error('模型没有可分析的联合窗口');
    return contexts;
  }

  private pack(actions: ActionDefinition[]): ActionDefinition[][] {
    const groups: ActionDefinition[][] = [];
    let group: ActionDefinition[] = [];
    for (const action of actions) {
      if (JSON.stringify(action).length > 40000) throw new Error(`动作 ${action.id} 过大，无法自动审查`);
      if (group.length && JSON.stringify([...group, action]).length > 40000) { groups.push(group); group = []; }
      group.push(action);
    }
    if (group.length) groups.push(group);
    return groups;
  }

  private relatedEvidence(contexts: SourceContext[], actions: ActionDefinition[], preferred = new Set<string>()): SourceContext {
    const ids = new Set(actions.flatMap((a) => a.tracks.map((t) => t.parameterId)));
    const score = (c: SourceContext['windows'][number]) => c.curves.filter((t) => ids.has(t.parameterId)).length;
    const ranked = contexts.flatMap((c) => c.windows).sort((a, b) =>
      Number(preferred.has(b.id)) - Number(preferred.has(a.id)) || score(b) - score(a));
    const windows: SourceContext['windows'] = [];
    for (const window of ranked) {
      if (windows.length && JSON.stringify({ windows: [...windows, window] }).length > 60000) continue;
      windows.push(window);
      if (windows.length === 4) break;
    }
    return { windows };
  }

  private async review(sources: ActionSourceData, draft: ActionDefinition[], contexts: SourceContext[],
    signal: AbortSignal | undefined, progress: ProgressListener | undefined, options: GenerationOptions,
    runtime: ActionTaskRuntime, editable = new Set(draft.map((a) => a.id)),
    origins = new WeakMap<ActionDefinition, string[]>()): Promise<ActionDefinition[]> {
    let actions = draft;
    const review: ReviewCheckpoint = runtime.checkpoint.review ?? {
      round: 0, previousIssues: [], reviewIds: [...editable], completedIds: [], issues: [], seen: [],
    };
    runtime.checkpoint.review = review;
    const finish = (reason?: GenerationTaskState['stopReason']): ActionDefinition[] => {
      const best = review.best;
      // 最佳候选也必须重新通过当前模型的执行约束，不能用旧模型的通过状态绕过保护。
      const errors = best ? inspectActions(validateActions(best.actions, sources), sources, options.constraints)
        .filter((i) => i.severity === 'error') : [];
      if (!best || errors.length || best.issues.some((i) => i.severity === 'error'))
        throw new Error('动作执行约束仍未满足，已保留修订草稿：'
          + (errors.length ? errors : review.issues).map((i) => i.actionId + ': ' + i.message).join('；'));
      runtime.finish(best, reason);
      options.onReviewReport?.({ status: best.issues.length ? 'needs-preview' : 'ready', rounds: review.round,
        issues: best.issues, task: runtime.snapshot(), stopReason: reason, revisionSummary: runtime.snapshot().lastSummary });
      return best.actions;
    };
    try {
      while (true) {
        cancelled(signal);
        progress?.({ stage: 'checking', completed: 0, total: 1, round: review.round });
        const fingerprint = ActionTaskRuntime.fingerprint(actions);
        if (!review.evaluated) {
          if (review.fingerprint !== fingerprint) {
            review.fingerprint = fingerprint;
            review.completedIds = [];
            review.issues = [];
          }
          const checks = inspectActions(actions, sources, options.constraints);
          const groups = this.pack(actions.filter((a) => review.reviewIds.includes(a.id) && !review.completedIds.includes(a.id)));
          for (let i = 0; i < groups.length; i++) {
            progress?.({ stage: 'reviewing', completed: i, total: groups.length, round: review.round });
            const group = groups[i];
            const evidence = this.relatedEvidence(contexts, group, new Set(group.flatMap((a) => origins.get(a) ?? [])));
            const raw = await this.json(ACTION_CATALOG_PROMPT + '\n' + ACTION_RUNTIME_CONTRACT
              + '\n当前任务是审查，不生成动作。输出 {"summary":"本步结论", "issues":[{"issueId":"旧问题的稳定ID，首次可省略","actionId":"建议调整ID","message":"具体问题与修订方向"}]}。无必要调整时 issues 为空。'
              + '只评价 actions 中的动作。后续以 previousIssues 为固定目标，保留未解决问题的 issueId，移除已解决问题；不要另起风格要求。'
              + '这是参数证据上的表现建议，不是视觉验收。不要为了找问题而增加新要求，不通过反复缩小幅度追求审查通过。',
              { actions: group, catalog: actions.map(({ id, label, description }) => ({ id, label, description })),
                previousIssues: review.previousIssues.filter((issue) => group.some((a) => a.id === issue.actionId)),
                checks: checks.filter((c) => group.some((a) => a.id === c.actionId)),
                evidence, evidenceCoverage: { selected: evidence.windows.length,
                  total: contexts.reduce((n, c) => n + c.windows.length, 0) },
                parameters: sources.parameters, constraints: options.constraints }, signal, runtime, options.onReasoningSummary);
            if (!Array.isArray(raw.issues) || raw.issues.length > 64) {
              runtime.discardResponse();
              throw new Error('动作审查结果无效，已保留草稿');
            }
            const batchIssues: QualityIssue[] = [];
            for (const value of raw.issues) {
              if (!value || typeof value !== 'object') {
                runtime.discardResponse();
                throw new Error('动作审查引用无效');
              }
              const issue = value as Record<string, unknown>;
              if (typeof issue.message !== 'string' || !issue.message.trim()
                || typeof issue.actionId !== 'string' || !group.some((a) => a.id === issue.actionId)) {
                runtime.discardResponse();
                throw new Error('动作审查引用无效，已保留草稿');
              }
              if (typeof issue.issueId === 'string' && review.previousIssues.length
                && !review.previousIssues.some((p) => p.issueId === issue.issueId && p.actionId === issue.actionId)) {
                runtime.discardResponse();
                throw new Error('动作审查问题ID不匹配，已保留草稿');
              }
              batchIssues.push({ actionId: issue.actionId, message: issue.message.slice(0, 4000),
                code: 'review', severity: 'warning', issueId: typeof issue.issueId === 'string' ? issue.issueId : undefined });
            }
            review.issues.push(...batchIssues);
            review.completedIds.push(...group.map((a) => a.id));
            runtime.save(); // 逐审查批次落盘，不重新审查已经通过的分组。
          }
          review.issues = runtime.identify([...checks.filter((i) => i.severity === 'error'), ...review.issues], review.previousIssues);
          const score = review.issues.reduce((n, i) => n + (i.severity === 'error' ? 1000 : 1), 0);
          const improved = !review.best || score < review.best.score;
          if (improved) review.best = { actions, versionId: runtime.snapshot().currentVersionId, score,
            issues: review.issues.map((i) => ({ ...i })) };
          runtime.observed(review.issues, improved,
            '本版 ' + review.issues.length + ' 个待处理问题；'
              + (improved ? '优于此前候选，更新最佳版本' : '未减少问题，保留此前最佳版本'));
          review.evaluated = true;
          review.repairIds = [...new Set(review.issues.map((i) => i.actionId))];
          runtime.save();
        }
        if (!review.issues.length) return finish();
        const trajectory = ActionTaskRuntime.fingerprint(actions.map(({ id, tracks, durationMs, enterMs, returnMs }) =>
          ({ id, tracks: [...tracks].sort((a, b) => a.parameterId.localeCompare(b.parameterId)), durationMs, enterMs, returnMs })));
        if (runtime.snapshot().noProgressCount >= runtime.budget.maxNoProgress
          || (review.round > 0 && review.seen.includes(trajectory) && !review.repairStarted))
          return finish('no-progress');
        if (!review.repairStarted) {
          review.seen.push(trajectory);
          review.seen = review.seen.slice(-24);
          review.repairStarted = true;
          runtime.save();
        }
        const repairs = this.pack(actions.filter((a) => review.repairIds?.includes(a.id)));
        for (let i = 0; i < repairs.length; i++) {
          progress?.({ stage: 'repairing', completed: i, total: repairs.length, round: review.round + 1 });
          const subset = repairs[i];
          const evidence = this.relatedEvidence(contexts, subset, new Set(subset.flatMap((a) => origins.get(a) ?? [])));
          const reply = await this.askActions(sources, ACTION_CATALOG_PROMPT
            + '\n只修订给定actions，保持ID及数量；返回 {"summary":"具体改了哪些轨迹及对应issueId","actions":[修订后的这些动作]}。'
            + '只处理本轮 issues，优先修复 error；保留动作核心语义、组合和可见性，不统一放大或反复减小幅度。',
            { actions: subset, issues: review.issues.filter((issue) => subset.some((a) => a.id === issue.actionId)),
              evidence, evidenceCoverage: { selected: evidence.windows.length,
                total: contexts.reduce((n, c) => n + c.windows.length, 0) },
              parameters: sources.parameters, constraints: options.constraints }, signal, progress, runtime, false, options.onReasoningSummary);
          if (reply.actions?.length !== subset.length || reply.actions.some((a) => !subset.some((old) => old.id === a.id))) {
            runtime.discardResponse();
            throw new Error('自动修订改变了未授权的动作范围，已保留草稿');
          }
          const replacements = new Map(reply.actions.map((a) => [a.id, a]));
          reply.actions.forEach((a) => origins.set(a, origins.get(subset.find((old) => old.id === a.id)!) ?? []));
          actions = actions.map((a) => replacements.get(a.id) ?? a);
          review.repairIds = review.repairIds!.filter((id) => !replacements.has(id));
          runtime.candidate(actions); // 每个修订批次的实际轨迹和版本一起保存。
        }
        review.previousIssues = review.issues;
        review.reviewIds = [...new Set(review.issues.map((i) => i.actionId))];
        review.round++;
        review.evaluated = false;
        review.repairStarted = false;
        review.fingerprint = undefined;
        runtime.save();
      }
    } catch (error) {
      if (error instanceof ActionTaskBudgetError && review.best && !review.best.issues.some((i) => i.severity === 'error'))
        return finish('budget');
      throw error;
    }
  }

  private async json(prompt: string, input: unknown, signal?: AbortSignal, runtime?: ActionTaskRuntime,
    onReasoningSummary?: (text: string) => void): Promise<Record<string, unknown>> {
    cancelled(signal);
    const raw = runtime ? await runtime.invoke(this.request, prompt, input, signal)
      : await this.request(prompt, JSON.stringify(input), signal, { onReasoningSummary });
    cancelled(signal); // 即使提供商忽略abort，也不能消费迟到结果或继续下一轮。
    try {
      const result = this.decode(raw);
      if (typeof result.summary === 'string') {
        if (runtime) runtime.summary(result.summary); else onReasoningSummary?.(result.summary.slice(0, 2000));
      }
      return result;
    } catch (error) {
      runtime?.discardResponse();
      runtime?.save();
      throw error;
    }
  }

  private decode(raw: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('LLM 返回格式无效');
    return parsed as Record<string, unknown>;
  }

  private async askActions(sources: ActionSourceData, prompt: string, input: unknown, signal?: AbortSignal,
    progress?: ProgressListener, runtime?: ActionTaskRuntime, allowMessage = false,
    onReasoningSummary?: (text: string) => void): Promise<ActionCatalogReply> {
    let previous: unknown;
    let problem = '';
    let attempt = 0;
    let previousRaw = '';
    let repairing = false;
    while (true) {
      // 网络/鉴权错误直接退出；仅已收到的结构错误做有限修订。
      cancelled(signal);
      const body = repairing ? { original: input, previous, validationError: problem,
        instruction: '修正结构错误，返回完整合法结果' } : input;
      const fullPrompt = prompt + '\n' + ACTION_RUNTIME_CONTRACT
        + '\n可额外返回 summary，简要说明本步结论和实际修改，不输出内部思考过程。';
      const raw = runtime ? await runtime.invoke(this.request, fullPrompt, body, signal)
        : await this.request(fullPrompt, JSON.stringify(body), signal, { onReasoningSummary });
      cancelled(signal);
      try {
        const record = this.decode(raw);
        const actions = 'actions' in record ? validateActions(record.actions, sources) : undefined;
        const message = typeof record.message === 'string' ? record.message.trim() : undefined;
        if (!actions && !(allowMessage && message)) throw new Error('LLM 未返回动作表');
        if (typeof record.summary === 'string') {
          if (runtime) runtime.summary(record.summary); else onReasoningSummary?.(record.summary.slice(0, 2000));
        }
        return { actions, message };
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
        if (raw === previousRaw) attempt += 1; else attempt = 0;
        previousRaw = raw;
        repairing = true;
        runtime?.discardResponse();
        runtime?.save();
        if (attempt >= (runtime?.budget.maxNoProgress ?? DEFAULT_BUDGET.maxNoProgress)) throw new Error(`动作结构修订未取得进展：${problem}`);
        previous = raw.slice(0, 120000);
        progress?.({ stage: 'repairing', completed: attempt, total: runtime?.budget.maxNoProgress ?? DEFAULT_BUDGET.maxNoProgress, round: attempt + 1 });
      }
    }
  }
}
