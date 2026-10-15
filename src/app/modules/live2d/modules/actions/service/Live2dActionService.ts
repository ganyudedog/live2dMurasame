import { parseActionCatalog } from '../../../../../../../shared/actionCatalog.js';
import { detectActionCapability, readModelParameters } from '../domain/capability';
import { normalizeActionIntent } from '../domain/normalize';
import { ActionExecutor } from '../infrastructure/ActionExecutor';
import { ActionDiagnostics, type ActionDiagnosticTrace } from '../infrastructure/ActionDiagnostics';
import { MOUSE_RESUME_MS } from '../domain/parameters';
import { parseActionIntent } from '../domain/schema';
import type { ActionCapability, ActionCore, ActionDefinition, ActionDispatchResult, ActionExecutionContext, ActionSelection, ActionTrack, ParameterCapability } from '../domain/types';
import type { LogService } from '@app/shared/logging/LogService';
import { SentenceActionSchedulerService } from './SentenceActionSchedulerService';

export class Live2dActionService {
  /** 逐句调度属于动作能力，由本服务唯一创建并管理生命周期。 */
  readonly sentenceActionScheduler: SentenceActionSchedulerService;
  private modelVersion = 0;
  private core: ActionCore | null = null;
  private parameters: ParameterCapability[] = [];
  private readonly displayed = new Map<string, number>();
  private readonly remote = new ActionExecutor();
  private capability: ActionCapability = { modelVersion: 0, actions: [] };
  private actionCatalog: ActionDefinition[] = [];
  private mouthLevel: number | null = null;
  private mouthValue = 0;
  private lastVoiceAt: number | null = null;
  private lastTick = 0;
  private upwardLimits: { eye: (value: number) => number; head: (value: number) => number } | null = null;
  private readonly diagnostics: ActionDiagnostics;
  private rendered = false;
  private runtimeFailureLogged = false;
  private runtimeBound = false;
  private mouseResumeAt: number | null = 0;
  // 逐帧只累积摘要，阶段事件追加到共享 trace，整句结束时输出一次。
  private execution: {
    context?: ActionExecutionContext;
    actionId: ActionSelection;
    groups: ActionDefinition[][];
    groupIndex: number;
    groupStartedAt: number;
    targets: Record<string, number>;
    timing: Pick<ActionDefinition, 'enterMs' | 'durationMs' | 'returnMs'>;
    startedAt: number;
    releaseAt: number;
    releaseReason: string;
    frames: number;
    firstFrameAt: number | null;
    timelineObserved: boolean;
    lastValues: Record<string, number>;
    observedRanges: Record<string, { min: number; max: number }>;
    diagnostic: ActionDiagnosticTrace;
    mouth: { frames: number; levelSum: number; peakLevel: number; peakOpen: number };
  } | null = null;

  constructor(log?: LogService) {
    this.diagnostics = new ActionDiagnostics(log);
    this.sentenceActionScheduler = new SentenceActionSchedulerService({
      getCapability: () => ({ modelVersion: this.modelVersion }),
      dispatch: (intent, modelVersion, context, diagnostic) => this.dispatch(intent, modelVersion, context, diagnostic),
      release: (reason) => this.release(reason),
    }, log);
  }

  attach(core: ActionCore | null): void {
    const hadModel = this.core !== null;
    this.finishExecution(core ? 'model-changed' : 'model-detached');
    // 模型资源切换时同步清理子服务，旧句子的动作与共享 trace 不留给新模型。
    this.sentenceActionScheduler.clear(core ? 'model-changed' : 'model-detached');
    this.modelVersion++;
    this.remote.clear();
    this.core = core;
    this.parameters = core ? readModelParameters(core) : [];
    this.capability = detectActionCapability(this.parameters, this.modelVersion, this.actionCatalog);
    this.displayed.clear();
    this.parameters.forEach((parameter) => this.displayed.set(parameter.id, parameter.defaultValue));
    this.mouthLevel = null;
    this.lastVoiceAt = null;
    this.mouthValue = this.displayed.get('ParamMouthOpenY') ?? 0;
    this.lastTick = 0;
    this.upwardLimits = null;
    this.rendered = false;
    this.runtimeFailureLogged = false;
    this.runtimeBound = false;
    this.mouseResumeAt = performance.now() - MOUSE_RESUME_MS;
    if (core || hadModel) this.diagnostics.record(core ? 'model.capability' : 'model.detached', {
      modelVersion: this.modelVersion,
      writable: typeof core?.setParameterValueById === 'function',
      actions: this.capability.actions,
      nativeRanges: this.parameters,
    });
  }

  getCapability(): ActionCapability {
    return { ...this.capability, actions: this.capability.actions.map((action) => ({ ...action })) };
  }

  setActionCatalog(actions: ActionDefinition[]): void {
    const catalog = parseActionCatalog(actions);
    if (JSON.stringify(catalog) === JSON.stringify(this.actionCatalog)) return;
    // 配置更改后旧轨迹不再继续执行，新的整表按统一契约接入。
    this.release('catalog-updated');
    this.actionCatalog = catalog;
    this.capability = detectActionCapability(this.parameters, this.modelVersion, this.actionCatalog);
  }

  setUpwardLimits(limits: typeof this.upwardLimits): void { this.upwardLimits = limits; }

  /** 远程进入、保持、回退期间整个鼠标来源暂停；回退结束后再平滑恢复原混合权重。 */
  getMouseFollowWeight(now = performance.now()): number {
    if (this.remote.isActive(now)) {
      this.mouseResumeAt = null;
      return 0;
    }
    this.mouseResumeAt ??= now;
    return Math.min(1, Math.max(0, (now - this.mouseResumeAt) / MOUSE_RESUME_MS));
  }

  dispatch(input: unknown, modelVersion = this.modelVersion, context?: ActionExecutionContext,
    sharedDiagnostic?: ActionDiagnosticTrace): ActionDispatchResult {
    const requestedActionId = parseActionIntent(input)?.actionId;
    const diagnosticData = { ...context, modelVersion, currentModelVersion: this.modelVersion, requestedActionId };
    const diagnostic = sharedDiagnostic ?? this.diagnostics.begin(diagnosticData);
    if (modelVersion !== this.modelVersion) {
      diagnostic.drop('stale', diagnosticData);
      return { ok: false, state: 'dropped', reason: 'stale' };
    }
    if (!this.core) {
      diagnostic.drop('no-capability', diagnosticData);
      return { ok: false, state: 'dropped', reason: 'no-capability' };
    }
    const plan = normalizeActionIntent(input, new Map(this.actionCatalog.map((definition) => [definition.id, definition])));
    if (!plan) {
      diagnostic.drop('invalid-or-unknown-action', diagnosticData);
      return { ok: false, state: 'dropped', reason: 'invalid' };
    }
    const writableParameters = new Map(this.parameters.map((parameter) => [parameter.id, parameter]));
    const droppedTargetIds: string[] = [];
    const clampedTargetIds: string[] = [];
    const targets: Record<string, number> = {};
    const tracks: ActionTrack[] = [];
    const conflicts: Array<{ groupIndex: number; parameterId: string; previousActionId: string; actionId: string }> = [];
    // 先校验整条计划，后续组无效也不先播放一半；语音不受动作拒绝影响。
    const groups = plan.map((group, groupIndex) => {
      const owners = new Map<string, string>();
      return group.map((action) => ({ ...action, tracks: action.tracks.flatMap((track) => {
        const parameter = writableParameters.get(track.parameterId);
        if (!parameter) { droppedTargetIds.push(track.parameterId); return []; }
        const previousActionId = owners.get(parameter.id);
        if (previousActionId) conflicts.push({ groupIndex, parameterId: parameter.id, previousActionId, actionId: action.id });
        owners.set(parameter.id, action.id);
        const keyframes = track.keyframes.map((point) => {
          const value = Math.min(parameter.max, Math.max(parameter.min, point.value));
          if (value !== point.value && !clampedTargetIds.includes(parameter.id)) clampedTargetIds.push(parameter.id);
          return { timeMs: point.timeMs, value };
        });
        const normalized = { parameterId: parameter.id, keyframes };
        tracks.push(normalized);
        targets[parameter.id] = keyframes.at(-1)!.value;
        return [normalized];
      }) }));
    });
    if (droppedTargetIds.length || !tracks.length) {
      diagnostic.drop('action-with-unavailable-parameters', { ...diagnosticData, actionId: requestedActionId, droppedTargetIds });
      return { ok: false, state: 'dropped', reason: 'no-capability' };
    }
    this.finishExecution('superseded');
    const now = performance.now();
    const timing = this.groupTiming(groups[0]);
    this.remote.start(groups, now, this.displayed);
    this.execution = {
      context, actionId: requestedActionId!, groups, groupIndex: 0, groupStartedAt: now, targets, timing, startedAt: now,
      releaseAt: now + timing.enterMs + timing.durationMs,
      releaseReason: 'timeline-complete', frames: 0, firstFrameAt: null, timelineObserved: false, lastValues: {}, observedRanges: {},
      diagnostic, mouth: { frames: 0, levelSum: 0, peakLevel: 0, peakOpen: 0 },
    };
    this.mouseResumeAt = null;
    this.runtimeFailureLogged = false;
    diagnostic.record('action.accepted', {
      ...diagnosticData, actionId: requestedActionId, groups, tracks, targets, timing, conflicts,
      conflictPolicy: 'later-action-wins-per-parameter',
      runtimeBound: this.runtimeBound, modelRendered: this.rendered, mousePolicy: 'paused-through-return',
      from: Object.fromEntries(Object.keys(targets).map((id) => [id, this.displayed.get(id)])),
      droppedTargetIds, clampedTargetIds,
    });
    if (groups.length > 1 || groups[0].length > 1) diagnostic.record('action.groupStarted', {
      groupIndex: 0, actionIds: groups[0].map(({ id }) => id), elapsedMs: 0,
    });
    return { ok: true, state: 'started' };
  }

  release(reason = 'requested'): void {
    const now = performance.now();
    const wasActive = this.remote.isActive(now);
    this.remote.release(now);
    if (this.execution && wasActive) {
      this.execution.releaseAt = Math.min(this.execution.releaseAt, now);
      this.execution.releaseReason = reason;
      this.execution.diagnostic.record('action.release', {
        ...this.execution.context, modelVersion: this.modelVersion, reason,
        cancelledGroups: Math.max(0, this.execution.groups.length - this.execution.groupIndex - 1),
        elapsedMs: Math.round(now - this.execution.startedAt), values: this.execution.lastValues,
      });
    }
  }

  runtimeAttached(attached: boolean): void {
    this.runtimeBound = attached;
  }

  reportRuntimeFailure(error: unknown): void {
    // 同一个持续渲染故障只报一次，避免高频异常淹没真正的调度记录。
    if (this.runtimeFailureLogged) return;
    this.runtimeFailureLogged = true;
    const data = {
      ...this.execution?.context, modelVersion: this.modelVersion,
      actionId: this.execution?.actionId, targets: this.execution?.targets,
    };
    if (this.execution) {
      this.execution.diagnostic.record('render.failed', data);
      this.execution.diagnostic.fail(error, data);
    } else this.diagnostics.record('render.failed', data, error);
    this.remote.clear();
    this.finishExecution('render-failed');
  }

  setAudioLevel(level: number | null): void {
    const wasAvailable = this.mouthLevel !== null;
    this.mouthLevel = level === null || !Number.isFinite(level) ? null : Math.max(0, Math.min(1, level));
    if (wasAvailable !== (this.mouthLevel !== null)) this.diagnostics.record('mouth.observation', {
      modelVersion: this.modelVersion, available: this.mouthLevel !== null,
      hasMouthParameter: this.parameters.some((parameter) => parameter.id === 'ParamMouthOpenY'),
      fallback: this.mouthLevel === null ? 'native-mouth' : undefined,
    });
    if (this.mouthLevel !== null && this.mouthLevel > 0) this.lastVoiceAt = performance.now();
  }

  tick(now = performance.now()): void {
    const core = this.core;
    if (!core) return;
    this.rendered = true;
    const dt = this.lastTick ? Math.min(100, Math.max(0, now - this.lastTick)) : 16;
    this.lastTick = now;
    const nextGroup = this.remote.advance(now, () => new Map(this.parameters.map((parameter) =>
      [parameter.id, core.getParameterValueById?.(parameter.id) ?? parameter.defaultValue])));
    if (nextGroup !== undefined && this.execution) {
      const execution = this.execution;
      execution.diagnostic.record('action.groupFinished', {
        groupIndex: execution.groupIndex, actionIds: execution.groups[execution.groupIndex].map(({ id }) => id),
        elapsedMs: Math.round(now - execution.groupStartedAt),
      });
      execution.groupIndex = nextGroup;
      execution.groupStartedAt = now;
      execution.timelineObserved = false;
      execution.timing = this.groupTiming(execution.groups[nextGroup]);
      execution.releaseAt = now + execution.timing.enterMs + execution.timing.durationMs;
      execution.diagnostic.record('action.groupStarted', {
        groupIndex: nextGroup, actionIds: execution.groups[nextGroup].map(({ id }) => id),
        elapsedMs: Math.round(now - execution.startedAt),
      });
    }
    for (const parameter of this.parameters) {
      const base = core.getParameterValueById?.(parameter.id) ?? parameter.defaultValue;
      const protectedUpward = this.upwardLimits && (parameter.id === 'ParamEyeBallY' || parameter.id === 'ParamAngleY');
      if (!this.remote.controls(parameter.id) && parameter.id !== 'ParamMouthOpenY' && !protectedUpward) {
        // 记录本地显示值供下一动作衔接，但不重写或额外限幅无关参数。
        this.displayed.set(parameter.id, base);
        continue;
      }
      // SDK 已算完 Idle、鼠标与自然运动；远程只覆盖对应参数，不停止其余本地行为。
      let value = this.remote.sample(parameter.id, base, now);
      if (parameter.id === 'ParamMouthOpenY') {
        // 分析不可用或持续静音时回到正常口型，释放过程仍保留开闭平滑。
        const silent = this.lastVoiceAt === null || (this.mouthLevel === 0 && now - this.lastVoiceAt > 180);
        const target = this.mouthLevel === null || silent ? base
          : parameter.min + (parameter.max - parameter.min) * this.mouthLevel;
        const duration = target > this.mouthValue ? 65 : 110;
        this.mouthValue += (target - this.mouthValue) * Math.min(1, dt / duration);
        value = this.mouthValue;
      }
      if (parameter.id === 'ParamEyeBallY') value = this.upwardLimits?.eye(value) ?? value;
      if (parameter.id === 'ParamAngleY') value = this.upwardLimits?.head(value) ?? value;
      value = Math.max(parameter.min, Math.min(parameter.max, value));
      core.setParameterValueById?.(parameter.id, value);
      this.displayed.set(parameter.id, value);
    }
    this.observeExecution(now);
  }

  private observeExecution(now: number): void {
    const execution = this.execution;
    if (!execution) return;
    execution.frames++;
    if (this.mouthLevel !== null) {
      execution.mouth.frames++;
      execution.mouth.levelSum += this.mouthLevel;
      execution.mouth.peakLevel = Math.max(execution.mouth.peakLevel, this.mouthLevel);
    }
    execution.mouth.peakOpen = Math.max(execution.mouth.peakOpen, this.displayed.get('ParamMouthOpenY') ?? 0);
    // 读回 core 的值，区分“执行器接受目标”和“渲染前实际写入”。不代表已经做过视觉验收。
    execution.lastValues = Object.fromEntries(Object.keys(execution.targets).map((id) =>
      [id, this.core?.getParameterValueById?.(id) ?? this.displayed.get(id) ?? 0]));
    for (const [id, value] of Object.entries(execution.lastValues)) {
      const previous = execution.observedRanges[id];
      execution.observedRanges[id] = { min: Math.min(previous?.min ?? value, value), max: Math.max(previous?.max ?? value, value) };
    }
    const data = { ...execution.context, modelVersion: this.modelVersion, actionId: execution.actionId,
      groupIndex: execution.groupIndex, targets: execution.targets,
      values: execution.lastValues, elapsedMs: Math.round(now - execution.startedAt) };
    if (execution.firstFrameAt === null) {
      execution.firstFrameAt = now;
      execution.diagnostic.record('render.firstFrame', data);
    }
    if (!execution.timelineObserved && now >= execution.groupStartedAt + execution.timing.enterMs && now < execution.releaseAt) {
      execution.timelineObserved = true;
      execution.diagnostic.record('render.timelineStarted', { ...data,
        // 不读取模型未声明的 ID；部分 Cubism 包装器会为不存在的参数创建占位值。
        eyeOpen: Object.fromEntries(this.parameters.filter((parameter) =>
          parameter.id === 'ParamEyeLOpen' || parameter.id === 'ParamEyeROpen')
          .map((parameter) => [parameter.id, this.core?.getParameterValueById?.(parameter.id)])),
      });
    }
    if (!this.remote.isActive(now)) this.finishExecution('returned', now);
  }

  /** 组包络仅用于诊断，各成员的真实时序仍由执行器独立采样。 */
  private groupTiming(group: ActionDefinition[]): Pick<ActionDefinition, 'enterMs' | 'durationMs' | 'returnMs'> {
    const enterMs = Math.min(...group.map((action) => action.enterMs));
    const releaseAt = Math.max(...group.map((action) => action.enterMs + action.durationMs));
    const endAt = Math.max(...group.map((action) => action.enterMs + action.durationMs + action.returnMs));
    return { enterMs, durationMs: releaseAt - enterMs, returnMs: endAt - releaseAt };
  }

  private finishExecution(reason: string, now = performance.now()): void {
    const execution = this.execution;
    if (!execution) return;
    if (execution.groups.length > 1 || execution.groups[0].length > 1) execution.diagnostic.record('action.groupFinished', {
      groupIndex: execution.groupIndex, actionIds: execution.groups[execution.groupIndex].map(({ id }) => id), reason,
      elapsedMs: Math.round(now - execution.groupStartedAt),
    });
    const data = {
      ...execution.context, modelVersion: this.modelVersion, actionId: execution.actionId, outcome: reason, reason, releaseReason: execution.releaseReason,
      groups: execution.groups.map((group) => group.map(({ id }) => id)), groupIndex: execution.groupIndex,
      elapsedMs: Math.round(now - execution.startedAt), frames: execution.frames,
      firstFrameDelayMs: execution.firstFrameAt === null ? null : Math.round(execution.firstFrameAt - execution.startedAt),
      timelineObserved: execution.timelineObserved, targets: execution.targets, lastValues: execution.lastValues,
      observedRanges: execution.observedRanges,
      mouth: { observedFrames: execution.mouth.frames, peakLevel: execution.mouth.peakLevel,
        meanLevel: execution.mouth.frames ? execution.mouth.levelSum / execution.mouth.frames : null,
        peakOpen: execution.mouth.peakOpen, sampleWindowMs: Math.round(now - execution.startedAt) },
    };
    execution.diagnostic.record('action.finished', data);
    execution.diagnostic.finishExecution(data, reason !== 'returned');
    this.execution = null;
  }

  dispose(): void { this.attach(null); }
}
