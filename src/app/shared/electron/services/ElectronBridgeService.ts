export class ElectronBridgeService {
  getConfigSnapshot(): PetConfigSnapshot | null {
    return window.SnapshotAPI?.getSnapshot?.() ?? null;
  }

  get snapshotApi(): PetSnapshotAPI | undefined {
    return window.SnapshotAPI;
  }

  get live2dEnvApi(): PetLive2dEnvAPI | undefined {
    return window.Live2dEnvAPI;
  }

  get globalApi(): PetGlobalAPI | undefined {
    return window.GlobalAPI;
  }

  get modelApi(): PetModelAPI | undefined {
    return window.ModelAPI;
  }

  get windowApi(): PetWindowAPI | undefined {
    return window.WindowAPI;
  }

  get asrApi(): PetAsrAPI | undefined {
    return window.AsrAPI;
  }

  get aiApi(): PetAIAPI | undefined {
    return window.AIAPI;
  }

  sendWindowDrag(payload: PetWindowDragPayload): void {
    window.WindowAPI?.sendWindowDrag?.(payload);
  }

  onWindowDrag(callback: (payload: PetWindowDragPayload) => void): () => void {
    const dispose = window.WindowAPI?.on?.('ddd:window:drag', callback);
    return typeof dispose === 'function' ? dispose : () => undefined;
  }

  mirrorLog(payload: PetDebugTracePayload): void {
    window.SystemAPI?.debugTrace?.(payload);
  }
}
