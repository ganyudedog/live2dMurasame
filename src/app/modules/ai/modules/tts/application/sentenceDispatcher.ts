import type { QwenTtsTriggerInput, TtsRunResult } from '../domain/types';

export interface SentenceSpeechPort {
  speakFromQwenReply(input: QwenTtsTriggerInput): Promise<TtsRunResult>;
}

export const createSentenceDispatcher = (speaker: SentenceSpeechPort, requestId: string, isDisposed: () => boolean) => {
  let stopped = false;
  let sentenceIndex = 0;
  const results = { completed: 0, skipped: 0, failed: 0 };
  const pending = new Set<Promise<void>>();
  const submitted = new Set<number>();
  const submit = (speakText: string, displayText: string, explicitIndex?: number): void => {
    if (stopped || isDisposed()) return;
    const index = explicitIndex ?? sentenceIndex;
    if (submitted.has(index)) return;
    submitted.add(index);
    sentenceIndex = Math.max(sentenceIndex, index + 1);
    const task = (async () => {
      try {
        const result = await speaker.speakFromQwenReply({
          requestId: `${requestId}_s${index}`, queueGroupId: requestId, sentenceIndex: index, speakText, displayText,
        });
        if (result.skipped) results.skipped++;
        else if (result.ok) results.completed++;
        else results.failed++;
      } catch {
        results.failed++;
      }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  return {
    submit, wait: () => Promise.all([...pending]), summary: () => ({ submitted: submitted.size, ...results }),
    stop: () => { stopped = true; },
  };
};
