import { useCallback, useRef } from 'react';
import { info } from '../../../utils/log';

interface TtsSentence {
  index: number;
  speakText: string;
  displayText: string;
}

interface TtsQueueState {
  sentences: TtsSentence[];
  sendIndex: number;     // 下一个可发送的 index
  playIndex: number;     // 下一个可播放的 index
  displayIndex: number;  // 下一个可展示的 index
  phase: 'idle' | 'streaming' | 'playing' | 'done';
}

export interface UseTtsQueueResult {
  /** LLM 流式产出句子时调用（每行 JSON 解析完成后） */
  pushSentence: (speakText: string, displayText: string) => void;
  /** 标记所有 LLM 句子已产出完毕 */
  finishStreaming: () => void;
  /** 标记当前句 TTS 后端已确认（LiveKit 反馈） → 允许下一句发送 */
  advanceSend: () => void;
  /** 标记音频播放完毕 → 允许下一句展示 */
  advancePlay: () => void;
  /** 获取当前可发送的 speakText（门控通过时返回，否则 null） */
  getNextSpeak: () => TtsSentence | null;
  /** 获取当前可展示的句子 */
  getCurrentDisplay: () => TtsSentence | null;
  /** 是否全部完成 */
  isDone: () => boolean;
}

/**
 * TTS 三队列状态机：
 *
 *   SEND  门控：上一句 LiveKit 反馈 "sentence_done" → advanceSend → 可取下一句 speakText
 *   PLAY  门控：音频 onended → advancePlay
 *   DISPLAY 门控：跟随 PLAY（音频结束展示对应文本）
 */
export const useTtsQueue = (): UseTtsQueueResult => {
  const stateRef = useRef<TtsQueueState>({
    sentences: [],
    sendIndex: 0,
    playIndex: 0,
    displayIndex: 0,
    phase: 'idle',
  });

  const pushSentence = useCallback((speakText: string, displayText: string) => {
    const s = stateRef.current;
    s.sentences.push({
      index: s.sentences.length,
      speakText,
      displayText,
    });
    s.phase = 'streaming';
  }, []);

  const finishStreaming = useCallback(() => {
    stateRef.current.phase = 'playing';
    info('asr.tts.queue', 'streaming.done', { totalSentences: stateRef.current.sentences.length });
  }, []);

  const advanceSend = useCallback(() => {
    stateRef.current.sendIndex += 1;
  }, []);

  const advancePlay = useCallback(() => {
    const s = stateRef.current;
    s.playIndex += 1;
    s.displayIndex = s.playIndex;  // 展示跟随播放
    if (s.playIndex >= s.sentences.length && s.phase !== 'idle') {
      s.phase = 'done';
    }
  }, []);

  const getNextSpeak = useCallback((): TtsSentence | null => {
    const s = stateRef.current;
    if (s.sendIndex >= s.sentences.length) return null;
    return s.sentences[s.sendIndex] ?? null;
  }, []);

  const getCurrentDisplay = useCallback((): TtsSentence | null => {
    const s = stateRef.current;
    if (s.displayIndex >= s.sentences.length) return null;
    return s.sentences[s.displayIndex] ?? null;
  }, []);

  const isDone = useCallback((): boolean => {
    return stateRef.current.phase === 'done';
  }, []);

  return {
    pushSentence,
    finishStreaming,
    advanceSend,
    advancePlay,
    getNextSpeak,
    getCurrentDisplay,
    isDone,
  };
};
