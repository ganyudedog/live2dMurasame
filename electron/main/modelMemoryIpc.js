export const registerModelMemoryIpc = ({
  ipcMain,
  BrowserWindow,
  getConfigSnapshot,
  loadModelMemory,
  saveModelMemory,
  getModelKeyFromPath,
}) => {
  const resolveTargetModelPath = (value) => {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    const snapshot = getConfigSnapshot();
    return typeof snapshot?.activeModelPath === 'string' && snapshot.activeModelPath.trim()
      ? snapshot.activeModelPath
      : null;
  };

  const createEmptyModelMemoryState = () => ({
    modelPath: null,
    modelKey: null,
    recent: null,
    summary: null,
    meta: null,
  });

  const createModelMemoryState = (modelPath, memory) => {
    if (!modelPath) return createEmptyModelMemoryState();
    return {
      modelPath,
      modelKey: getModelKeyFromPath(modelPath) ?? null,
      recent: memory?.recent ?? null,
      summary: memory?.summary ?? null,
      meta: memory?.meta ?? null,
    };
  };

  const broadcastModelMemoryState = (payload) => {
    if (!payload) return;
    const targets = BrowserWindow.getAllWindows();
    targets.forEach((win) => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send('pet:modelMemoryUpdated', payload);
    });
  };

  ipcMain.handle('pet:getModelMemory', (_event, payload = {}) => {
    const modelPath = resolveTargetModelPath(payload?.modelPath);
    if (!modelPath) {
      return createEmptyModelMemoryState();
    }
    return createModelMemoryState(modelPath, loadModelMemory(modelPath));
  });

  ipcMain.handle('pet:updateModelMemory', (_event, payload = {}) => {
    const modelPath = resolveTargetModelPath(payload?.modelPath);
    if (!modelPath) {
      return createEmptyModelMemoryState();
    }
    const nextState = createModelMemoryState(
      modelPath,
      saveModelMemory(modelPath, {
        recent: payload?.recent,
        summary: payload?.summary,
        meta: payload?.meta,
      }),
    );
    broadcastModelMemoryState(nextState);
    return nextState;
  });
};