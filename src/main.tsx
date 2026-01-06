import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PetCanvas from './renderer/components/pet/PetCanvas.tsx';
import ControlPanel from './renderer/components/controlPanel/ControlPanel.tsx';;
import './app.css';

const searchParams = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search)
  : new URLSearchParams();

const isControlPanelView = searchParams.get('window') === 'control-panel';

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

const ActiveRoot = isControlPanelView ? ControlPanelRoot : Root;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ActiveRoot />
  </StrictMode>
);
