import { makeObservable, observable, observableRef, runInAction } from 'mobx';
import { normalizeSubtitleSettings, subtitleFontSize } from '../../../../../shared/subtitleSettings.js';
import { lastTwoLines } from '../domain/lines';

export class SubtitleService {
  state: PetSubtitleState = { version: -1, text: '', phase: 'idle', bounds: { x: 0, y: 0, width: 480, height: 80 },
    settings: normalizeSubtitleSettings(), fading: false, adjusting: false };
  lines: string[] = ['', ''];
  rolling = false;
  private frozenText: string | null = null;
  private off: (() => void) | null = null;
  private readonly canvas = document.createElement('canvas');
  private pending: PetSubtitleState | null = null;
  private timer: number | null = null;
  private disposed = false;
  private readonly api: PetSubtitleAPI | undefined;
  constructor(api: PetSubtitleAPI | undefined) {
    this.api = api;
    makeObservable(this, { state: observableRef, lines: observableRef, rolling: observable });
  }
  async start() {
    this.off = this.api?.onState((state) => {
      if (state.version <= this.state.version) return;
      // Coalesce frequent recognition hypotheses without queuing animations.
      this.pending = state;
      if (this.timer === null) this.timer = window.setTimeout(() => {
        this.timer = null;
        const next = this.pending; this.pending = null;
        if (next) this.apply(next);
      }, 32);
    }) ?? null;
    const state = await this.api?.getState();
    if (state) this.apply(state);
  }
  private apply(state: PetSubtitleState) {
    if (this.disposed || state.version < this.state.version) return;
    if (state.adjusting && !this.state.adjusting) this.frozenText = this.state.text;
    if (!state.adjusting) this.frozenText = null;
    const text = this.frozenText ?? (state.text || (state.phase === 'listening' ? '正在听…' : ''));
    const font = subtitleFontSize(state.bounds.width, state.bounds.height);
    const context = this.canvas.getContext('2d');
    if (context) context.font = `600 ${font}px "Microsoft YaHei", sans-serif`;
    const next = lastTwoLines(text, Math.max(1, state.bounds.width - 32), (value) => context?.measureText(value).width ?? value.length * font);
    const previous = this.lines.slice(-2);
    const scroll = !state.adjusting && !this.rolling && previous[1] !== '' && next[0] === previous[1] && next[0] !== previous[0];
    runInAction(() => {
      this.state = state;
      this.rolling = scroll;
      this.lines = scroll ? [previous[0] ?? '', ...next] : next;
    });
  }
  finishAnimation = () => {
    runInAction(() => { this.lines = this.lines.slice(-2); this.rolling = false; });
  };
  beginGesture = (edge = '') => this.api?.gesture({ action: 'start', edge });
  endGesture = () => this.api?.gesture({ action: 'end' });
  dispose() { this.disposed = true; this.off?.(); if (this.timer !== null) window.clearTimeout(this.timer); this.endGesture(); }
}
