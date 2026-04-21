import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PetCanvas from './renderer/components/pet/PetCanvas.tsx';
import ControlPanel from './renderer/components/controlPanel/ControlPanel.tsx';;
import DemoRoot from './demo/DemoRoot';
import TtsTestPage from './renderer/components/ttsTest/TtsTestPage.tsx';
import { Toaster, toast } from 'react-hot-toast';
import './app.css';

import { info } from './renderer/utils/log';

const searchParams = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search)
  : new URLSearchParams();

const isControlPanelView = searchParams.get('window') === 'control-panel';
const isDemoView = searchParams.get('window') === 'demo';
const isTtsTestView = searchParams.get('window') === 'test';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

const windowType: 'pet' | 'control-panel' | 'demo' | 'test' = isDemoView
  ? 'demo'
  : (isControlPanelView ? 'control-panel' : (isTtsTestView ? 'test' : 'pet'));


info('renderer', 'boot', {
  windowType,
  href: typeof window !== 'undefined' ? window.location.href : undefined,
});

if (typeof window !== 'undefined') {
  // 全局兜底：确保未捕获异常也能有 toast，方便调试。
  window.addEventListener('error', (event) => {
    const message = event?.error instanceof Error
      ? event.error.message
      : (event?.message || '发生未知错误');
    toast.error(String(message));
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? 'Promise 未处理异常');
    toast.error(message);
  });
}

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

export function TtsTestRoot() {
  return (
    <div className="w-screen h-screen overflow-auto relative pointer-events-auto bg-slate-950 text-slate-100">
      <TtsTestPage />
    </div>
  );
}

const ActiveRoot = isDemoView
  ? DemoRoot
  : (isControlPanelView ? ControlPanelRoot : (isTtsTestView ? TtsTestRoot : Root));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  </StrictMode>
);
