/* eslint-disable @typescript-eslint/no-explicit-any */
// 先导入 Cubism4 运行时，再导入主类，避免顺序问题导致回退到 Cubism2
import { Live2DModel } from './runtime';

declare global {
  interface Window { Live2DCubismCore?: any }
}

async function ensureCubismCore() {
  if (window.Live2DCubismCore) return;
  const candidates = [
    '/live2dcubismcore.min.js',
    '/live2dcubismcore.js',
    '/model/live2dcubismcore.min.js',
    '/model/live2dcubismcore.js'
  ];
  for (const url of candidates) {
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) continue;
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => { console.log('[CubismCore] dynamic loaded', url); resolve(); };
        s.onerror = () => reject(new Error('failed loading ' + url));
        document.head.appendChild(s);
      });
      if (window.Live2DCubismCore) return;
    } catch (e) {
      console.warn('[CubismCore] try failed', url, e);
    }
  }
  if (!window.Live2DCubismCore) {
    throw new Error('Cubism4 core JS 未找到，请将 live2dcubismcore.min.js 放入 public 根或 public/model 下');
  }
}

export async function loadModel(modelPath: string) {
  console.log('[Live2D] loading model:', modelPath);
  await ensureCubismCore();
  if (!(Live2DModel as any)) {
    throw new Error('Live2DModel unavailable after runtime import');
  }
  // 预检：确保资源存在
  const head = await fetch(modelPath, { method: 'HEAD' });
  if (!head.ok) {
    throw new Error('Model file not found: ' + modelPath + ' status=' + head.status);
  }
  // 禁用自动交互注册，避免在 Pixi v7 上依赖 legacy interaction manager
  const model = await Live2DModel.from(modelPath, { autoInteract: false });
  console.log('[Live2D] model loaded groups:', Object.keys((model as any).internalModel?.settings?.motions || {}));
  return model;
}
