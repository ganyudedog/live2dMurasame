import { describe, expect, it, vi } from 'vitest';
import { AiService } from '@app/modules/ai/service/AiService';
import type { AsrService } from '@app/modules/ai/modules/asr/service/AsrService';
import type { LlmService } from '@app/modules/ai/modules/llm/service/LlmService';
import type { TtsService } from '@app/modules/ai/modules/tts/service/TtsService';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import { LogService, type BoundaryForward } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import type { ChatRequest } from '@app/shared/state-bus/sharedStateTypes';
import { BackendLogService } from '../electron/modules/logging/BackendLogService';

describe('conversation.turn', () => {
  it('completes one renderer trace whose boundary was passed into LogService', async () => {
    const log = new LogService({ windowKind: 'pet', startedAt: 0, configSnapshot: null } satisfies BootstrapContext);
    const backend = new BackendLogService();
    const handed: Array<{ traceId: string; boundary: string; event: string; scope: string }> = [];
    backend.onLineage = (entry) => { handed.push(entry); };
    const forward = vi.fn<BoundaryForward>((payload) => backend.mirrorRenderer(null, payload));
    log.forwardBoundary = forward;
    const llm = {
      ask: vi.fn<LlmService['ask']>(async (_text, options) => {
        options?.onSentenceSpeechReady?.({ sentenceIndex: 0, speakText: 'hello' });
        return { ok: true, reply: { display_text: 'hello' } };
      }),
      dispose: vi.fn(),
      bindPresence: vi.fn(),
      notePresenceInteraction: vi.fn(),
    };
    const tts = {
      start: vi.fn(),
      dispose: vi.fn(),
      cancelActive: vi.fn(),
      createDispatcher: vi.fn(() => ({
        submit: vi.fn(),
        stop: vi.fn(),
        wait: vi.fn().mockResolvedValue(undefined),
        summary: vi.fn(() => ({})),
      })),
    };
    const asr = { start: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined), running: false };
    const stateBus = { chatConfig: {}, publishChatRequest: vi.fn(), publishChatResponse: vi.fn() };
    const service = new AiService(
      stateBus as unknown as StateBusService,
      log,
      llm as unknown as LlmService,
      tts as unknown as TtsService,
      asr as unknown as AsrService,
    );

    await service.processChatRequest({ id: 'turn-1', text: 'hello', source: 'asr', status: 'pending', createdAt: 1 } satisfies ChatRequest);

    const traces = log.readBoundary('conversation.turn');
    expect(traces.map((trace) => trace.status)).toEqual(['completed']);
    expect(forward).toHaveBeenCalledTimes(1);
    const [call] = forward.mock.calls[0];
    expect(call.startedAt).toBe(performance.timeOrigin + traces[0].startedAt);
    expect(call.endedAt).toBe(performance.timeOrigin + traces[0].endedAt!);
    expect(call.events.every(({ at }) => at >= call.startedAt && at <= call.endedAt)).toBe(true);
    expect(traces[0]?.events.map((event) => event.event).filter((event) => event === 'asr.final' || event === 'llm.ask' || event === 'tts.dispatch'))
      .toEqual(['asr.final', 'llm.ask', 'tts.dispatch']);
    expect(handed.filter((entry) => entry.event === 'asr.final' || entry.event === 'llm.ask' || entry.event === 'tts.dispatch')).toEqual([
      { traceId: traces[0]?.traceId, boundary: 'conversation.turn', event: 'asr.final', scope: 'renderer' },
      { traceId: traces[0]?.traceId, boundary: 'conversation.turn', event: 'llm.ask', scope: 'renderer' },
      { traceId: traces[0]?.traceId, boundary: 'conversation.turn', event: 'tts.dispatch', scope: 'renderer' },
    ]);
    await service.dispose();
  });
});
