export class SubtitleState {
  constructor() { this.text = ''; this.phase = 'idle'; this.utteranceId = null; this.finalized = false; }
  apply(event) {
    if (event.type === 'mic.state' && event.state === 'requesting') {
      this.text = '正在准备麦克风…'; this.phase = 'listening'; this.utteranceId = null; this.finalized = false;
    } else if (event.type === 'mic.state' && event.state === 'active' && this.text === '正在准备麦克风…') {
      this.text = ''; this.phase = 'listening';
    } else if (event.type === 'asr.speech-start') {
      this.utteranceId = event.utteranceId; this.text = ''; this.phase = 'listening'; this.finalized = false;
    } else if (event.type === 'asr.partial' || event.type === 'asr.final') {
      if (this.utteranceId && this.utteranceId !== event.utteranceId) return false;
      if (this.finalized && event.type === 'asr.partial') return false;
      this.utteranceId = event.utteranceId;
      this.text = event.text;
      this.phase = event.type === 'asr.final' ? 'submitted' : 'listening';
      this.finalized = event.type === 'asr.final';
    } else if (event.type === 'asr.speech-end' && event.utteranceId === this.utteranceId && !this.text) {
      this.clear();
    } else if (event.type === 'asr.error' || (event.type === 'mic.state' && event.state === 'off' && this.phase !== 'submitted')) {
      this.clear();
    } else return false;
    return true;
  }
  clear() { this.text = ''; this.phase = 'idle'; }
}
