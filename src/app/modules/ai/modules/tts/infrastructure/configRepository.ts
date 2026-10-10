export const readTtsSnapshot = (getSnapshot?: () => PetConfigSnapshot | null | undefined) =>
  getSnapshot?.() ?? window.SnapshotAPI?.getSnapshot?.();
