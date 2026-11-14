import type { ControlPanelService } from '@app/modules/control-panel/service/ControlPanelService';
import type { ControlPanelHostApi } from '../../types';

export const createControlPanelHost = (controlPanel: ControlPanelService): ControlPanelHostApi => ({
  getActiveTab: () => controlPanel.activeTab,
  openTab: (tabId) => controlPanel.setActiveTab(tabId),
});
