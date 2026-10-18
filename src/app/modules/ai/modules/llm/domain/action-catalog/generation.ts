import type { ActionDefinition } from '../../../../../../../../shared/actionCatalog.js';

export const GENERATION_VERSION = 'composite-reactions-v1';
export interface GenerationBudget {
  /** 结构化模型调用总预算，包含分析、编排、审查和修订。 */
  maxCalls?: number;
  /** 单任务最长运行时间。 */
  maxDurationMs?: number;
  /** 连续没有改善当前最佳版本时停止。 */
  maxNoProgress?: number;
}
export interface GenerationTaskState {
  schemaVersion: 1;
  taskId: string;
  revision: number;
  currentVersionId: string;
  bestVersionId: string;
  calls: number;
  startedAt: number;
  run: number;
  runCalls: number;
  elapsedMs: number;
  budget: Required<GenerationBudget>;
  status: 'running' | 'completed' | 'paused' | 'failed';
  stopReason?: 'budget' | 'no-progress' | 'cancelled' | 'error';
  noProgressCount: number;
  openIssueIds: string[];
  lastSummary?: string;
  stage?: GenerationProgress['stage'];
  plan: string[];
  issues: QualityIssue[];
  history: Array<{ versionId: string; summary: string; issueIds: string[] }>;
}
export interface GenerationProgress {
  stage: 'analyzing' | 'planning' | 'composing' | 'checking' | 'reviewing' | 'repairing';
  completed: number;
  total: number;
  round?: number;
  reused?: number;
  task?: GenerationTaskState;
  plan?: string;
  issueIds?: string[];
  summary?: string;
}
export interface GenerationConstraints { parameterMax?: Record<string, number>; parameterMin?: Record<string, number> }
/** 检查点由工作区域缓存；LLM 子服务只接收数据和回调，不访问存储。 */
export interface ReactionPlan { id: string; label: string; description: string; candidateIndexes: number[] }
export interface CompositionCheckpoint {
  version: 'reaction-plan-v1';
  plans?: ReactionPlan[];
  completed: Record<string, ActionDefinition>;
  draft?: ActionDefinition[];
}
export interface ReviewCheckpoint {
  /** 草稿已审查部分和当前最佳版本一起保存，恢复不依赖内存中的变量。 */
  round: number;
  previousIssues: QualityIssue[];
  reviewIds: string[];
  fingerprint?: string;
  completedIds: string[];
  evaluated?: boolean;
  repairStarted?: boolean;
  repairIds?: string[];
  issues: QualityIssue[];
  best?: { versionId: string; actions: ActionDefinition[]; issues: QualityIssue[]; score: number };
  seen: string[];
}
export interface GenerationCheckpoint {
  batches: Record<string, ActionDefinition[]>;
  composition?: CompositionCheckpoint;
  task?: GenerationTaskState;
  review?: ReviewCheckpoint;
  /** 仅保存最后一个已付费步骤的答复；解析或提交中断后可复用。 */
  lastResponse?: { key: string; text: string };
  refinement?: { message?: string; actions?: ActionDefinition[] };
}
export interface GenerationOptions {
  constraints?: GenerationConstraints;
  budget?: GenerationBudget;
  checkpoint?: GenerationCheckpoint;
  onCheckpoint?: (checkpoint: GenerationCheckpoint) => void;
  onReviewReport?: (report: GenerationReviewReport) => void;
  onTaskState?: (state: GenerationTaskState) => void;
  onReasoningSummary?: (text: string) => void;
}
export type ProgressListener = (progress: GenerationProgress) => void;
export interface QualityIssue { actionId: string; code: string; message: string; severity: 'error' | 'warning'; issueId?: string }
export interface GenerationReviewReport {
  status: 'ready' | 'needs-preview';
  rounds: number;
  issues: QualityIssue[];
  task?: GenerationTaskState;
  revisionSummary?: string;
  stopReason?: GenerationTaskState['stopReason'];
}

export function checkGenerationCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('动作任务已取消');
}
