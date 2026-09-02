import { makeObservable, observable, runInAction } from 'mobx';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import type { LogEntry, LogLevel } from './compat/types';
import { nowMs } from './compat/time';
import type { ElectronService } from '../electron/ElectronService';

type LogData = Record<string, unknown>;

export class LogService {
  mirrorEnabled: boolean;
  mirrorError: string | null = null;
  mirroredCount = 0;

  private readonly bridge: ElectronService['bridge'];
  private readonly windowKind: BootstrapContext['windowKind'];
  private sequence = 0;

  constructor(electron: ElectronService, bootstrap: BootstrapContext) {
    this.bridge = electron.bridge;
    this.windowKind = bootstrap.windowKind;
    this.mirrorEnabled = Boolean(bootstrap.configSnapshot?.globalModelConfig?.debugModeEnabled);
    makeObservable(this, {
      mirrorEnabled: observable,
      mirrorError: observable,
      mirroredCount: observable,
    });
  }

  setMirrorEnabled(enabled: boolean): void {
    runInAction(() => {
      this.mirrorEnabled = enabled;
    });
  }

  debug(namespace: string, event: string, data?: LogData, message?: string): void {
    this.write('debug', namespace, event, data, message);
  }

  info(namespace: string, event: string, data?: LogData, message?: string): void {
    this.write('info', namespace, event, data, message);
  }

  warn(namespace: string, event: string, data?: LogData, message?: string): void {
    this.write('warn', namespace, event, data, message);
  }

  error(namespace: string, event: string, data?: LogData, message?: string): void {
    this.write('error', namespace, event, data, message);
  }

  private write(level: LogLevel, namespace: string, event: string, data?: LogData, message?: string): void {
    const entry: LogEntry = {
      t: nowMs(),
      level,
      ns: namespace,
      event,
      msg: message,
      data: sanitizeRecord(data),
    };
    emitConsole(entry);
    if (!this.mirrorEnabled && level !== 'warn' && level !== 'error') return;

    try {
      this.sequence += 1;
      this.bridge.mirrorLog({
        kind: 'rendererLog',
        profile: 'renderer',
        level,
        renderer: {
          t: entry.t,
          seq: this.sequence,
          ns: namespace,
          event,
          msg: message,
          windowKind: this.windowKind,
          data: entry.data,
        },
      });
      runInAction(() => {
        this.mirrorError = null;
        this.mirroredCount += 1;
      });
    } catch (error) {
      runInAction(() => {
        this.mirrorError = String(error instanceof Error ? error.message : error);
      });
    }
  }
}

const sanitizeRecord = (value?: LogData): LogData | undefined => {
  if (!value) return undefined;
  const output: LogData = {};
  for (const [key, item] of Object.entries(value).slice(0, 32)) {
    if (/api.?key|token|secret|password/i.test(key)) {
      output[key] = '[redacted]';
    } else if (item == null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      output[key] = typeof item === 'string' ? item.slice(0, 1000) : item;
    } else if (Array.isArray(item)) {
      output[key] = item.slice(0, 20).filter((entry) => entry == null || ['string', 'number', 'boolean'].includes(typeof entry));
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
};

const emitConsole = (entry: LogEntry): void => {
  if (entry.level === 'error') console.error(entry);
  else if (entry.level === 'warn') console.warn(entry);
  else if (entry.level === 'debug') console.debug(entry);
  else console.info(entry);
};
