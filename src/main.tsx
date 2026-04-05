import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PetCanvas from './renderer/components/pet/PetCanvas.tsx';
import ControlPanel from './renderer/components/controlPanel/ControlPanel.tsx';;
import DemoRoot from './demo/DemoRoot';
import { Toaster } from 'react-hot-toast';
import './app.css';

import { info } from './renderer/utils/log';

const searchParams = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search)
  : new URLSearchParams();

const isControlPanelView = searchParams.get('window') === 'control-panel';
const isDemoView = searchParams.get('window') === 'demo';

const windowType: 'pet' | 'control-panel' | 'demo' = isDemoView
  ? 'demo'
  : (isControlPanelView ? 'control-panel' : 'pet');


info('renderer', 'boot', {
  windowType,
  href: typeof window !== 'undefined' ? window.location.href : undefined,
});

export function Root() {
  return (
    <div className="w-screen h-screen overflow-hidden select-none relative">
      <PetCanvas />
    </div>
  );
}

export function ControlPanelRoot() {
  return (
    <div className="w-screen h-screen overflow-hidden relative pointer-events-auto">
      <ControlPanel />
    </div>
  );
}

const ActiveRoot = isDemoView ? DemoRoot : (isControlPanelView ? ControlPanelRoot : Root);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toaster
      position="top-center"
      toastOptions={{
        style: {
          fontSize: '14px',
          fontFamily: 'Inter, "Microsoft YaHei", system-ui, -apple-system, sans-serif',
          borderRadius: '16px',
        },
      }}
    />
    <ActiveRoot />
  </StrictMode>
);
