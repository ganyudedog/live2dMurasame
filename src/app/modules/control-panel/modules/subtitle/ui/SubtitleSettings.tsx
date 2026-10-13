import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { normalizeSubtitleSettings, normalizePushToTalk, type SubtitleSettings as Settings, type PushToTalkSettings } from '../../../../../../../shared/subtitleSettings.js';

export function SubtitleSettings({ config, onChange }: {
  config: PetGlobalModelConfig;
  onChange: (patch: PetGlobalModelConfigPayload) => Promise<unknown>;
}) {
  const settings = normalizeSubtitleSettings(config.subtitle);
  const hotkey = normalizePushToTalk(config.pushToTalk);
  const [preview, setPreview] = useState(false);
  const report = (error: unknown) => toast.error(String(error instanceof Error ? error.message : error));
  const update = (patch: Partial<Settings>) => { void window.SubtitleAPI?.updateSettings(patch).catch(report); };
  const keyUpdate = (patch: Partial<PushToTalkSettings>) => { void onChange({ pushToTalk: { ...hotkey, ...patch } }).catch(report); };
  return <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-4">
    <div><h2 className="text-sm font-medium">桌面语音字幕</h2><p className="text-xs text-base-content/60">固定两行，拖动窗口边缘调整大小和字号；语音识别完成后自动发送。</p></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {([['enabled', '显示语音字幕'], ['alwaysOnTop', '始终置顶'], ['locked', '锁定位置并穿透鼠标']] as const).map(([key, label]) =>
        <label key={key} className="label cursor-pointer justify-between"><span className="label-text text-sm">{label}</span>
          <input type="checkbox" className="toggle toggle-sm" checked={settings[key]} onChange={(event) => update({ [key]: event.target.checked })} /></label>)}
      <label className="label justify-between"><span className="label-text text-sm">文字颜色</span><input aria-label="字幕文字颜色" type="color" value={settings.textColor} onChange={(event) => update({ textColor: event.target.value })} /></label>
      <label className="label justify-between"><span className="label-text text-sm">描边颜色</span><input aria-label="字幕描边颜色" type="color" value={settings.outlineColor} onChange={(event) => update({ outlineColor: event.target.value })} /></label>
      <label className="form-control"><span className="label-text text-xs">背景透明度</span><input type="range" min="0" max="0.8" step="0.02" value={settings.backgroundOpacity} onChange={(event) => update({ backgroundOpacity: Number(event.target.value) })} /></label>
      <label className="form-control"><span className="label-text text-xs">最终结果停留（秒）</span><input type="number" className="input input-sm input-bordered" min="0.5" max="5" step="0.5" value={settings.holdMs / 1000} onChange={(event) => update({ holdMs: Number(event.target.value) * 1000 })} /></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-sm btn-outline" onClick={() => {
        const next = !preview;
        void window.SubtitleAPI?.preview(next).then(() => setPreview(next)).catch(report);
      }}>{preview ? '结束预览' : '预览并调整位置'}</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void window.SubtitleAPI?.resetPosition().catch(report)}>恢复默认位置</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void window.SubtitleAPI?.resetAppearance().catch(report)}>恢复默认外观</button>
    </div>
    <p className="text-xs text-base-content/60">尺寸 280×64～960×160，字号随尺寸调整为 14～28px。解锁后整块字幕均可拖动；锁定后不影响下面的软件。</p>
    <div className="border-t border-base-300 pt-3 space-y-3">
      <label className="label cursor-pointer justify-between"><span className="label-text text-sm">按住快捷键说话</span><input type="checkbox" className="toggle toggle-sm" checked={hotkey.enabled} onChange={(event) => keyUpdate({ enabled: event.target.checked })} /></label>
      <label className="form-control"><span className="label-text text-xs">按键</span><select className="select select-sm select-bordered" value={hotkey.key} onChange={(event) => keyUpdate({ key: event.target.value as PushToTalkSettings['key'] })}>
        <option value="Backquote">` / ~ 键</option><option value="ControlRight">右 Ctrl</option><option value="F8">F8</option>
      </select></label>
      <p className="text-xs text-base-content/60">Windows 下全局生效，按住临时开启，松开完成识别并恢复原状态。麦克风持续开启时仍保持开启。Fn 没有通用系统键码，建议使用上面的按键；快捷键不会拦截其他软件的按键输入。</p>
    </div>
  </section>;
}
