import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { LogService } from '@app/shared/logging/LogService';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';
import { Live2dService } from '../../../service/Live2dService';
import { bindBubbleMeasurementRoot } from '../ui/imperative/bindBubbleMeasurementRoot';
import type { BubbleLayoutMeasurement, BubbleLayoutRequest } from '../ui/BubbleMeasurementRoot';

vi.mock('react-dom/client', () => ({ createRoot: vi.fn() }));
vi.mock('../../motion/service/MotionService', () => ({
  MotionService: class { attach() {} dispose() {} getGroups() { return []; } },
}));

type MeasurementProps = { request: BubbleLayoutRequest; onMeasured: (result: BubbleLayoutMeasurement) => void };
const dimensions = { width: 220, height: 80, lineCount: 2, readingDurationMs: 1200 };
const flush = async () => { for (let count = 0; count < 12; count++) await Promise.resolve(); };

const setup = () => {
  const mounted = new Set<unknown>();
  let maxMounted = 0;
  const roots: { render: ReturnType<typeof vi.fn>; unmount: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const host = { dataset: {}, remove: () => mounted.delete(host) };
      return host;
    },
    body: { appendChild: (host: unknown) => { mounted.add(host); maxMounted = Math.max(maxMounted, mounted.size); } },
  });
  vi.mocked(createRoot).mockImplementation(() => {
    const root = { render: vi.fn(), unmount: vi.fn() };
    roots.push(root);
    return root as unknown as ReturnType<typeof createRoot>;
  });
  const service = new Live2dService({ scale: 1 } as StateBusService,
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as LogService);
  const latest = () => (roots.at(-1)!.render.mock.calls.at(-1)![0] as ReactElement<MeasurementProps>).props;
  return { service, mounted, roots, latest, maxMounted: () => maxMounted };
};

describe('shared temporary bubble measurement root', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('prioritizes dialogue, rejects preempted motion results and then resumes the pending motion', async () => {
    const { service, mounted, roots, latest, maxMounted } = setup();
    service.setMotionText('motion');
    const stop = bindBubbleMeasurementRoot(service);
    await flush();
    const oldMotion = latest();
    expect(oldMotion.request).toMatchObject({ text: 'motion', scrollable: false });
    service.dialogue.begin('chat');
    service.dialogue.prepare({ requestId: 'chat_s0', text: 'dialogue' });
    await flush();
    expect(latest().request).toMatchObject({ text: 'dialogue', scrollable: false, maxLines: Number.POSITIVE_INFINITY });
    expect(roots[0].unmount).toHaveBeenCalledOnce();
    oldMotion.onMeasured(dimensions);
    await flush();
    expect(service.bubbleMeasurement).toBeNull();
    for (let count = 0; count < 10 && service.dialogue.measurementRequest; count++) {
      latest().onMeasured(dimensions);
      await flush();
    }
    expect(service.dialogue.measurementRequest).toBeNull();
    expect(latest().request.text).toBe('motion');
    latest().onMeasured(dimensions);
    await flush();
    expect(service.bubbleMeasurement).toMatchObject({ text: 'motion', ...dimensions });
    service.dialogue.onPlayback('chat_s0', 'started');
    expect(service.dialogue.text).toBe('dialogue');
    expect(maxMounted()).toBe(1);
    expect(mounted.size).toBe(0);
    expect(roots.every((root) => root.unmount.mock.calls.length === 1)).toBe(true);
    stop();
    service.dispose();
  });

  it('replaces a pending width measurement and ignores its late callback', async () => {
    const { service, mounted, latest } = setup();
    service.setMotionText('motion');
    const stop = bindBubbleMeasurementRoot(service);
    await flush();
    const oldRequest = latest();
    service.configureBubble({ sideWidth: 220 });
    await flush();
    expect(latest().request.maxWidth).not.toBe(oldRequest.request.maxWidth);
    oldRequest.onMeasured(dimensions);
    await flush();
    expect(service.bubbleMeasurement).toBeNull();
    const current = latest();
    current.onMeasured(dimensions);
    await flush();
    expect(service.bubbleMeasurement).toMatchObject({ maxWidth: current.request.maxWidth, text: 'motion' });
    expect(mounted.size).toBe(0);
    stop();
    service.dispose();
  });

  it('cleans up immediately on disposal and prevents queued mounts and stale results', async () => {
    const { service, mounted, roots, latest } = setup();
    service.setMotionText('motion');
    const stopBeforeMount = bindBubbleMeasurementRoot(service);
    stopBeforeMount();
    await flush();
    expect(roots).toHaveLength(0);
    const stop = bindBubbleMeasurementRoot(service);
    await flush();
    const pending = latest();
    pending.onMeasured(dimensions);
    stop();
    await flush();
    expect(service.bubbleMeasurement).toBeNull();
    expect(mounted.size).toBe(0);
    expect(roots[0].unmount).toHaveBeenCalledOnce();
    service.setMotionText('after disposal');
    await flush();
    expect(roots).toHaveLength(1);
    service.dispose();
  });
});
