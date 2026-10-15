import type { ActionCategory } from '../../../../../../../shared/actionCatalog.js';
export type { ActionCategory, ActionDefinition, ActionTrack, ActionKeyframe } from '../../../../../../../shared/actionCatalog.js';

/** LLM 只选择动作 ID，不再直接填写 Live2D 参数。 */
export type ActionSelection = string | Array<string | string[]>;
export interface ActionIntentInput {
  actionId: ActionSelection;
}

export interface ActionCatalogEntry {
  id: string;
  label: string;
  category: ActionCategory;
  description?: string;
}

/** 程序生成的关联标识，仅供调度和诊断使用，不交给 LLM 决定。 */
export interface ActionExecutionContext {
  conversationId: string;
  requestId: string;
}

export interface ParameterCapability {
  id: string;
  description: string;
  min: number;
  max: number;
  defaultValue: number;
}

export interface ActionCapability {
  modelVersion: number;
  actions: ActionCatalogEntry[];
}

export interface ActionDispatchResult {
  ok: boolean;
  state: 'started' | 'dropped';
  reason?: 'invalid' | 'no-capability' | 'stale';
}

export interface ActionCore {
  getParameterCount?: () => number;
  getParameterId?: (index: number) => string;
  getModel?: () => { parameters: { ids: string[] } };
  getParameterMinimumValue?: (index: number) => number;
  getParameterMaximumValue?: (index: number) => number;
  getParameterDefaultValue?: (index: number) => number;
  getParameterValueById?: (id: string) => number;
  setParameterValueById?: (id: string, value: number) => void;
}

export const EMPTY_ACTION_CAPABILITY: ActionCapability = { modelVersion: 0, actions: [] };
