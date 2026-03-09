import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PetCanvas from './renderer/components/pet/PetCanvas.tsx';
import ControlPanel from './renderer/components/controlPanel/ControlPanel.tsx';;
import DemoRoot from './demo/DemoRoot';
import './app.css';

import { info, setContextProvider, setEnabledProvider } from './renderer/utils/log';
import { useConfigStore } from './renderer/store/useConfigStore';

const searchParams = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search)
  : new URLSearchParams();

const isControlPanelView = searchParams.get('window') === 'control-panel';
const isDemoView = searchParams.get('window') === 'demo';

const windowType: 'pet' | 'control-panel' | 'demo' = isDemoView
  ? 'demo'
  : (isControlPanelView ? 'control-panel' : 'pet');

// Renderer logging bootstrap (DevTools-only).
setEnabledProvider(() => {
  try {
    return useConfigStore.getState().globalModelConfig?.debugModeEnabled === true;
  } catch {
    return false;
  }
});

setContextProvider(() => {
  try {
    const config = useConfigStore.getState();
    return {
      windowType,
      scale: config.globalModelConfig?.scale,
      modelKey: config.modelKey,
      activeModelPath: config.activeModelPath,
      activeModelFileUrl: config.activeModelFileUrl,
    };
  } catch {
    return { windowType };
  }
});

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
    <ActiveRoot />
  </StrictMode>
);
