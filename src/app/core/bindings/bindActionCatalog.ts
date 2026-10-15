import { reaction } from 'mobx';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';

/** Electron 注入的已保存配置和预览指令在组合层接入同一个参数执行器。 */
export const bindActionCatalog = (config: ConfigService, live2d: Live2dService, modelApi?: PetModelAPI): (() => void) => {
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
