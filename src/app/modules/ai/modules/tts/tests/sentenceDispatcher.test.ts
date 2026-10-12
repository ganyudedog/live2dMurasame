import { describe, expect, it, vi } from 'vitest';
import { createSentenceDispatcher } from '../application/sentenceDispatcher';

describe('early bilingual sentence submission', () => {
  it('reuses the request id when a completed record follows the early Japanese field', async () => {
    const speaker = { speakFromQwenReply: vi.fn().mockResolvedValue({ ok: true }) };
    const dispatcher = createSentenceDispatcher(speaker, 'chat', () => false);
    dispatcher.submit('Japanese', '', 0);
    dispatcher.submit('Japanese', 'Chinese', 0);
    dispatcher.submit('next Japanese', 'next Chinese', 2);
    await dispatcher.wait();
    expect(speaker.speakFromQwenReply.mock.calls.map(([input]) => input.requestId)).toEqual(['chat_s0', 'chat_s2']);
    expect(dispatcher.summary()).toMatchObject({ submitted: 2, completed: 2 });
  });
});
