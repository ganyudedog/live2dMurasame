import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PetCanvas from './renderer/components/PetCanvas.tsx';
import ControlPanel from './renderer/components/ControlPanel.tsx';
import './app.css';

export function Root() {
  return (
    <div className="w-screen h-screen overflow-hidden select-none relative">
      <PetCanvas />
      <ControlPanel />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
