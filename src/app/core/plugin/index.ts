import type { ComponentType, ReactNode } from 'react';

/** Stable public contracts for renderer plugins. Keep this entrypoint independent of service implementations. */
export type Disposable = () => void;
export type PluginHostKind = 'desktop' | 'cli';
export type PluginWindowKind = 'pet' | 'control-panel' | 'subtitle';

export type PluginPermission =
  | 'ai.conversations'
  | 'ai.models'
  | 'control-panel.navigation'
  | 'control-panel.cards'
  | 'desktop.notifications'
  | 'desktop.window'
  | 'live2d.runtime'
  | 'commands.register'
  | 'settings.storage';

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly hosts?: readonly PluginHostKind[];
  readonly permissions?: readonly PluginPermission[];
  readonly activationEvents?: readonly string[];
  readonly entry?: { readonly service?: string; readonly ui?: string };
  readonly contributes?: Record<string, unknown>;
}

export interface PluginStorage {
  get<T>(key: string, fallback?: T): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  subscribe(listener: (key: string) => void): Disposable;
}

export interface PluginLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export type InteractionPolicy =
  | { readonly mode: 'interrupt'; readonly maxConcurrent?: number; readonly maxQueued?: number }
  | { readonly mode: 'queue'; readonly maxConcurrent?: 1; readonly maxQueued?: number }
  | { readonly mode: 'concurrent'; readonly maxConcurrent?: number; readonly maxQueued?: number };

export type DisplayLanguage = 'zh' | 'en' | 'ja' | 'ko';
export type SpeakLanguage = 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto';

export interface ConversationChannelOptions {
  readonly source: string;
  readonly conversationId: string;
  readonly interaction: InteractionPolicy;
  readonly model?: string;
  readonly reasoningEffort?: string;
  /** Scene instructions supplied by the plugin; the host injects the active character persona. */
  readonly systemPrompt?: string;
  readonly displayLang?: DisplayLanguage;
  /** Omit for a text-only response. Supplying a language enables speech text generation. */
  readonly speakLang?: SpeakLanguage | null;
}

/** Logical archive identity, never a filesystem path. Omit to disable archival. */
export interface ConversationMemoryArchive {
  readonly platform: string;
  readonly scope: 'group' | 'private';
  readonly id: string;
}

export interface ConversationRequest {
  readonly sender?: { readonly id: string; readonly displayName?: string };
  readonly memoryArchive?: ConversationMemoryArchive;
  readonly text: string;
  readonly requestId?: string;
  readonly conversationId?: string;
  /** Requests with the same key supersede each other in interrupt mode. */
  readonly interactionKey?: string;
  readonly systemPrompt?: string;
  readonly displayLang?: DisplayLanguage;
  readonly speakLang?: SpeakLanguage | null;
}

export type ConversationResponseStatus = 'streaming' | 'done' | 'error' | 'cancelled';
export interface ConversationResponse {
  readonly channelId: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly text: string;
  readonly speakText?: string;
  readonly status: ConversationResponseStatus;
  readonly error?: string | null;
}

export interface ConversationRequestResult {
  readonly requestId: string;
  readonly accepted: boolean;
  readonly reason?: 'queued' | 'invalid' | 'disposed' | 'duplicate' | 'unavailable' | 'queue-full';
}

export interface ConversationChannel {
  readonly id: string;
  readonly options: ConversationChannelOptions;
  sendText(request: ConversationRequest): ConversationRequestResult;
  cancel(requestId?: string): void;
  onResponse(listener: (response: ConversationResponse) => void): Disposable;
  dispose(): void;
}

export interface AiConversationHostApi {
  openChannel(options: ConversationChannelOptions): ConversationChannel;
}

export interface AiModelCatalogHostApi {
  getModels(): readonly { readonly id: string; readonly efforts: readonly string[] }[];
  subscribe(listener: () => void): Disposable;
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

export interface DesktopNotificationsHostApi {
  showNotification(title: string, body?: string): Promise<void>;
}

export interface DesktopWindowHostApi {
  getWindowGeometry(): Promise<{
    bounds: { x: number; y: number; width: number; height: number };
    contentBounds?: { x: number; y: number; width: number; height: number };
    displayId?: number;
    scaleFactor?: number;
  } | null>;
}

export interface PluginHostApiMap {
  aiConversations: AiConversationHostApi;
  aiModels: AiModelCatalogHostApi;
  live2d: Live2dHostApi;
  controlPanel: ControlPanelHostApi;
  desktopNotifications: DesktopNotificationsHostApi;
  desktopWindow: DesktopWindowHostApi;
}

export interface UiRenderContext {
  readonly pluginId: string;
  readonly hostApi: Partial<PluginHostApiMap>;
  readonly storage: PluginStorage;
  readonly logger: PluginLogger;
}

export interface UiContribution {
  readonly id: string;
  readonly slot: string;
  readonly title: string;
  readonly order?: number;
  /** Pages get a dedicated control-panel navigation entry; cards render in their named slot. */
  readonly placement?: 'card' | 'page';
  readonly render: ComponentType<UiRenderContext> | ((context: UiRenderContext) => ReactNode);
}

export interface CommandContribution {
  readonly id: string;
  readonly title: string;
  readonly execute: (...args: unknown[]) => unknown;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly windowKind: PluginWindowKind;
  readonly host: Partial<PluginHostApiMap>;
  readonly storage: PluginStorage;
  readonly logger: PluginLogger;
  readonly subscriptions: { add(disposable: Disposable): void };
  readonly ui: { register(contribution: UiContribution): Disposable };
  readonly commands: { register(contribution: CommandContribution): Disposable };
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

export type HostApi = AiConversationHostApi | AiModelCatalogHostApi | Live2dHostApi | ControlPanelHostApi
  | DesktopNotificationsHostApi | DesktopWindowHostApi;
