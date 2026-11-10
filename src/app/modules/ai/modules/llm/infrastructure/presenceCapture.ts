import type { PresenceExpression } from '../domain/presenceState';

interface WorkerResponse {
  type: 'ready' | 'expression' | 'error';
  expression?: PresenceExpression;
  message?: string;
}

const assetUrl = (path: string): string => new URL(path, window.location.href).href;

export const createPresenceCapture = (handlers: {
  onExpression: (expression: PresenceExpression) => void;
  onError: (error: Error) => void;
}) => {
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let worker: Worker | null = null;
  let timer = 0;
  let stopped = true;

  const stop = async () => {
    stopped = true;
    window.clearInterval(timer);
    timer = 0;
    worker?.terminate();
    worker = null;
    video?.pause();
    if (video) video.srcObject = null;
    video = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const start = async () => {
    if (!stopped && stream) return;
    stopped = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
      });
      if (stopped) { await stop(); return; }
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (stopped) { await stop(); return; }
      worker = new Worker(new URL('./presence.worker.ts', import.meta.url), { type: 'module' });
      const ready = new Promise<void>((resolve, reject) => {
        worker!.onmessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === 'ready') resolve();
          else if (event.data.type === 'error') reject(new Error(event.data.message || '面部状态识别失败'));
        };
        worker!.onerror = () => reject(new Error('面部状态识别失败'));
      });
      worker.postMessage({
        type: 'init',
        wasmBase: assetUrl('presence/wasm').replace(/\/$/, ''),
        modelPath: assetUrl('presence/face_landmarker.task'),
      });
      await ready;
      if (stopped || !worker) { await stop(); return; }
      const activeWorker = worker;
      activeWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'expression' && event.data.expression) handlers.onExpression(event.data.expression);
        else if (event.data.type === 'error') handlers.onError(new Error(event.data.message || '面部状态识别失败'));
      };
      timer = window.setInterval(() => {
        if (!video || video.readyState < 2) return;
        void createImageBitmap(video).then((bitmap) => {
          if (stopped) { bitmap.close(); return; }
          activeWorker.postMessage({ type: 'frame', bitmap }, [bitmap]);
        }).catch((error: unknown) => {
          handlers.onError(error instanceof Error ? error : new Error(String(error)));
        });
      }, 1000);
    } catch (error) {
      await stop();
      throw error instanceof Error ? error : new Error(String(error));
    }
  };

  return { start, stop };
};
