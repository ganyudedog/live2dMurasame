import type { GlobalUiSettings } from '../../domain/types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';

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
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">参数设置</h1>
        <p className="text-xs text-base-content/60">模型的全局行为参数</p>
      </div>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-4">
        <header>
          <div className="text-sm font-medium">显示与交互</div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="label cursor-pointer justify-between border border-base-300 rounded-box px-3 py-2">
            <span className="label-text text-sm">忽略鼠标</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={ignoreMouse.draft}
              onChange={(e) => ignoreMouse.commit(e.target.checked)}
            />
          </label>

          <label className="label cursor-pointer justify-between border border-base-300 rounded-box px-3 py-2">
            <span className="label-text text-sm">悬浮显示拖动</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={showDragHandleOnHover.draft}
              onChange={(e) => showDragHandleOnHover.commit(e.target.checked)}
            />
          </label>

          <label className="label cursor-pointer justify-between border border-base-300 rounded-box px-3 py-2">
            <span className="label-text text-sm">开机自启动</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={autoLaunch.draft}
              onChange={(e) => autoLaunch.commit(e.target.checked)}
            />
          </label>

          <label className="label cursor-pointer justify-between border border-base-300 rounded-box px-3 py-2">
            <span className="label-text text-sm">强制跟随</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={forcedFollow.draft}
              onChange={(e) => forcedFollow.commit(e.target.checked)}
            />
          </label>

          <label className="label cursor-pointer justify-between border border-base-300 rounded-box px-3 py-2">
            <span className="label-text text-sm">调试模式</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={debugModeEnabled.draft}
              onChange={(e) => debugModeEnabled.commit(e.target.checked)}
            />
          </label>
        </div>

        <div className="text-xs text-base-content/60">
          说明：这些设置会影响模型的显示与交互行为。
        </div>
      </section>
    </div>
  );
}
