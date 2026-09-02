import { describe, expect, it, vi } from 'vitest';
import { ElectronDragService } from './ElectronDragService';
import type { ElectronBridgeService } from './ElectronBridgeService';

describe('ElectronDragService', () => {
  it('reacts to gesture state with one start and one end command', () => {
    const sendWindowDrag = vi.fn();
    const bridge = {
      sendWindowDrag,
      onWindowDrag: () => () => undefined,
    } as unknown as ElectronBridgeService;
    const service = new ElectronDragService(bridge);
    service.start();

    service.setActive(true, 'gesture-confirmed');
    service.setActive(true, 'duplicate-start');
    service.setActive(false, 'gesture-end');

    expect(sendWindowDrag).toHaveBeenCalledTimes(2);
    expect(sendWindowDrag).toHaveBeenNthCalledWith(1, {
      action: 'start',
      source: 'renderer',
      reason: 'gesture-confirmed',
    });
    expect(sendWindowDrag).toHaveBeenNthCalledWith(2, {
      action: 'end',
      source: 'renderer',
      reason: 'gesture-end',
    });
    service.dispose();
  });

  it('accepts a native end without echoing another end command', () => {
    const sendWindowDrag = vi.fn();
    let nativeListener: (payload: PetWindowDragPayload) => void = () => undefined;
    const bridge = {
      sendWindowDrag,
      onWindowDrag: (listener: (payload: PetWindowDragPayload) => void) => {
        nativeListener = listener;
        return () => {
          nativeListener = () => undefined;
        };
      },
    } as unknown as ElectronBridgeService;
    const service = new ElectronDragService(bridge);
    const onNativeEnd = vi.fn();
    service.start();
    service.subscribeNativeEnd(onNativeEnd);
    service.setActive(true, 'gesture-confirmed');

    nativeListener({ action: 'end', source: 'main', reason: 'WM_LBUTTONUP' });
    service.setActive(false, 'gesture-end');

    expect(service.active).toBe(false);
    expect(service.nativeEndCount).toBe(1);
    expect(onNativeEnd).toHaveBeenCalledOnce();
    expect(sendWindowDrag).toHaveBeenCalledTimes(1);
    service.dispose();
  });
});
