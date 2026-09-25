import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'react-hot-toast';
import { AppRoot } from './AppRoot';
import { resolveWindowKind } from './core/resolveWindowKind';
import { bootstrapRenderer } from './core/bootstrapRenderer';
import { ServiceProvider } from './core/ServiceProvider';
import type { LogService } from './shared/logging/LogService';
import { TOKENS } from './core/serviceTokens';
import { BubbleMeasurementRoot } from './modules/live2d/ui/BubbleMeasurementRoot';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const installGlobalErrorLogging = (log: LogService): void => {
  window.addEventListener('error', (event) => {
    const message = event.error instanceof Error ? event.error.message : (event.message || '发生未知错误');
    toast.error(String(message));
    log.captureException(event.error ?? new Error(String(message)), {
      origin: 'window.error',
      data: {
        message: String(message),
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? 'Promise 未处理异常');
    toast.error(message);
    log.captureException(reason, {
      origin: 'window.unhandledrejection',
      data: { message },
    });
  });
};

export const mountApplication = async (): Promise<void> => {
  const windowKind = resolveWindowKind(window.location.search);
  const application = await bootstrapRenderer(windowKind);
  const log = application.container.resolve(TOKENS.log);
  installGlobalErrorLogging(log);
  const mountContext = log.contextRegistry.register('renderer', {
    relation: 'mount',
    params: { windowKind, href: window.location.href },
    behavior: '挂载 renderer 应用并完成 UI 初始化',
  });
  const mountTrace = mountContext.beginTrace('mountApplication');
  mountTrace.end({ windowKind, href: window.location.href });
  mountContext.dispose();

  const host = document.getElementById('root');
  if (!host) throw new Error('Application root element is missing');
  const mainRoot = createRoot(host);
  mainRoot.render(
    <StrictMode>
      <ServiceProvider container={application.container}>
        <QueryClientProvider client={queryClient}>
          <Toaster position="top-center" toastOptions={{ style: { fontSize: '14px' } }} />
          <AppRoot windowKind={windowKind} />
        </QueryClientProvider>
      </ServiceProvider>
    </StrictMode>,
  );

  // The measurement tree is deliberately isolated from the visible tree. Browser layout
  // stays in UI infrastructure while Live2dService receives only stable numeric dimensions.
  let measurementHost: HTMLDivElement | null = null;
  let measurementRoot: ReturnType<typeof createRoot> | null = null;
  if (windowKind === 'pet') {
    measurementHost = document.createElement('div');
    measurementHost.dataset.role = 'bubble-measurement-root';
    document.body.appendChild(measurementHost);
    measurementRoot = createRoot(measurementHost);
    measurementRoot.render(
      <StrictMode>
        <ServiceProvider container={application.container}>
          <BubbleMeasurementRoot />
        </ServiceProvider>
      </StrictMode>,
    );
  }

  window.addEventListener('pagehide', () => {
    measurementRoot?.unmount();
    measurementHost?.remove();
    mainRoot.unmount();
    void application.dispose();
  }, { once: true });
};
