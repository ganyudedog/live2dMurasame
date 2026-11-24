/* eslint-disable @typescript-eslint/no-explicit-any */
import { Ticker } from 'pixi.js';

import { debug, info, warn } from '@app/shared/logging/compat';

declare global {
  interface Window { Live2DCubismCore?: unknown }
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
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => {
          s.remove();
          reject(new Error('failed loading ' + url));
        };
        document.head.appendChild(s);
      });
      if (window.Live2DCubismCore) {
        info('pet.live2d', 'cubismCore.loaded', { url });
        return;
      }
    } catch (e) {
      warn('pet.live2d', 'cubismCore.tryFailed', { url, err: String(e) });
    }
  }
  if (!window.Live2DCubismCore) {
    throw new Error('Cubism4 core JS 未找到，请将 live2dcubismcore.min.js 放入 public 根或 public/model 下');
  }
}

async function initializeRuntime() {
  await ensureCubismCore();
  const { Live2DModel } = await import('./runtime');
  Live2DModel.registerTicker(Ticker);
  return Live2DModel;
}

let runtime: ReturnType<typeof initializeRuntime> | undefined;

export async function loadModel(modelPath: string) {
  info('pet.live2d', 'model.load.start', { modelPath, isFileUrl: /^file:/i.test(modelPath) });
  runtime ??= initializeRuntime().catch((error) => {
    runtime = undefined;
    throw error;
  });
  const Live2DModel = await runtime;
  // 预检：确保资源存在。
  // 注意：file:// URL 在 Electron fetch 中不一定支持 HEAD，避免误判直接放行。
  const isFileUrl = /^file:/i.test(modelPath);
  if (!isFileUrl) {
    const head = await fetch(modelPath, { method: 'HEAD' });
    if (!head.ok) {
      throw new Error('Model file not found: ' + modelPath + ' status=' + head.status);
    }
  }
  // 禁用自动交互注册，避免在 Pixi v7 上依赖 legacy interaction manager
  const model = await Live2DModel.from(modelPath, { autoInteract: false });
  const groups = Object.keys((model as any).internalModel?.settings?.motions || {});
  debug('pet.live2d', 'model.load.ok', {
    motionGroupCount: groups.length,
    motionGroupsPreview: groups.slice(0, 5),
  });
  
  return model;
}
