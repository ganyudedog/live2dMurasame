import { makeObservable, observable, observableRef, runInAction } from 'mobx';
import { BUBBLE_MAX_LINES } from '../domain/constants';
import type { DialogueMeasurement, DialogueMeasurementRequest, DialoguePlaybackState, DialogueSentence } from '../domain/dialogue';

interface PlannedSentence extends DialogueSentence {
  page: number;
  pageText: string;
  prefix: string;
  measurement: DialogueMeasurement;
}

interface MeasurementJob {
  request: DialogueMeasurementRequest;
  resolve: (measurement: DialogueMeasurement | null) => void;
}

export interface DialoguePresentationEvent {
  conversationId: string;
  requestId: string;
  state: 'started' | 'finished' | 'cleared';
}

export class BubbleDialogueService {
  conversationId: string | null = null;
  measurementRequest: DialogueMeasurementRequest | null = null;
  text: string | null = null;
  displayedText = '';
  measurement: DialogueMeasurement | null = null;
  activeRequestId: string | null = null;

  private readonly presentationListeners = new Set<(event: DialoguePresentationEvent) => void>();
  private presentedSource: string | null = null;
  private preferredPlaybackRequired = true;

  onPresentation(listener: (event: DialoguePresentationEvent) => void): () => void {
    this.presentationListeners.add(listener);
    return () => { this.presentationListeners.delete(listener); };
  }

  private sourceId(id: string): string {
    return [...this.sourceSegments].find(([, ids]) => ids.includes(id))?.[0] ?? id;
  }

  private emitPresentation(state: DialoguePresentationEvent['state'], requestId: string): void {
    if (!this.conversationId) return;
    const event = { conversationId: this.conversationId, requestId, state };
    this.presentationListeners.forEach((listener) => listener(event));
  }

  private finishPresentation(id: string): void {
    const source = this.sourceId(id);
    const segments = this.sourceSegments.get(source);
    if (segments && segments[segments.length - 1] !== id) return;
    if (this.presentedSource !== source) return;
    this.emitPresentation('finished', source);
    this.presentedSource = null;
  }

  private maxWidth = 220;
  private scale = 1;
  private epoch = 0;
  private nextMeasurementId = 0;
  private planTail: Promise<void> = Promise.resolve();
  private plannedPage = 0;
  private plannedText = '';
  private readonly sentences = new Map<string, DialogueSentence>();
  private readonly sourceSegments = new Map<string, string[]>();
  private readonly planned = new Map<string, PlannedSentence>();
  private readonly playback = new Map<string, DialoguePlaybackState>();
  private latestStartedId: string | null = null;
  private hadPlaybackStart = false;
  private playbackRequired = true;
  private completed = false;
  private readonly jobs: MeasurementJob[] = [];
  private readonly cache = new Map<string, DialogueMeasurement>();
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private silentTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly silentShown = new Set<string>();

  constructor() {
    makeObservable(this, {
      conversationId: observable, measurementRequest: observableRef,
      text: observable, displayedText: observable, measurement: observableRef, activeRequestId: observable,
    });
  }

  begin(conversationId: string): void {
    this.clear();
    this.playbackRequired = this.preferredPlaybackRequired;
    runInAction(() => { this.conversationId = conversationId; });
  }

  /**
   * Playback is an optional timing source.  The dialogue can still present
   * sentences when no TTS runtime is attached; TTS events only control the
   * pacing when this flag is enabled.
   */
  setPlaybackRequired(required: boolean): void {
    this.preferredPlaybackRequired = required;
    // Recovery applies to the next turn; never seize the clock from a reading queue.
    if (required && this.conversationId && !this.playbackRequired) return;
    this.playbackRequired = required;
    if (!required) {
      this.planned.forEach((_, requestId) => {
        if (this.playback.get(requestId) !== 'finished') this.playback.set(requestId, 'skipped');
      });
      this.pumpSilent();
      this.scheduleDismiss();
    }
  }

  configure(maxWidth: number, scale: number): void {
    if (this.maxWidth === maxWidth && this.scale === scale) return;
    this.maxWidth = maxWidth;
    this.scale = scale;
    this.cache.clear();
    if (!this.conversationId) return;
    const sentences = [...this.sentences.values()];
    const sourceSegments = new Map(this.sourceSegments);
    const playback = new Map(this.playback);
    const latestStartedId = this.latestStartedId;
    const hadPlaybackStart = this.hadPlaybackStart;
    const completed = this.completed;
    const silentShown = [...this.silentShown].filter((id) => id !== this.activeRequestId);
    const conversationId = this.conversationId;
    // Relayout is not a conversation cancellation. Keep action ownership intact.
    this.reset(true);
    runInAction(() => { this.conversationId = conversationId; });
    this.playback.clear();
    playback.forEach((state, id) => this.playback.set(id, state));
    this.latestStartedId = latestStartedId;
    this.hadPlaybackStart = hadPlaybackStart;
    this.completed = completed;
    silentShown.forEach((id) => this.silentShown.add(id));
    sourceSegments.forEach((ids, source) => this.sourceSegments.set(source, ids));
    sentences.forEach((sentence) => this.prepareSegment(sentence));
  }

  prepare(sentence: DialogueSentence): void {
    if (!this.conversationId || !sentence.text || this.sourceSegments.has(sentence.requestId)) return;
    const parts = sentence.text.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const requestIds = parts.map((_, index) => parts.length === 1
      ? sentence.requestId
      : `${sentence.requestId}#${index}`);
    this.sourceSegments.set(sentence.requestId, requestIds);
    const earlyState = this.playback.get(sentence.requestId);
    if (requestIds[0] !== sentence.requestId && earlyState) {
      this.playback.delete(sentence.requestId);
      if (this.latestStartedId === sentence.requestId) this.latestStartedId = requestIds[0];
      requestIds.forEach((id, index) => {
        if (index === 0 || earlyState !== 'started') {
          this.playback.set(id, index > 0 && earlyState === 'finished' ? 'skipped' : earlyState);
        }
      });
    }
    parts.forEach((text, index) => this.prepareSegment({
      requestId: requestIds[index],
      text,
      pageBreakBefore: index > 0 || sentence.pageBreakBefore,
    }));
  }

  private prepareSegment(sentence: DialogueSentence): void {
    if (this.sentences.has(sentence.requestId)) return;
    this.sentences.set(sentence.requestId, sentence);
    const epoch = this.epoch;
    this.planTail = this.planTail.then(async () => {
      if (epoch !== this.epoch) return;
      let prefix = this.plannedText ? `${this.plannedText}\n` : '';
      let pageText = prefix + sentence.text;
      let measurement = await this.measure(pageText);
      if (!measurement || epoch !== this.epoch) return;
      if (prefix && (sentence.pageBreakBefore || measurement.lineCount > BUBBLE_MAX_LINES)) {
        prefix = '';
        pageText = sentence.text;
        measurement = await this.measure(pageText);
        if (!measurement || epoch !== this.epoch) return;
        this.plannedPage += 1;
      }
      this.plannedText = pageText;
      const planned = { ...sentence, prefix, pageText, measurement, page: this.plannedPage };
      this.planned.set(sentence.requestId, planned);
      if (!this.playbackRequired) this.playback.set(sentence.requestId, 'skipped');
      if (this.playbackRequired && this.latestStartedId === sentence.requestId) this.activate(planned);
      this.pumpSilent();
      this.scheduleDismiss();
    });
  }

  onPlayback(requestId: string, state: DialoguePlaybackState): void {
    if (!this.conversationId) return;
    if (!this.playbackRequired) return;
    const segmentIds = this.sourceSegments.get(requestId) ?? [requestId];
    if (state === 'started') this.applyPlayback(segmentIds[0], state);
    else {
      segmentIds.forEach((id, index) => this.applyPlayback(id,
        state === 'finished' && index > 0 ? 'skipped' : state));
      this.pumpSilent();
      this.scheduleDismiss();
    }
  }

  private applyPlayback(requestId: string, state: DialoguePlaybackState): void {
    const previous = this.playback.get(requestId);
    if (previous === 'finished' || previous === 'cancelled' || previous === 'error' || previous === 'skipped') return;
    this.playback.set(requestId, state);
    if (state === 'started') {
      this.hadPlaybackStart = true;
      this.latestStartedId = requestId;
      this.clearDismiss();
      this.clearSilent();
      const planned = this.planned.get(requestId);
      if (planned) this.activate(planned);
    } else if (state === 'finished') {
      // A terminal response can race the delayed display field or measurement.
      if (!this.hadPlaybackStart) this.latestStartedId = requestId;
      if (this.activeRequestId === requestId) { this.finishTyping(); this.finishPresentation(requestId); }
      else if (this.latestStartedId === requestId) {
        const planned = this.planned.get(requestId);
        if (planned) this.activate(planned);
      }
      this.scheduleDismiss();
    } else if (state === 'skipped') this.pumpSilent();
    else if (this.activeRequestId === requestId) {
      this.pumpSilent();
      this.scheduleDismiss();
    } else if (state === 'error') this.pumpSilent();
  }

  complete(): void {
    this.completed = true;
    this.scheduleDismiss();
  }

  submitMeasurement(measurement: DialogueMeasurement): void {
    const job = this.jobs[0];
    if (!job || job.request.id !== measurement.id || job.request.text !== measurement.text
      || job.request.scale !== measurement.scale || job.request.maxWidth !== measurement.maxWidth) return;
    if (![measurement.width, measurement.height, measurement.lineCount].every((value) => Number.isFinite(value) && value > 0)) return;
    if (this.cache.size >= 128) this.cache.clear();
    this.cache.set(this.cacheKey(measurement.text), measurement);
    this.jobs.shift();
    runInAction(() => { this.measurementRequest = this.jobs[0]?.request ?? null; });
    job.resolve(measurement);
  }

  clear(): void { this.reset(false); }

  private reset(preservePresentation: boolean): void {
    if (!preservePresentation) {
      this.emitPresentation('cleared', this.presentedSource ?? '');
      this.presentedSource = null;
    }
    this.epoch += 1;
    this.clearTyping();
    this.clearDismiss();
    this.clearSilent();
    this.jobs.splice(0).forEach((job) => job.resolve(null));
    this.sentences.clear();
    this.planned.clear();
    this.playback.clear();
    this.silentShown.clear();
    this.sourceSegments.clear();
    this.latestStartedId = null;
    this.hadPlaybackStart = false;
    this.completed = false;
    this.plannedPage = 0;
    this.plannedText = '';
    this.planTail = Promise.resolve();
    runInAction(() => {
      this.conversationId = null;
      this.measurementRequest = null;
      this.text = null;
      this.displayedText = '';
      this.measurement = null;
      this.activeRequestId = null;
    });
  }

  dispose(): void { this.clear(); this.cache.clear(); this.presentationListeners.clear(); }

  private measure(text: string): Promise<DialogueMeasurement | null> {
    const cached = this.cache.get(this.cacheKey(text));
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
      const request = { id: ++this.nextMeasurementId, text, maxWidth: this.maxWidth, scale: this.scale };
      this.jobs.push({ request, resolve });
      runInAction(() => { this.measurementRequest = this.jobs[0].request; });
    });
  }

  private cacheKey(text: string): string { return JSON.stringify([this.maxWidth, this.scale, text]); }

  private activate(sentence: PlannedSentence): void {
    if (this.activeRequestId === sentence.requestId && this.measurement === sentence.measurement) return;
    this.clearTyping();
    this.clearDismiss();
    const source = this.sourceId(sentence.requestId);
    if (this.presentedSource !== source) {
      if (this.presentedSource) this.emitPresentation('finished', this.presentedSource);
      this.presentedSource = source;
      this.emitPresentation('started', source);
    }
    runInAction(() => {
      this.activeRequestId = sentence.requestId;
      this.text = sentence.pageText;
      this.displayedText = sentence.prefix;
      this.measurement = sentence.measurement;
    });
    if (this.playback.get(sentence.requestId) === 'finished') {
      this.finishTyping();
      this.finishPresentation(sentence.requestId);
      return;
    }
    const characters = Array.from(sentence.text);
    const stepMs = Math.max(8, Math.min(28, 1500 / characters.length));
    let count = 0;
    const type = () => {
      if (this.activeRequestId !== sentence.requestId) return;
      count += 1;
      runInAction(() => { this.displayedText = sentence.prefix + characters.slice(0, count).join(''); });
      this.typingTimer = count < characters.length ? setTimeout(type, stepMs) : null;
    };
    this.typingTimer = setTimeout(type, 90);
  }

  private finishTyping(): void {
    this.clearTyping();
    runInAction(() => { this.displayedText = this.text ?? ''; });
  }

  private pumpSilent(): void {
    if (this.silentTimer || (this.latestStartedId && this.playback.get(this.latestStartedId) === 'started')) return;
    const sentence = [...this.planned.values()].find((item) =>
      !this.silentShown.has(item.requestId)
      && !['finished', 'cancelled'].includes(this.playback.get(item.requestId) ?? ''));
    if (!sentence || !['skipped', 'error'].includes(this.playback.get(sentence.requestId) ?? '')) return;
    this.silentShown.add(sentence.requestId);
    this.activate(sentence);
    this.silentTimer = setTimeout(() => {
      this.silentTimer = null;
      this.finishTyping();
      this.finishPresentation(sentence.requestId);
      this.pumpSilent();
      this.scheduleDismiss();
    }, Math.max(1800, Array.from(sentence.text).length * 65));
  }

  private scheduleDismiss(): void {
    if (!this.completed || this.jobs.length || this.planned.size !== this.sentences.size || this.silentTimer) return;
    if (this.playbackRequired) {
      const terminal = new Set<DialoguePlaybackState>(['finished', 'cancelled', 'error', 'skipped']);
      if ([...this.planned.keys()].some((requestId) => !terminal.has(this.playback.get(requestId)!))) return;
    }
    this.clearDismiss();
    this.dismissTimer = setTimeout(() => this.clear(), 7000);
  }

  private clearTyping(): void { if (this.typingTimer) clearTimeout(this.typingTimer); this.typingTimer = null; }
  private clearDismiss(): void { if (this.dismissTimer) clearTimeout(this.dismissTimer); this.dismissTimer = null; }
  private clearSilent(): void { if (this.silentTimer) clearTimeout(this.silentTimer); this.silentTimer = null; }
}
