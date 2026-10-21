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
}

export interface ActionSettingsCallbacks {
  onGenerate: () => Promise<void>;
  onCancel: () => void;
  onSelect: (id: string) => void;
  onDraftChange: (value: string) => void;
  onPreview: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onUpdateMetadata: (id: string, label: string, description: string) => Promise<boolean>;
  onSubmit: () => Promise<void>;
  onClearChat: () => void;
}
