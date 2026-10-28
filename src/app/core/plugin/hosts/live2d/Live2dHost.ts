import type { Live2dService } from '@app/modules/live2d/service/Live2dService';
import type { Live2dHostApi } from '../../types';

export const createLive2dHost = (live2d: Live2dService): Live2dHostApi => ({
  getAvailableMotions: () => live2d.getAvailableMotionsSnapshot(),
  playMotion: (group) => live2d.playMotion(group),
  interruptMotion: (group) => live2d.interruptMotion(group),
  getModelState: () => ({ loaded: Boolean(live2d.model), status: live2d.modelLoadStatus }),
});
