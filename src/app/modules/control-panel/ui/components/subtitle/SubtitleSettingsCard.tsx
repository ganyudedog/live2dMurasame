import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Captions, Keyboard, Move, RotateCcw, Square } from 'lucide-react';
import { Field, SettingsCard, SwitchRow } from '../common/SettingsSection.js';
import { Button } from '../common/Button';
import { Input, Range, Select } from '../common/FormControls';
import { Switch } from '../common/Switch';
import { normalizeSubtitleSettings, normalizePushToTalk, type SubtitleSettings as Settings, type PushToTalkSettings } from '../../../../../../../shared/subtitle/subtitleSettings.js';

const SWATCH = 'color-swatch shrink-0';

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

  // 预览状态由主进程持有，页面只是它的镜像：重新挂载时按实际状态恢复，
  // 否则切走再切回来按钮会显示成"预览并调整位置"，而字幕其实还在预览。
  useEffect(() => {
    let alive = true;
    void window.SubtitleAPI?.getState()
      .then((state) => { if (alive) setPreview(state.phase === 'preview'); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return <>
    <SettingsCard title="语音字幕" icon={<Captions />} description="识别结果先以浮层显示，确认后再发送给模型。"
      actions={<label className="flex cursor-pointer items-center gap-2">
        <span className="text-xs text-muted-foreground">显示语音字幕</span>
        <Switch checked={settings.enabled} aria-label="显示语音字幕"
          onCheckedChange={(enabled) => update({ enabled })} />
      </label>}>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <SwitchRow label="始终置顶" hint="盖在其他窗口上方" checked={settings.alwaysOnTop}
          onChange={(alwaysOnTop) => update({ alwaysOnTop })} />
        <SwitchRow label="锁定位置并穿透鼠标" hint="锁定后不影响下面的窗口" checked={settings.locked}
          onChange={(locked) => update({ locked })} />
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
          <span className="text-xs font-medium">文字颜色</span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">{settings.textColor}</span>
            <input aria-label="字幕文字颜色" type="color" className={SWATCH}
              value={settings.textColor} onChange={(event) => update({ textColor: event.target.value })} />
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
          <span className="text-xs font-medium">描边颜色</span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">{settings.outlineColor}</span>
            <input aria-label="字幕描边颜色" type="color" className={SWATCH}
              value={settings.outlineColor} onChange={(event) => update({ outlineColor: event.target.value })} />
          </span>
        </div>

        <Field label="背景透明度" hint="0% 完全透明，只留文字和描边">
          <div className="flex h-8 items-center gap-3">
            <Range min="0" max="0.8" step="0.02" className="min-w-0 flex-1"
              aria-label="字幕背景透明度"
              value={settings.backgroundOpacity}
              onChange={(event) => update({ backgroundOpacity: Number(event.target.value) })} />
            <span className="w-10 shrink-0 rounded-md bg-muted py-0.5 text-center font-mono text-[11px] tabular-nums">
              {Math.round(settings.backgroundOpacity * 100)}%
            </span>
          </div>
        </Field>
        <Field label="最终结果停留" hint="识别结果在字幕上停留多久">
          <div className="flex items-center gap-2">
            <Input type="number" min="0.5" max="5" step="0.5" className="w-24"
              aria-label="字幕结果停留秒数"
              value={settings.holdMs / 1000}
              onChange={(event) => update({ holdMs: Number(event.target.value) * 1000 })} />
            <span className="text-xs text-muted-foreground">秒</span>
          </div>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant={preview ? 'primary' : 'outline'} onClick={() => {
          const next = !preview;
          void window.SubtitleAPI?.preview(next).then(() => setPreview(next)).catch(report);
        }}>{preview ? <><Square />结束预览</> : <><Move />预览并调整位置</>}</Button>
        <Button variant="ghost"
          onClick={() => void window.SubtitleAPI?.resetPosition().catch(report)}><RotateCcw />恢复默认位置</Button>
        <Button variant="ghost"
          onClick={() => void window.SubtitleAPI?.resetAppearance().catch(report)}><RotateCcw />恢复默认外观</Button>
        <span className="ml-auto text-[11px] leading-relaxed text-muted-foreground">
          解锁后整块字幕都能拖动。
        </span>
      </div>
    </SettingsCard>

    <SettingsCard title="按住说话" icon={<Keyboard />} description="临时开启麦克风，松开即完成一次识别。Windows 下全局生效。"
      actions={<label className="flex cursor-pointer items-center gap-2">
        <span className="text-xs text-muted-foreground">启用</span>
        <Switch checked={hotkey.enabled} aria-label="启用按住说话"
          onCheckedChange={(enabled) => keyUpdate({ enabled })} />
      </label>}>
      <Field label="触发按键" className="sm:max-w-60">
        <Select value={hotkey.key}
          onChange={(event) => keyUpdate({ key: event.target.value as PushToTalkSettings['key'] })}>
          <option value="Backquote">` / ~ 键</option>
          <option value="ControlRight">右 Ctrl</option>
          <option value="F8">F8</option>
        </Select>
      </Field>
    </SettingsCard>
  </>;
}
