import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelConfig } from '../../domain/types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';

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
    && left.useLastGeneratedAsRef === right.useLastGeneratedAsRef
    && left.topK === right.topK
    && left.topP === right.topP
    && left.temperature === right.temperature
  );
};

export default function TTSSettingsPage({
  modelConfig,
  preheatState,
  preheatMessage,
  onTtsConfigChange,
  onPickPath,
}: {
  modelConfig: ModelConfig;
  preheatState: 'idle' | 'pending' | 'ok' | 'failed';
  preheatMessage: string;
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
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">TTS 设置</h1>
        <p className="text-xs text-base-content/60">为当前模型配置语音合成参数。音频格式与流式开关在 AI 设置中全局生效。</p>
      </div>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-4">
        <header className="flex items-center justify-between">
          <div className="text-sm font-medium">基础</div>
          <label className="label cursor-pointer gap-2">
            <span className="label-text text-xs">启用 TTS</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={draft.enabled}
              onChange={(e) => ttsDraft.commit({ ...draft, enabled: e.target.checked })}
            />
          </label>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">Provider</span>
            </div>
            <input type="text" className="input input-sm input-bordered w-full" value="gpt-sovits" disabled />
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">服务地址</span>
            </div>
            <input
              type="text"
              className="input input-sm input-bordered w-full"
              value={draft.baseUrl}
              placeholder="http://127.0.0.1:9880"
              onChange={(e) => ttsDraft.commit({ ...draft, baseUrl: e.target.value })}
            />
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">文本语言</span>
            </div>
            <select
              className="select select-sm select-bordered w-full"
              value={draft.textLang}
              onChange={(e) => ttsDraft.commit({ ...draft, textLang: e.target.value as TtsUiDraft['textLang'] })}
            >
              {LANG_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">参考语言</span>
            </div>
            <select
              className="select select-sm select-bordered w-full"
              value={draft.promptLang}
              onChange={(e) => ttsDraft.commit({ ...draft, promptLang: e.target.value as TtsUiDraft['promptLang'] })}
            >
              {LANG_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">文本切分</span>
            </div>
            <select
              className="select select-sm select-bordered w-full"
              value={draft.textSplitMode}
              onChange={(e) => ttsDraft.commit({ ...draft, textSplitMode: e.target.value as TtsUiDraft['textSplitMode'] })}
            >
              {SPLIT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={draft.useLastGeneratedAsRef}
              onChange={(e) => ttsDraft.commit({ ...draft, useLastGeneratedAsRef: e.target.checked })}
            />
            <span className="label-text text-xs">复用上次生成音频作为参考</span>
          </label>
        </div>
      </section>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
        <header className="text-sm font-medium">数值参数</header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="form-control">
            <div className="w-full grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2 pb-1">
              <span className="label-text text-xs truncate">语言速度</span>
              <div className="w-full">
                <input
                  type="number"
                  className="input input-xs input-bordered w-full text-right tabular-nums"
                  min={SLIDER_LIMITS.speedFactor.min}
                  max={SLIDER_LIMITS.speedFactor.max}
                  step={DEFAULT_SLIDER_STEPS.speedFactor}
                  value={sliderState.speedFactor}
                  onChange={(e) => updateSliderValue('speedFactor', e.target.value, sliderState.speedFactor)}
                  onBlur={() => flushSliderPatch(true)}
                />
              </div>
            </div>
            <input
              type="range"
              className="range range-sm w-full mt-1"
              min={SLIDER_LIMITS.speedFactor.min}
              max={SLIDER_LIMITS.speedFactor.max}
              step={DEFAULT_SLIDER_STEPS.speedFactor}
              value={sliderState.speedFactor}
              onChange={(e) => updateSliderValue('speedFactor', e.target.value, sliderState.speedFactor)}
              onPointerUp={() => flushSliderPatch(true)}
              onBlur={() => flushSliderPatch(true)}
            />
          </label>

          <label className="form-control">
            <div className="w-full grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2 pb-1">
              <span className="label-text text-xs truncate">片段间隔</span>
              <div className="w-full">
                <input
                  type="number"
                  className="input input-xs input-bordered w-full text-right tabular-nums"
                  min={SLIDER_LIMITS.fragmentInterval.min}
                  max={SLIDER_LIMITS.fragmentInterval.max}
                  step={DEFAULT_SLIDER_STEPS.fragmentInterval}
                  value={sliderState.fragmentInterval}
                  onChange={(e) => updateSliderValue('fragmentInterval', e.target.value, sliderState.fragmentInterval)}
                  onBlur={() => flushSliderPatch(true)}
                />
              </div>
            </div>
            <input
              type="range"
              className="range range-sm w-full mt-1"
              min={SLIDER_LIMITS.fragmentInterval.min}
              max={SLIDER_LIMITS.fragmentInterval.max}
              step={DEFAULT_SLIDER_STEPS.fragmentInterval}
              value={sliderState.fragmentInterval}
              onChange={(e) => updateSliderValue('fragmentInterval', e.target.value, sliderState.fragmentInterval)}
              onPointerUp={() => flushSliderPatch(true)}
              onBlur={() => flushSliderPatch(true)}
            />
          </label>

          <label className="form-control">
            <div className="w-full grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2 pb-1">
              <span className="label-text text-xs truncate">topK</span>
              <div className="w-full">
                <input
                  type="number"
                  className="input input-xs input-bordered w-full text-right tabular-nums"
                  min={SLIDER_LIMITS.topK.min}
                  max={SLIDER_LIMITS.topK.max}
                  step={DEFAULT_SLIDER_STEPS.topK}
                  value={Math.round(sliderState.topK)}
                  onChange={(e) => updateSliderValue('topK', e.target.value, sliderState.topK)}
                  onBlur={() => flushSliderPatch(true)}
                />
              </div>
            </div>
            <input
              type="range"
              className="range range-sm w-full mt-1"
              min={SLIDER_LIMITS.topK.min}
              max={SLIDER_LIMITS.topK.max}
              step={DEFAULT_SLIDER_STEPS.topK}
              value={sliderState.topK}
              onChange={(e) => updateSliderValue('topK', e.target.value, sliderState.topK)}
              onPointerUp={() => flushSliderPatch(true)}
              onBlur={() => flushSliderPatch(true)}
            />

          </label>

          <label className="form-control">
            <div className="w-full grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2 pb-1">
              <span className="label-text text-xs truncate">topP</span>
              <div className="w-full">
                <input
                  type="number"
                  className="input input-xs input-bordered w-full text-right tabular-nums"
                  min={SLIDER_LIMITS.topP.min}
                  max={SLIDER_LIMITS.topP.max}
                  step={DEFAULT_SLIDER_STEPS.topP}
                  value={sliderState.topP}
                  onChange={(e) => updateSliderValue('topP', e.target.value, sliderState.topP)}
                  onBlur={() => flushSliderPatch(true)}
                />
              </div>
            </div>
            <input
              type="range"
              className="range range-sm w-full mt-1"
              min={SLIDER_LIMITS.topP.min}
              max={SLIDER_LIMITS.topP.max}
              step={DEFAULT_SLIDER_STEPS.topP}
              value={sliderState.topP}
              onChange={(e) => updateSliderValue('topP', e.target.value, sliderState.topP)}
              onPointerUp={() => flushSliderPatch(true)}
              onBlur={() => flushSliderPatch(true)}
            />
          </label>

          <label className="form-control">
            <div className="w-full grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2 pb-1">
              <span className="label-text text-xs truncate">temperature</span>
              <div className="w-full">
                <input
                  type="number"
                  className="input input-xs input-bordered w-full text-right tabular-nums"
                  min={SLIDER_LIMITS.temperature.min}
                  max={SLIDER_LIMITS.temperature.max}
                  step={DEFAULT_SLIDER_STEPS.temperature}
                  value={sliderState.temperature}
                  onChange={(e) => updateSliderValue('temperature', e.target.value, sliderState.temperature)}
                  onBlur={() => flushSliderPatch(true)}
                />
              </div>
            </div>
            <input
              type="range"
              className="range range-sm w-full mt-1"
              min={SLIDER_LIMITS.temperature.min}
              max={SLIDER_LIMITS.temperature.max}
              step={DEFAULT_SLIDER_STEPS.temperature}
              value={sliderState.temperature}
              onChange={(e) => updateSliderValue('temperature', e.target.value, sliderState.temperature)}
              onPointerUp={() => flushSliderPatch(true)}
              onBlur={() => flushSliderPatch(true)}
            />
          </label>
        </div>
      </section>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
        <header className="text-sm font-medium">路径与参考音频</header>

        <div className="space-y-3">
          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">GPT 权重路径</span>
            </div>
            <div className="join w-full">
              <input
                type="text"
                className="input input-sm input-bordered join-item w-full"
                value={draft.gptWeightsPath}
                placeholder="GPT_weights_v2Pro/xxx.ckpt"
                onChange={(e) => ttsDraft.commit({ ...draft, gptWeightsPath: e.target.value })}
              />
              <button type="button" className="btn btn-sm join-item" onClick={() => pickPath('gpt')}>选择文件</button>
            </div>
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">SoVITS 权重路径</span>
            </div>
            <div className="join w-full">
              <input
                type="text"
                className="input input-sm input-bordered join-item w-full"
                value={draft.sovitsWeightsPath}
                placeholder="SoVITS_weights_v2Pro/xxx.pth"
                onChange={(e) => ttsDraft.commit({ ...draft, sovitsWeightsPath: e.target.value })}
              />
              <button type="button" className="btn btn-sm join-item" onClick={() => pickPath('sovits')}>选择文件</button>
            </div>
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">参考音频路径</span>
            </div>
            <div className="join w-full">
              <input
                type="text"
                className="input input-sm input-bordered join-item w-full"
                value={draft.refAudioPath}
                placeholder="assets/ref.wav"
                onChange={(e) => ttsDraft.commit({ ...draft, refAudioPath: e.target.value })}
              />
              <button type="button" className="btn btn-sm join-item" onClick={() => pickPath('ref')}>选择文件</button>
            </div>
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">参考音频文本</span>
            </div>
            <textarea
              className="textarea textarea-sm textarea-bordered w-full"
              rows={3}
              value={draft.refAudioText}
              placeholder="输入参考音频对应文本"
              onChange={(e) => ttsDraft.commit({ ...draft, refAudioText: e.target.value })}
            />
          </label>
        </div>

        <div className="text-xs text-base-content/70">
          自动预热状态：
          <span className="ml-1">
            {preheatState === 'pending' ? '进行中' : (preheatState === 'ok' ? '成功' : (preheatState === 'failed' ? '失败' : '未触发'))}
          </span>
          <span className="ml-2 opacity-80">{preheatMessage}</span>
        </div>
      </section>
    </div>
  );
}
