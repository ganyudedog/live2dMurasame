import type { ComponentType, ReactNode } from 'react';

export type PluginHostKind = 'desktop' | 'cli';

export type Disposable = () => void;

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly hosts?: readonly PluginHostKind[];
  readonly activationEvents?: readonly string[];
  readonly entry?: {
    readonly service?: string;
    readonly ui?: string;
  };
  readonly contributes?: Record<string, unknown>;
}

export interface PluginStorage {
  get<T>(key: string, fallback?: T): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
}

export interface PluginLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface TextAiInput {
  readonly text: string;
  readonly conversationId?: string;
  readonly requestId?: string;
}

export interface TextAiResult {
  readonly requestId: string;
  readonly conversationId?: string;
  readonly accepted: boolean;
}

export interface TextAiResponse {
  readonly requestId: string;
  readonly text: string;
  readonly status: 'streaming' | 'done' | 'error';
  readonly error?: string | null;
}

export interface AiHostApi {
  sendText(input: TextAiInput): TextAiResult;
  cancel(requestId?: string): void;
  onResponse(listener: (response: TextAiResponse) => void): Disposable;
}

export interface Live2dHostApi {
  getAvailableMotions(): readonly string[];
  playMotion(group: string): void;
  interruptMotion(group: string): void;
  getModelState(): { loaded: boolean; status: string };
}

export interface ControlPanelHostApi {
  getActiveTab(): string;
  openTab(tabId: string): void;
}

export interface DesktopHostApi {
  showNotification(title: string, body?: string): Promise<void>;
  getWindowGeometry(): Promise<PetWindowGeometry | null>;
}

export type HostApi = AiHostApi | Live2dHostApi | ControlPanelHostApi | DesktopHostApi;

export interface UiRenderContext {
  readonly pluginId: string;
  readonly hostApi: Readonly<Record<string, unknown>>;
  readonly storage: PluginStorage;
  readonly logger: PluginLogger;
}

export interface UiContribution {
  readonly id: string;
  readonly slot: string;
  readonly title: string;
  readonly order?: number;
  readonly render: ComponentType<UiRenderContext> | ((context: UiRenderContext) => ReactNode);
}

export interface CommandContribution {
  readonly id: string;
  readonly title: string;
  readonly execute: (...args: unknown[]) => unknown;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly host: Readonly<Record<string, unknown>>;
  readonly storage: PluginStorage;
  readonly logger: PluginLogger;
  readonly ui: {
    register(contribution: UiContribution): Disposable;
  };
  readonly commands: {
    register(contribution: CommandContribution): Disposable;
  };
}

export interface PluginDefinition {
  readonly manifest: PluginManifest;
  readonly activate: (context: PluginContext) => void | Promise<void>;
  readonly deactivate?: () => void | Promise<void>;
}

export interface PluginPackage {
  readonly manifest: unknown;
  readonly activate: PluginDefinition['activate'];
  readonly deactivate?: PluginDefinition['deactivate'];
}
