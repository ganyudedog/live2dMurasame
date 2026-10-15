import type { Live2dActionService } from '../service/Live2dActionService';

interface RuntimeModel {
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
}

// 不修改 SDK 的 Idle、呼吸和初始动作，只在顶点计算前合成远程覆盖。
export const attachActionRuntime = (model: RuntimeModel, actions: Live2dActionService): (() => void) => {
  const tick = () => {
    try { actions.tick(); }
    catch (error) { actions.reportRuntimeFailure(error); }
  };
  model.on('beforeModelUpdate', tick);
  actions.runtimeAttached(true);
  return () => {
    model.off('beforeModelUpdate', tick);
    actions.runtimeAttached(false);
  };
};
