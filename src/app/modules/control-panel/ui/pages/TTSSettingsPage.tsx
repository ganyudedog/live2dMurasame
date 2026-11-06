import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileMusic, FolderOpen, Server, SlidersHorizontal } from 'lucide-react';
import type { ModelConfig } from '../../domain/types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';
import { Field, SettingsCard } from '../components/common/SettingsSection';
import { Input, Select, Textarea } from '../components/common/FormControls';
import { Button } from '../components/common/Button';
import { Switch } from '../components/common/Switch';

type TtsUiDraft = ModelConfig['tts'];

type SliderState = Pick<TtsUiDraft, 'speedFactor' | 'fragmentInterval' | 'topK' | 'topP' | 'temperature'>;
type SliderKey = keyof SliderState;
type SliderStepState = Record<SliderKey, number>;

const SLIDER_LIMITS: Record<SliderKey, { min: number; max: number; integer?: boolean }> = {
  speedFactor: { min: 0, max: 2 },
  fragmentInterval: { min: 0, max: 0.5 },
  topK: { min: 1, max: 100, integer: true },
  topP: { min: 0, max: 1 },
  temperature: { min: 0, max: 1 },
};

const DEFAULT_SLIDER_STEPS: SliderStepState = {
  speedFactor: 0.01,
  fragmentInterval: 0.01,
  topK: 1,
  topP: 0.01,
  temperature: 0.01,
};

const SLIDER_FIELDS: ReadonlyArray<{ key: SliderKey; label: string }> = [
  { key: 'speedFactor', label: '语言速度' },
  { key: 'fragmentInterval', label: '片段间隔' },
  { key: 'topK', label: 'topK' },
  { key: 'topP', label: 'topP' },
  { key: 'temperature', label: 'temperature' },
];

const buildSliderState = (draft: TtsUiDraft): SliderState => ({
  speedFactor: draft.speedFactor,
  fragmentInterval: draft.fragmentInterval,
  topK: draft.topK,
  topP: draft.topP,
  temperature: draft.temperature,
});

const normalizeTextSplitMode = (value: unknown): TtsUiDraft['textSplitMode'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'cut0' || normalized === 'cut1' || normalized === 'cut2'
    || normalized === 'cut3' || normalized === 'cut4' || normalized === 'cut5') {
    return normalized as TtsUiDraft['textSplitMode'];
  }
  return 'cut5';
};

const LANG_OPTIONS: Array<{ label: string; value: TtsUiDraft['textLang'] }> = [
  { label: '中文', value: 'all_zh' },
  { label: '日语', value: 'all_ja' },
  { label: '英语', value: 'all_en' },
  { label: '韩语', value: 'all_ko' },
  { label: '粤语', value: 'all_yue' },
];

const SPLIT_OPTIONS: Array<{ label: string; value: TtsUiDraft['textSplitMode'] }> = [
  { label: '不切', value: 'cut0' },
  { label: '凑四句一切', value: 'cut1' },
  { label: '凑 50 字一切', value: 'cut2' },
  { label: '按中文句号切', value: 'cut3' },
  { label: '按英文句号切', value: 'cut4' },
  { label: '按标点符号切', value: 'cut5' },
];

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

const toNumber = (value: string, fallback: number) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isSameTtsDraft = (left: TtsUiDraft, right: TtsUiDraft) => {
  return (
    left.enabled === right.enabled
    && left.baseUrl === right.baseUrl
    && left.gptWeightsPath === right.gptWeightsPath
    && left.sovitsWeightsPath === right.sovitsWeightsPath
    && left.textLang === right.textLang
    && left.promptLang === right.promptLang
    && left.refAudioPath === right.refAudioPath
    && left.refAudioText === right.refAudioText
    && left.textSplitMode === right.textSplitMode
    && left.speedFactor === right.speedFactor
    && left.fragmentInterval === right.fragmentInterval
    && left.topK === right.topK
    && left.topP === right.topP
    && left.temperature === right.temperature
  );
};

/** 路径输入 + 右侧选择文件按钮，两者拼成一个整体控件。 */
function PathInput({ value, placeholder, onChange, onPick }: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onPick: () => void;
}) {
  return <div className="flex min-w-0">
    <Input className="rounded-r-none font-mono" value={value} placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)} />
    <Button className="h-8 rounded-l-none border-l-0" onClick={onPick}><FolderOpen />选择文件</Button>
  </div>;
}

export default function TTSSettingsPage({
  modelConfig,
  onTtsConfigChange,
  onPickPath,
}: {
  modelConfig: ModelConfig;
  onTtsConfigChange: (next: TtsUiDraft) => Promise<void>;
  onPickPath: (kind: 'gpt' | 'sovits' | 'ref') => Promise<string | null>;
}) {
  const remoteTtsConfig = useMemo<TtsUiDraft>(() => ({
    ...modelConfig.tts,
    textSplitMode: normalizeTextSplitMode(modelConfig.tts.textSplitMode),
  }), [modelConfig.tts]);

  const commitTtsConfig = useCallback(async (nextTts: TtsUiDraft) => {
    await onTtsConfigChange(nextTts);
  }, [onTtsConfigChange]);

  const ttsDraft = useDebouncedRemoteDraft<TtsUiDraft>({
    remoteValue: remoteTtsConfig,
    debounceMs: 260,
    isEqual: isSameTtsDraft,
    onCommit: commitTtsConfig,
  });

  const draft = ttsDraft.draft;
  // 拖动条的所有state聚合
  const [sliderPreviewState, setSliderPreviewState] = useState<SliderState | null>(null);
  const draftRef = useRef(draft);
  const sliderPendingPatchRef = useRef<Partial<SliderState>>({});
  const sliderDebounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // 同步拖动条的变更
  const flushSliderPatch = useCallback((clearPreview = false) => {
    if (sliderDebounceTimerRef.current != null) {
      window.clearTimeout(sliderDebounceTimerRef.current);
      sliderDebounceTimerRef.current = null;
    }

    const patch = sliderPendingPatchRef.current;
    const patchKeys = Object.keys(patch);
    if (!patchKeys.length) {
      if (clearPreview) {
        setSliderPreviewState(null);
      }
      return;
    }

    sliderPendingPatchRef.current = {};
    ttsDraft.commit({
      ...draftRef.current,
      ...patch,
    });
    if (clearPreview) {
      setSliderPreviewState(null);
    }
  }, [ttsDraft]);

  // 防抖合并频繁的变更，避免在拖动过程中频繁提交更新导致性能问题，同时在组件卸载时确保变更被提交。
  const scheduleSliderPatch = useCallback((patch: Partial<SliderState>) => {
    sliderPendingPatchRef.current = {
      ...sliderPendingPatchRef.current,
      ...patch,
    };

    if (sliderDebounceTimerRef.current != null) {
      window.clearTimeout(sliderDebounceTimerRef.current);
      sliderDebounceTimerRef.current = null;
    }

    sliderDebounceTimerRef.current = window.setTimeout(() => {
      flushSliderPatch(false);
    }, 180);
  }, [flushSliderPatch]);

  useEffect(() => {
    return () => {
      flushSliderPatch(false);
    };
  }, [flushSliderPatch]);

  const sliderState = sliderPreviewState ?? buildSliderState(draft);

  const updateSliderValue = useCallback((key: SliderKey, rawValue: string, fallback: number) => {
    const limits = SLIDER_LIMITS[key];
    let next = clamp(toNumber(rawValue, fallback), limits.min, limits.max);
    if (limits.integer) {
      next = Math.round(next);
    }

    setSliderPreviewState((prev) => ({
      ...(prev ?? buildSliderState(draftRef.current)),
      [key]: next,
    }));
    scheduleSliderPatch({ [key]: next } as Partial<SliderState>);
  }, [scheduleSliderPatch]);

  const pickPath = async (kind: 'gpt' | 'sovits' | 'ref') => {
    const picked = await onPickPath(kind);
    if (!picked) return;
    if (kind === 'gpt') {
      ttsDraft.commit({ ...draft, gptWeightsPath: picked });
      return;
    }
    if (kind === 'sovits') {
      ttsDraft.commit({ ...draft, sovitsWeightsPath: picked });
      return;
    }
    ttsDraft.commit({ ...draft, refAudioPath: picked });
  };

  return (
    <div className="space-y-4">
      <SettingsCard title="合成服务" icon={<Server />}
        actions={<label className="flex cursor-pointer items-center gap-2">
          <span className="text-xs text-muted-foreground">启用 TTS</span>
          <Switch checked={draft.enabled} aria-label="启用 TTS"
            onCheckedChange={(enabled) => ttsDraft.commit({ ...draft, enabled })} />
        </label>}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Provider">
            <Input value="gpt-sovits" disabled />
          </Field>

          <Field label="服务地址">
            <Input className="font-mono" value={draft.baseUrl} placeholder="http://127.0.0.1:9880"
              onChange={(e) => ttsDraft.commit({ ...draft, baseUrl: e.target.value })} />
          </Field>

          <Field label="文本语言">
            <Select value={draft.textLang}
              onChange={(e) => ttsDraft.commit({ ...draft, textLang: e.target.value as TtsUiDraft['textLang'] })}>
              {LANG_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="参考语言">
            <Select value={draft.promptLang}
              onChange={(e) => ttsDraft.commit({ ...draft, promptLang: e.target.value as TtsUiDraft['promptLang'] })}>
              {LANG_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="文本切分">
            <Select value={draft.textSplitMode}
              onChange={(e) => ttsDraft.commit({ ...draft, textSplitMode: e.target.value as TtsUiDraft['textSplitMode'] })}>
              {SPLIT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </Select>
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard title="数值参数" icon={<SlidersHorizontal />}>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
          {SLIDER_FIELDS.map(({ key, label }) => {
            const limits = SLIDER_LIMITS[key];
            const value = sliderState[key];
            return <label key={key} className="flex flex-col gap-2">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-foreground/80">{label}</span>
                <Input type="number" size="xs" className="w-20 text-right font-mono"
                  min={limits.min} max={limits.max} step={DEFAULT_SLIDER_STEPS[key]}
                  value={limits.integer ? Math.round(value) : value}
                  onChange={(e) => updateSliderValue(key, e.target.value, value)}
                  onBlur={() => flushSliderPatch(true)} />
              </span>
              <input type="range" className="ui-range w-full"
                min={limits.min} max={limits.max} step={DEFAULT_SLIDER_STEPS[key]}
                value={value}
                onChange={(e) => updateSliderValue(key, e.target.value, value)}
                onPointerUp={() => flushSliderPatch(true)}
                onBlur={() => flushSliderPatch(true)} />
              <span className="flex justify-between font-mono text-[10px] text-muted-foreground/70">
                <span>{limits.min}</span>
                <span>{limits.max}</span>
              </span>
            </label>;
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="路径与参考音频" icon={<FileMusic />}>
        <Field label="GPT 权重路径">
          <PathInput value={draft.gptWeightsPath} placeholder="GPT_weights_v2Pro/xxx.ckpt"
            onChange={(value) => ttsDraft.commit({ ...draft, gptWeightsPath: value })}
            onPick={() => pickPath('gpt')} />
        </Field>

        <Field label="SoVITS 权重路径">
          <PathInput value={draft.sovitsWeightsPath} placeholder="SoVITS_weights_v2Pro/xxx.pth"
            onChange={(value) => ttsDraft.commit({ ...draft, sovitsWeightsPath: value })}
            onPick={() => pickPath('sovits')} />
        </Field>

        <Field label="参考音频路径">
          <PathInput value={draft.refAudioPath} placeholder="assets/ref.wav"
            onChange={(value) => ttsDraft.commit({ ...draft, refAudioPath: value })}
            onPick={() => pickPath('ref')} />
        </Field>

        <Field label="参考音频文本">
          {/* 宽度固定、不可拖拽拉伸；高度随内容在 min/max 之间自适应，超出后内部滚动 */}
          <Textarea className="min-h-20 max-h-40 resize-none overflow-y-auto field-sizing-content"
            value={draft.refAudioText}
            placeholder="输入参考音频对应文本"
            onChange={(e) => ttsDraft.commit({ ...draft, refAudioText: e.target.value })} />
        </Field>
      </SettingsCard>
    </div>
  );
}
