export class ElectronBridgeService {
  getConfigSnapshot(): PetConfigSnapshot | null {
    return window.ConfigAPI?.getSnapshot?.() ?? null;
  }

  get configApi(): PetConfigAPI | undefined {
    return window.ConfigAPI;
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
    const dispose = window.WindowAPI?.on?.('pet:windowDrag', callback);
    return typeof dispose === 'function' ? dispose : () => undefined;
  }

  mirrorLog(payload: PetDebugTracePayload): void {
    window.SystemAPI?.debugTrace?.(payload);
  }
}
