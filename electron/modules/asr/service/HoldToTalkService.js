import { normalizePushToTalk } from '../../../../shared/subtitleSettings.js';
import { createWindowsKeyState } from '../infrastructure/WindowsKeyState.js';

export class HoldToTalkService {
  constructor({ emit, log, readKey = createWindowsKeyState } = {}) {
    this.emit = emit; this.log = log; this.settings = normalizePushToTalk();
    this.held = false; this.timer = null; this.readKeyFactory = readKey;
  }
  start(settings) {
    try { this.readKey = this.readKeyFactory(); }
    catch (error) { this.log?.error('asr', 'hotkey.unavailable', { message: String(error.message) }); }
    this.configure(settings);
  }
  configure(settings) {
    const next = normalizePushToTalk(settings);
    if (next.key !== this.settings.key || !next.enabled) this.release();
    this.settings = next;
    clearInterval(this.timer); this.timer = null;
    if (next.enabled && this.readKey) this.timer = setInterval(() => this.poll(), 16);
  }
  poll() {
    try {
      const held = this.readKey(this.settings.key);
      if (held === this.held) return;
      this.held = held;
      this.emit({ type: 'asr.hold', held, key: this.settings.key, ts: Date.now() });
    } catch (error) {
      this.release(); clearInterval(this.timer); this.timer = null;
      this.log?.error('asr', 'hotkey.failed', { message: String(error.message) });
    }
  }
  release() {
    if (!this.held) return;
    this.held = false;
    this.emit({ type: 'asr.hold', held: false, key: this.settings.key, ts: Date.now() });
  }
  dispose() { clearInterval(this.timer); this.timer = null; this.release(); }
}
