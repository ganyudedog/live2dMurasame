const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export type SubtitlePhase = 'idle' | 'listening' | 'submitted';

export class SubtitleState {
  text: unknown = '';
  phase: SubtitlePhase = 'idle';
  utteranceId: unknown = null;
  finalized = false;

  apply(event: unknown): boolean {
    const current = isRecord(event) ? event : {};
    if (current.type === 'mic.state' && current.state === 'requesting') {
      this.text = '正在准备麦克风…'; this.phase = 'listening'; this.utteranceId = null; this.finalized = false;
    } else if (current.type === 'mic.state' && current.state === 'active' && this.text === '正在准备麦克风…') {
      this.text = ''; this.phase = 'listening';
    } else if (current.type === 'asr.speech-start') {
      this.utteranceId = current.utteranceId; this.text = ''; this.phase = 'listening'; this.finalized = false;
    } else if (current.type === 'asr.partial' || current.type === 'asr.final') {
      if (this.utteranceId && this.utteranceId !== current.utteranceId) return false;
      if (this.finalized && current.type === 'asr.partial') return false;
      this.utteranceId = current.utteranceId;
      this.text = current.text;
      this.phase = current.type === 'asr.final' ? 'submitted' : 'listening';
      this.finalized = current.type === 'asr.final';
    } else if (current.type === 'asr.speech-end' && current.utteranceId === this.utteranceId && !this.text) {
      this.clear();
    } else if (current.type === 'asr.error' || (current.type === 'mic.state' && current.state === 'off' && this.phase !== 'submitted')) {
      this.clear();
    } else return false;
    return true;
  }

  clear(): void { this.text = ''; this.phase = 'idle'; }
}
