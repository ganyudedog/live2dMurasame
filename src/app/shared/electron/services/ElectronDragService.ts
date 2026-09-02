import { actionBound, makeObservable, observable, observableRef, reaction, runInAction, type IReactionDisposer } from 'mobx';
import type { ElectronBridgeService } from './ElectronBridgeService';

type DragCommand = {
  id: number;
  action: 'start' | 'end';
  reason: string;
};

type NativeDragEndListener = (payload: PetWindowDragPayload) => void;

/**
 * Converts observable gesture state into low-frequency start/end IPC commands.
 * Cursor sampling and window position writes remain exclusively in Electron main.
 */
export class ElectronDragService {
  active = false;
  command: DragCommand | null = null;
  nativeEndCount = 0;

  private readonly bridge: ElectronBridgeService;
  private commandId = 0;
  private commandReaction: IReactionDisposer | null = null;
  private removeNativeListener: (() => void) | null = null;
  private readonly nativeEndListeners = new Set<NativeDragEndListener>();

  constructor(bridge: ElectronBridgeService) {
    this.bridge = bridge;
    makeObservable(this, {
      active: observable,
      command: observableRef,
      nativeEndCount: observable,
      setActive: actionBound,
    });
  }

  start(): void {
    this.commandReaction = reaction(
      () => this.command,
      (command) => {
        if (!command) return;
        this.bridge.sendWindowDrag({
          action: command.action,
          source: 'renderer',
          reason: command.reason,
        });
      },
    );

    this.removeNativeListener = this.bridge.onWindowDrag((payload) => {
      if (payload.action !== 'end') return;
      runInAction(() => {
        this.active = false;
        this.nativeEndCount += 1;
      });
      for (const listener of this.nativeEndListeners) listener(payload);
    });
  }

  setActive(active: boolean, reason: string): void {
    if (this.active === active) return;
    this.active = active;
    this.command = {
      id: ++this.commandId,
      action: active ? 'start' : 'end',
      reason,
    };
  }

  subscribeNativeEnd(listener: NativeDragEndListener): () => void {
    this.nativeEndListeners.add(listener);
    return () => this.nativeEndListeners.delete(listener);
  }

  dispose(): void {
    if (this.active) {
      this.bridge.sendWindowDrag({ action: 'end', source: 'renderer', reason: 'electron-service-dispose' });
    }
    this.active = false;
    this.commandReaction?.();
    this.commandReaction = null;
    this.removeNativeListener?.();
    this.removeNativeListener = null;
    this.nativeEndListeners.clear();
  }
}
