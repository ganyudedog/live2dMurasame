export type Disposable = () => void;

export interface RuntimeLog {
  info(namespace: string, event: string, data?: Record<string, unknown>): void;
  warn(namespace: string, event: string, data?: Record<string, unknown>): void;
  error(namespace: string, event: string, data?: Record<string, unknown>): void;
  beginPluginDelivery?(pluginId: string, action: string, parent?: { traceId: string; spanId: string }): (accepted: boolean) => void;
  recordPluginRuntime?(pluginId: string, level: 'warn' | 'error', event: string, data?: Record<string, unknown>): void;
}
