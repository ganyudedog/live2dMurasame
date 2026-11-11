import { randomUUID } from 'node:crypto';
import type { AsrSessionEvent, Recognizer, Vad } from './asrTypes.js';

const SAMPLE_RATE = 16000;
const WINDOW_SIZE = 512;

export const createAsrSession = ({
  recognizer,
  vad,
  emit,
  sessionId = randomUUID(),
}: {
  recognizer: Recognizer;
  vad: Vad;
  emit: (event: AsrSessionEvent) => void;
  sessionId?: string;
}) => {
  let stream = recognizer.createStream();
  let remainder = new Float32Array(0);
  let preRoll: Float32Array[] = [];
  let speaking = false;
  let utteranceIndex = 0;
  let utteranceId = '';
  let completedText = '';
  let lastPartial = '';
  let disposed = false;

  const publish = (type: string, payload: Record<string, unknown> = {}) => emit({ type, utteranceId, ts: Date.now(), ...payload });
  const decode = (samples: Float32Array): string => {
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    return recognizer.getResult(stream)?.text?.trim() ?? '';
  };
  const textWith = (text: string) => completedText ? `${completedText}${text}` : text;

  const finishSpeech = (): void => {
    publish('asr.speech-end');
    const draftText = textWith(decode(new Float32Array(SAMPLE_RATE * 0.3)));
    stream.inputFinished();
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    const text = textWith(recognizer.getResult(stream)?.text?.trim() ?? '') || draftText;
    speaking = false;
    completedText = '';
    lastPartial = '';
    preRoll = [];
    stream = recognizer.createStream();
    while (!vad.isEmpty()) vad.pop();
    if (text) publish('asr.final', { text });
  };

  const processWindow = (samples: Float32Array): void => {
    vad.acceptWaveform(samples);
    const detected = vad.isDetected();
    if (!speaking) {
      preRoll.push(samples);
      if (preRoll.length > 14) preRoll.shift();
      if (!detected) return;
      speaking = true;
      utteranceId = `${sessionId}_${utteranceIndex++}`;
      publish('asr.speech-start');
      for (const frame of preRoll) decode(frame);
      preRoll = [];
    } else {
      decode(samples);
    }
    const text = recognizer.getResult(stream)?.text?.trim() ?? '';
    const partial = textWith(text);
    if (partial && partial !== lastPartial) {
      lastPartial = partial;
      publish('asr.partial', { text: partial });
    }
    if (!detected) finishSpeech();
    else if (recognizer.isEndpoint(stream)) {
      completedText = partial;
      recognizer.reset(stream);
    }
  };

  return {
    finish(): void {
      if (disposed) return;
      if (speaking && remainder.length) decode(remainder);
      remainder = new Float32Array(0);
      if (speaking) finishSpeech();
      preRoll = [];
      vad.reset();
    },
    accept(samples: Float32Array): void {
      if (disposed) return;
      const merged = new Float32Array(remainder.length + samples.length);
      merged.set(remainder);
      merged.set(samples, remainder.length);
      let offset = 0;
      while (offset + WINDOW_SIZE <= merged.length) {
        processWindow(merged.slice(offset, offset + WINDOW_SIZE));
        offset += WINDOW_SIZE;
      }
      remainder = merged.slice(offset);
    },
    dispose(): void {
      disposed = true;
      vad.reset();
      remainder = new Float32Array(0);
      preRoll = [];
    },
  };
};
