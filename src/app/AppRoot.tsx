import type { WindowKind } from './core/di/module';
import ControlPanel from './modules/control-panel/ui/ControlPanel';
import DemoRoot from './modules/demo/ui/DemoRoot';
import PetCanvas from './modules/live2d/ui/PetCanvas';
import { TtsTestPage } from './modules/tts-test/ui/TtsTestPage';

export const AppRoot = ({ windowKind }: { windowKind: WindowKind }) => {
  if (windowKind === 'control-panel') {
    return (
      <div className="w-screen h-screen overflow-hidden relative pointer-events-auto">
        <ControlPanel />
      </div>
    );
  }
  if (windowKind === 'test') {
    return (
      <div className="w-screen h-screen overflow-auto relative pointer-events-auto bg-slate-950 text-slate-100">
        <TtsTestPage />
      </div>
    );
  }
  if (windowKind === 'demo') return <DemoRoot />;
  return (
    <div className="w-screen h-screen overflow-hidden select-none relative">
      <PetCanvas />
    </div>
  );
};
