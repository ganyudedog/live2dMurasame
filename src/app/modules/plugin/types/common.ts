export type Disposable = () => void;

export interface RuntimeLog {
  info(namespace: string, event: string, data?: Record<string, unknown>): void;
  warn(namespace: string, event: string, data?: Record<string, unknown>): void;
  error(namespace: string, event: string, data?: Record<string, unknown>): void;
}
