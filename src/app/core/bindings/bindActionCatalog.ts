import { reaction } from 'mobx';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { Live2dActionService } from '@app/modules/live2d/modules/actions/service/Live2dActionService';

/** Electron 注入的已保存配置和预览指令在组合层接入同一个参数执行器。 */
export const bindActionCatalog = (config: ConfigService, live2d: { actions: Live2dActionService }, modelApi?: {
  onPreviewAction?: (callback: (payload: { modelPath: string; actionId: string }) => void) => (() => void) | void;
}): (() => void) => {
  const actions = live2d.actions;
  const offConfig = reaction(() => config.modelConfig?.actions,
    (catalog) => actions.setActionCatalog(catalog ?? []), { fireImmediately: true });
  const offPreview = modelApi?.onPreviewAction?.((payload) => {
    if (payload.modelPath !== config.activeModelPath) return;
    // 预览与日常对话共用轨迹、参数边界、鼠标优先级和回退逻辑。
    actions.dispatch({ actionId: payload.actionId }, actions.getCapability().modelVersion);
  });
  return () => { offConfig(); offPreview?.(); };
};
