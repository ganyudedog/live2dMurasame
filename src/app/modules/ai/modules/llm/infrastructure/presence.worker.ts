/// <reference lib="webworker" />
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { classifyFace, type PresenceExpression } from '../domain/presenceState';

interface InitMessage { type: 'init'; wasmBase: string; modelPath: string }
interface FrameMessage { type: 'frame'; bitmap: ImageBitmap }
type WorkerRequest = InitMessage | FrameMessage;
type WorkerResponse =
  | { type: 'ready' }
  | { type: 'expression'; expression: PresenceExpression }
  | { type: 'error'; message: string };

let landmarker: FaceLandmarker | null = null;

const post = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    if (event.data.type === 'init') {
      const vision = await FilesetResolver.forVisionTasks(event.data.wasmBase, true);
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: event.data.modelPath, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      post({ type: 'ready' });
      return;
    }
    const bitmap = event.data.bitmap;
    try {
      if (!landmarker) throw new Error('面部状态识别尚未就绪');
      const result = landmarker.detect(bitmap);
      const categories = result.faceBlendshapes?.[0]?.categories;
      const scores = Object.fromEntries((categories ?? []).map((item) => [item.categoryName, item.score]));
      const expression = result.faceLandmarks?.length ? classifyFace(scores) : 'absent';
      post({ type: 'expression', expression });
    } finally {
      bitmap.close();
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
