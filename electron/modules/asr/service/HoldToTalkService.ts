import { normalizePushToTalk, type PushToTalkSettings } from '../../../../shared/subtitle/subtitleSettings.js';
import { createWindowsKeyState } from '../infrastructure/WindowsKeyState.js';

export interface HoldEvent {
  type: 'asr.hold';
  held: boolean;
  key: string;
  ts: number;
}

type KeyReader = (key: string) => boolean;
type KeyReaderFactory = () => KeyReader | null;

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class HoldToTalkService {
  private readonly emit: (event: HoldEvent) => void;
  private readonly log?: { error?: (scope: string, event: string, data: { message: string }) => void };
  private readonly readKeyFactory: KeyReaderFactory;
  private settings: PushToTalkSettings;
  private held = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readKey: KeyReader | null = null;

  constructor({
    emit,
    log,
    readKey = createWindowsKeyState,
  }: {
    emit: (event: HoldEvent) => void;
    log?: { error?: (scope: string, event: string, data: { message: string }) => void };
    readKey?: KeyReaderFactory;
  }) {
    this.emit = emit;
    this.log = log;
    this.settings = normalizePushToTalk();
    this.readKeyFactory = readKey;
  }

  start(settings?: Partial<PushToTalkSettings>): void {
    try { this.readKey = this.readKeyFactory(); }
    catch (error: unknown) { this.log?.error?.('asr', 'hotkey.unavailable', { message: errorMessage(error) }); }
    this.configure(settings);
  }

  configure(settings?: Partial<PushToTalkSettings>): void {
    const next = normalizePushToTalk(settings);
    if (next.key !== this.settings.key || !next.enabled) this.release();
    this.settings = next;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (next.enabled && this.readKey) this.timer = setInterval(() => this.poll(), 16);
  }

  private poll(): void {
    if (!this.readKey) return;
    try {
      const held = this.readKey(this.settings.key);
      if (held === this.held) return;
      this.held = held;
      this.emit({ type: 'asr.hold', held, key: this.settings.key, ts: Date.now() });
    } catch (error: unknown) {
      this.release();
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.log?.error?.('asr', 'hotkey.failed', { message: errorMessage(error) });
    }
  }

  private release(): void {
    if (!this.held) return;
    this.held = false;
    this.emit({ type: 'asr.hold', held: false, key: this.settings.key, ts: Date.now() });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.release();
  }
}
