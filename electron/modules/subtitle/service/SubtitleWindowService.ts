import { DEFAULT_SUBTITLE_SETTINGS, normalizeSubtitleSettings, fitSubtitleBounds, type SubtitleSettings, type SubtitleBounds } from '../../../../shared/subtitle/subtitleSettings.js';
import { SubtitleState } from '../domain/SubtitleState.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

interface Area { x: number; y: number; width: number; height: number }
interface Point { x: number; y: number }
interface DisplayLike { id: number; workArea: Area }

interface SubtitleWindowLike {
  webContents: {
    on(event: string, listener: () => void): void;
    send(channel: string, payload: unknown): void;
  };
  on(event: string, listener: () => void): void;
  isDestroyed(): boolean;
  getBounds(): Area;
  setBounds(bounds: Area, animate?: boolean): void;
  setAlwaysOnTop(flag: boolean): void;
  setFocusable(focusable: boolean): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
  isVisible(): boolean;
  showInactive(): void;
  hide(): void;
  close(): void;
}

interface ScreenLike {
  on(event: string, listener: () => void): void;
  removeListener(event: string, listener: () => void): void;
  getDisplayMatching(rect: Area): DisplayLike;
  getDisplayNearestPoint(point: Point): DisplayLike;
  getPrimaryDisplay(): DisplayLike;
  getCursorScreenPoint(): Point;
}

interface PetWindow { getBounds(): Area; webContents?: unknown }
interface Gesture { edge: string; cursor: Point; bounds: Area }

const subtitleInput = (settings: unknown): Partial<SubtitleSettings> | undefined =>
  isRecord(settings) ? settings as Partial<SubtitleSettings> : undefined;

export class SubtitleWindowService {
  private readonly createWindow: (options: { bounds: Area; settings: SubtitleSettings }) => SubtitleWindowLike;
  private readonly screen: ScreenLike;
  private readonly getPetWindow: () => PetWindow | null | undefined;
  private readonly saveSettings: (patch: Record<string, unknown>) => void;
  private readonly readMouseDown: (() => boolean) | null;
  private settings: SubtitleSettings;
  private readonly state = new SubtitleState();
  window: SubtitleWindowLike | null = null;
  private preview = false;
  private fade = false;
  private version = 0;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private gesture: Gesture | null = null;
  private gestureTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onDisplaysChanged: () => void;

  constructor({ createWindow, screen, getPetWindow, saveSettings, readMouseDown, log }: {
    createWindow: (options: { bounds: Area; settings: SubtitleSettings }) => SubtitleWindowLike;
    screen: ScreenLike;
    getPetWindow: () => PetWindow | null | undefined;
    saveSettings: (patch: Record<string, unknown>) => void;
    readMouseDown: (() => boolean) | null;
    log?: unknown;
  }) {
    this.createWindow = createWindow;
    this.screen = screen;
    this.getPetWindow = getPetWindow;
    this.saveSettings = saveSettings;
    this.readMouseDown = readMouseDown;
    void log;
    this.settings = normalizeSubtitleSettings();
    this.onDisplaysChanged = () => this.restoreBounds();
  }

  start(settings?: unknown): void {
    this.settings = normalizeSubtitleSettings(subtitleInput(settings));
    const bounds = this.resolveBounds();
    this.window = this.createWindow({ bounds, settings: this.settings });
    this.window.webContents.on('did-finish-load', () => this.publish());
    this.window.on('closed', () => { this.dispose(); this.window = null; });
    this.screen.on('display-removed', this.onDisplaysChanged);
    this.screen.on('display-metrics-changed', this.onDisplaysChanged);
  }

  resolveBounds(reset = false): SubtitleBounds {
    const pet = this.getPetWindow()?.getBounds();
    const current = !reset ? this.window?.getBounds() : null;
    const display = this.screen.getDisplayMatching(current ?? pet ?? this.screen.getPrimaryDisplay().workArea);
    const saved = !reset ? this.settings.positions[String(display.id)] : null;
    return fitSubtitleBounds(saved ?? {}, display.workArea);
  }

  restoreBounds(reset = false): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.endGesture();
    this.window.setBounds(this.resolveBounds(reset), false); this.publish();
    if (reset) this.persistBounds();
  }

  configure(settings: unknown): void {
    this.settings = normalizeSubtitleSettings(subtitleInput(settings));
    if (!this.window || this.window.isDestroyed()) return;
    if (this.settings.locked) this.endGesture();
    this.window.setAlwaysOnTop(this.settings.alwaysOnTop);
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

  publish(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.version += 1;
    this.window.webContents.send('ddd:subtitle:state', this.snapshot());
    if ((this.preview || this.state.phase !== 'idle') && (this.preview || this.settings.enabled)) {
      if (!this.window.isVisible()) this.window.showInactive();
    }
    else this.window.hide();
  }

  clearTimers(): void { if (this.hideTimer) clearTimeout(this.hideTimer); if (this.fadeTimer) clearTimeout(this.fadeTimer); this.hideTimer = null; this.fadeTimer = null; }

  onAsr(event: unknown): void {
    if (!this.state.apply(event)) return;
    const type = isRecord(event) ? event.type : undefined;
    if (type === 'asr.speech-start') { this.preview = false; this.clearTimers(); this.fade = false; }
    if (type === 'asr.final') {
      this.clearTimers(); this.fade = false;
      this.hideTimer = setTimeout(() => this.dismiss(), this.settings.holdMs);
    }
    this.publish();
  }

  replyStarted(conversationId: unknown): void {
    if (this.state.phase === 'submitted' && conversationId === `asr_${String(this.state.utteranceId)}`) this.dismiss();
  }

  dismiss(): void {
    this.clearTimers();
    if (this.gesture) { this.hideTimer = setTimeout(() => this.dismiss(), 200); return; }
    this.fade = true; this.publish();
    this.fadeTimer = setTimeout(() => { this.state.clear(); this.fade = false; this.publish(); }, 200);
  }

  setPreview(enabled: unknown): void {
    this.clearTimers(); this.fade = false; this.preview = Boolean(enabled);
    this.publish();
  }

  updateSettings(patch: unknown): void { this.saveSettings(isRecord(patch) ? patch : {}); }
  resetAppearance(): void { this.saveSettings({ ...DEFAULT_SUBTITLE_SETTINGS, positions: this.settings.positions }); }

  persistBounds(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    const display = this.screen.getDisplayMatching(bounds);
    this.saveSettings({ positions: { ...this.settings.positions, [String(display.id)]: bounds } });
  }

  beginGesture(edge = ''): void {
    if (this.settings.locked || !this.window?.isVisible()) return;
    this.endGesture();
    const edges = ['e', 'w', 'n', 's', 'ne', 'nw', 'se', 'sw'];
    this.gesture = { edge: edges.includes(edge) ? edge : '',
      cursor: this.screen.getCursorScreenPoint(), bounds: this.window.getBounds() };
    this.publish();
    this.gestureTimer = setInterval(() => {
      if (this.readMouseDown && !this.readMouseDown()) { this.endGesture(); return; }
      this.moveGesture();
    }, 16);
  }

  moveGesture(): void {
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
    if (edge.includes('w')) fit.x = Math.max(display.workArea.x, bounds.x + bounds.width - fit.width);
    if (edge.includes('n')) fit.y = Math.max(display.workArea.y, bounds.y + bounds.height - fit.height);
    const current = this.window.getBounds();
    if ((['x', 'y', 'width', 'height'] as const).some((key) => fit[key] !== current[key])) { this.window.setBounds(fit, false); this.publish(); }
  }

  endGesture(): void {
    if (!this.gesture) return;
    this.moveGesture(); this.gesture = null;
    if (this.gestureTimer) clearInterval(this.gestureTimer); this.gestureTimer = null;
    this.persistBounds(); this.publish();
  }

  dispose(): void {
    this.clearTimers(); if (this.gestureTimer) clearInterval(this.gestureTimer); this.gesture = null;
    this.screen.removeListener('display-removed', this.onDisplaysChanged);
    this.screen.removeListener('display-metrics-changed', this.onDisplaysChanged);
  }
}
