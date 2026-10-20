import type { ActionDefinition } from '../../../../../../../shared/actionCatalog.js';
import type { ActionCatalogMessage } from './session';

export interface ActionSettingsView {
  modelPath: string;
  actions: ActionDefinition[];
  selectedId: string | null;
  messages: ActionCatalogMessage[];
  draft: string;
  busy: boolean;
  canCancel: boolean;
  taskNotice: string | null;
  error: string | null;
  /** 本会话的推理深度，随生成/微调请求下发，不修改全局配置。 */
  reasoningEffort: PetReasoningEffort;
}

export interface ActionSettingsCallbacks {
  onGenerate: () => Promise<void>;
  onCancel: () => void;
  onSelect: (id: string) => void;
  onReasoningEffortChange: (effort: PetReasoningEffort) => void;
  onDraftChange: (value: string) => void;
  onPreview: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpdateMetadata: (id: string, label: string, description: string) => Promise<boolean>;
  onSubmit: () => Promise<void>;
  onClearChat: () => void;
}
