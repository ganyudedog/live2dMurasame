import type { GlobalUiSettings } from '../../domain/types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';
import { Monitor, MousePointer2 } from 'lucide-react';
import { Page } from '../components/common/Page';
import { SettingsCard, SwitchRow } from '../components/common/SettingsSection';

export default function ModelParamsPage({
  globalSettings,
  onGlobalSettingsChange,
}: {
  globalSettings: GlobalUiSettings;
  onGlobalSettingsChange: (patch: Partial<GlobalUiSettings>) => Promise<void>;
}) {
  const ignoreMouse = useDebouncedRemoteDraft({
    remoteValue: globalSettings.ignoreMouse,
    onCommit: (next) => onGlobalSettingsChange({ ignoreMouse: next }),
  });
  const showDragHandleOnHover = useDebouncedRemoteDraft({
    remoteValue: globalSettings.showDragHandleOnHover,
    onCommit: (next) => onGlobalSettingsChange({ showDragHandleOnHover: next }),
  });
  const autoLaunch = useDebouncedRemoteDraft({
    remoteValue: globalSettings.autoLaunch,
    onCommit: (next) => onGlobalSettingsChange({ autoLaunch: next }),
  });
  const debugModeEnabled = useDebouncedRemoteDraft({
    remoteValue: globalSettings.debugModeEnabled,
    onCommit: (next) => onGlobalSettingsChange({ debugModeEnabled: next }),
  });
  const forcedFollow = useDebouncedRemoteDraft({
    remoteValue: globalSettings.forcedFollow,
    onCommit: (next) => onGlobalSettingsChange({ forcedFollow: next }),
  });

  return (
    <Page title="参数设置" description="桌面角色的全局行为参数，修改后立即生效。">
      <SettingsCard title="显示与交互" icon={<MousePointer2 />} description="这些设置会影响模型在桌面上的显示与交互行为。">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <SwitchRow label="忽略鼠标" hint="模型不再响应鼠标，点击会穿透到下面的窗口"
            checked={ignoreMouse.draft} onChange={ignoreMouse.commit} />
          <SwitchRow label="悬浮显示输入框" hint="鼠标停在模型上时显示输入框"
            checked={showDragHandleOnHover.draft} onChange={showDragHandleOnHover.commit} />
          <SwitchRow label="强制跟随" checked={forcedFollow.draft} onChange={forcedFollow.commit} />
        </div>
      </SettingsCard>

      <SettingsCard title="系统" icon={<Monitor />}>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <SwitchRow label="开机自启动" hint="登录系统后自动启动桌面角色"
            checked={autoLaunch.draft} onChange={autoLaunch.commit} />
          <SwitchRow label="调试模式" hint="在模型上叠加布局与点击区域的调试遮罩"
            checked={debugModeEnabled.draft} onChange={debugModeEnabled.commit} />
        </div>
      </SettingsCard>
    </Page>
  );
}
