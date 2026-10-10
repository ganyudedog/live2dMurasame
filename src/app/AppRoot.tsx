import type { WindowKind } from './core/di/module';
import ControlPanel from './modules/control-panel/ui/ControlPanel';
import PetCanvas from './modules/live2d/ui/PetCanvas';

export const AppRoot = ({ windowKind }: { windowKind: WindowKind }) => {
  if (windowKind === 'control-panel') {
    return (
      <div className="w-screen h-screen overflow-hidden relative pointer-events-auto">
        <ControlPanel />
      </div>
    );
  }
  return (
    <div className="w-screen h-screen overflow-hidden select-none relative">
      <PetCanvas />
    </div>
  );
};
