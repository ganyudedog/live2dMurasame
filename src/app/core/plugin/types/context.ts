import type { ComponentType, ReactNode } from 'react';
import type { Disposable } from './common';
import type { PluginHostApiMap } from './host';
import type { PluginManifest, PluginWindowKind } from './manifest';

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
