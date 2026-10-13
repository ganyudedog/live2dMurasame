import { DEFAULT_SUBTITLE_SETTINGS, normalizeSubtitleSettings, fitSubtitleBounds } from '../../../../shared/subtitleSettings.js';
import { SubtitleState } from '../domain/SubtitleState.js';

export class SubtitleWindowService {
  constructor({ createWindow, screen, getPetWindow, saveSettings, readMouseDown, log }) {
    this.createWindow = createWindow; this.screen = screen; this.getPetWindow = getPetWindow;
    this.saveSettings = saveSettings; this.readMouseDown = readMouseDown; this.log = log;
    this.settings = normalizeSubtitleSettings(); this.state = new SubtitleState();
    this.window = null; this.preview = false; this.fade = false; this.version = 0;
    this.hideTimer = null; this.fadeTimer = null; this.gesture = null; this.gestureTimer = null;
    this.onDisplaysChanged = () => this.restoreBounds();
  }
  start(settings) {
    this.settings = normalizeSubtitleSettings(settings);
    const bounds = this.resolveBounds();
    this.window = this.createWindow({ bounds, settings: this.settings });
    this.window.webContents.on('did-finish-load', () => this.publish());
    this.window.on('closed', () => { this.dispose(); this.window = null; });
    this.screen.on('display-removed', this.onDisplaysChanged);
    this.screen.on('display-metrics-changed', this.onDisplaysChanged);
  }
  resolveBounds(reset = false) {
    const pet = this.getPetWindow()?.getBounds();
    const current = !reset ? this.window?.getBounds() : null;
    const display = this.screen.getDisplayMatching(current ?? pet ?? this.screen.getPrimaryDisplay().workArea);
    const saved = !reset ? this.settings.positions[String(display.id)] : null;
    return fitSubtitleBounds(saved ?? {}, display.workArea);
  }
  restoreBounds(reset = false) {
    if (!this.window || this.window.isDestroyed()) return;
    this.endGesture();
    this.window.setBounds(this.resolveBounds(reset), false); this.publish();
    if (reset) this.persistBounds();
  }
  configure(settings) {
    this.settings = normalizeSubtitleSettings(settings);
    if (!this.window || this.window.isDestroyed()) return;
    if (this.settings.locked) this.endGesture();
    this.window.setAlwaysOnTop(this.settings.alwaysOnTop);
    // Non-focusable Windows windows can discard the activating mouse press.
    // Showing still uses showInactive; only an explicit unlocked click can focus.
    this.window.setFocusable(!this.settings.locked);
    this.window.setIgnoreMouseEvents(this.settings.locked, { forward: true });
    this.publish();
    if (!this.settings.enabled && !this.preview) this.window.hide();
  }
  snapshot() {
    return { version: this.version, text: this.preview ? '今天有什么安排？\n我们可以一起聊一聊。' : this.state.text,
      phase: this.preview ? 'preview' : this.state.phase, settings: this.settings,
      fading: this.fade, adjusting: Boolean(this.gesture),
      bounds: this.window?.getBounds() ?? { x: 0, y: 0, width: 480, height: 80 } };
  }
  publish() {
    if (!this.window || this.window.isDestroyed()) return;
    this.version++;
    this.window.webContents.send('ddd:subtitle:state', this.snapshot());
    if ((this.preview || this.state.phase !== 'idle') && (this.preview || this.settings.enabled)) {
      if (!this.window.isVisible()) this.window.showInactive();
    }
    else this.window.hide();
  }
  clearTimers() { clearTimeout(this.hideTimer); clearTimeout(this.fadeTimer); this.hideTimer = null; this.fadeTimer = null; }
  onAsr(event) {
    if (!this.state.apply(event)) return;
    if (event.type === 'asr.speech-start') { this.preview = false; this.clearTimers(); this.fade = false; }
    if (event.type === 'asr.final') {
      this.clearTimers(); this.fade = false;
      this.hideTimer = setTimeout(() => this.dismiss(), this.settings.holdMs);
    }
    this.publish();
  }
  replyStarted(conversationId) {
    if (this.state.phase === 'submitted' && conversationId === `asr_${this.state.utteranceId}`) this.dismiss();
  }
  dismiss() {
    this.clearTimers();
    if (this.gesture) { this.hideTimer = setTimeout(() => this.dismiss(), 200); return; }
    this.fade = true; this.publish();
    this.fadeTimer = setTimeout(() => { this.state.clear(); this.fade = false; this.publish(); }, 200);
  }
  setPreview(enabled) {
    this.clearTimers(); this.fade = false; this.preview = Boolean(enabled);
    this.publish();
  }
  updateSettings(patch) { this.saveSettings(patch); }
  resetAppearance() { this.saveSettings({ ...DEFAULT_SUBTITLE_SETTINGS, positions: this.settings.positions }); }
  persistBounds() {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    const display = this.screen.getDisplayMatching(bounds);
    this.saveSettings({ positions: { ...this.settings.positions, [String(display.id)]: bounds } });
  }
  beginGesture(edge = '') {
    if (this.settings.locked || !this.window?.isVisible()) return;
    this.endGesture();
    this.gesture = { edge: ['e', 'w', 'n', 's', 'ne', 'nw', 'se', 'sw'].includes(edge) ? edge : '',
      cursor: this.screen.getCursorScreenPoint(), bounds: this.window.getBounds() };
    this.publish();
    this.gestureTimer = setInterval(() => {
      if (this.readMouseDown && !this.readMouseDown()) { this.endGesture(); return; }
      this.moveGesture();
    }, 16);
  }
  moveGesture() {
    if (!this.gesture || !this.window || this.window.isDestroyed()) return;
    const { edge, cursor, bounds } = this.gesture;
    const point = this.screen.getCursorScreenPoint();
    const dx = point.x - cursor.x; const dy = point.y - cursor.y;
    const next = { ...bounds };
    if (!edge) { next.x += dx; next.y += dy; }
    else {
      if (edge.includes('e')) next.width += dx;
      if (edge.includes('s')) next.height += dy;
      if (edge.includes('w')) { next.x += dx; next.width -= dx; }
      if (edge.includes('n')) { next.y += dy; next.height -= dy; }
    }
    const display = this.screen.getDisplayNearestPoint(point);
    const fit = fitSubtitleBounds(next, display.workArea);
    // Resizing from a leading edge keeps the opposite edge in place at the size limits.
    if (edge.includes('w')) fit.x = Math.max(display.workArea.x, bounds.x + bounds.width - fit.width);
    if (edge.includes('n')) fit.y = Math.max(display.workArea.y, bounds.y + bounds.height - fit.height);
    const current = this.window.getBounds();
    if (Object.keys(fit).some((key) => fit[key] !== current[key])) { this.window.setBounds(fit, false); this.publish(); }
  }
  endGesture() {
    if (!this.gesture) return;
    this.moveGesture(); this.gesture = null;
    clearInterval(this.gestureTimer); this.gestureTimer = null;
    this.persistBounds(); this.publish();
  }
  dispose() {
    this.clearTimers(); clearInterval(this.gestureTimer); this.gesture = null;
    this.screen.removeListener('display-removed', this.onDisplaysChanged);
    this.screen.removeListener('display-metrics-changed', this.onDisplaysChanged);
  }
}
