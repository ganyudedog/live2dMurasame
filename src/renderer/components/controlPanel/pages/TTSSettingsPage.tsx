import { useMemo } from 'react';
import type { ModelConfig } from '../types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';

type TtsUiDraft = ModelConfig['tts'];

const normalizeTextSplitMode = (value: unknown): TtsUiDraft['textSplitMode'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'cut0' || normalized === 'cut1' || normalized === 'cut2'
    || normalized === 'cut3' || normalized === 'cut4' || normalized === 'cut5') {
    return normalized as TtsUiDraft['textSplitMode'];
  }
  if (normalized === 'none') return 'cut0';
  if (normalized === 'cut50') return 'cut2';
  if (normalized === 'cut_punc' || normalized === 'punctuation'
    || normalized === 'cut_zh_comma' || normalized === 'cut_en_comma') {
    return 'cut5';
  }
  return 'cut5';
};

const LANG_OPTIONS: Array<{ label: string; value: TtsUiDraft['textLang'] }> = [
  { label: '中文', value: 'zh' },
  { label: '日语', value: 'ja' },
  { label: '英语', value: 'en' },
  { label: '韩语', value: 'ko' },
  { label: '粤语', value: 'yue' },
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
    && left.mediaType === right.mediaType
    && left.streamingMode === right.streamingMode
  );
};

export default function TTSSettingsPage({
  modelPath,
  modelConfig,
  onModelConfigChange,
}: {
  modelPath: string | null;
  modelConfig: ModelConfig;
  onModelConfigChange: (next: ModelConfig) => Promise<void>;
}) {
  const remoteTtsConfig = useMemo<TtsUiDraft>(() => ({
    ...modelConfig.tts,
    textSplitMode: normalizeTextSplitMode(modelConfig.tts.textSplitMode),
  }), [modelConfig.tts]);

  const ttsDraft = useDebouncedRemoteDraft<TtsUiDraft>({
    remoteValue: remoteTtsConfig,
    debounceMs: 260,
    isEqual: isSameTtsDraft,
    onCommit: async (nextTts) => {
      const aiApi = window.AIAPI?.tts;
      if (aiApi?.updateConfig) {
        await aiApi.updateConfig({ modelPath: modelPath ?? undefined, patch: nextTts });
        return;
      }
      await onModelConfigChange({
        ...modelConfig,
        tts: nextTts,
      });
    },
  });

  const draft = ttsDraft.draft;

  const pickPath = async (kind: 'gpt' | 'sovits' | 'ref') => {
    const ttsApi = window.AIAPI?.tts;
    if (!ttsApi) return;
    const picker = kind === 'gpt'
      ? ttsApi.pickGptWeightsPath
      : kind === 'sovits'
        ? ttsApi.pickSovitsWeightsPath
        : ttsApi.pickRefAudioPath;
    if (!picker) return;
    const picked = await picker();
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
        <p className="text-xs text-base-content/60">已接入 AIAPI.tts IPC 与配置快照同步，千问返回后会按本页配置触发语音合成。为保证浏览器兼容性，wav + 流式会自动降级为非流式。</p>
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

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">音频格式</span>
            </div>
            <select
              className="select select-sm select-bordered w-full"
              value={draft.mediaType}
              onChange={(e) => ttsDraft.commit({ ...draft, mediaType: e.target.value as TtsUiDraft['mediaType'] })}
            >
              <option value="wav">wav</option>
              <option value="ogg">ogg</option>
              <option value="aac">aac</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={draft.streamingMode}
              onChange={(e) => ttsDraft.commit({ ...draft, streamingMode: e.target.checked })}
            />
            <span className="label-text text-xs">流式返回（streaming_mode）</span>
          </label>

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
            <div className="label py-0">
              <span className="label-text text-xs">速度 speedFactor (0~2)</span>
            </div>
            <input
              type="number"
              className="input input-sm input-bordered w-full"
              min={0}
              max={2}
              step={0.01}
              value={draft.speedFactor}
              onChange={(e) => ttsDraft.commit({
                ...draft,
                speedFactor: clamp(toNumber(e.target.value, draft.speedFactor), 0, 2),
              })}
            />
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">片段间隔 fragmentInterval (0~0.5)</span>
            </div>
            <input
              type="number"
              className="input input-sm input-bordered w-full"
              min={0}
              max={0.5}
              step={0.01}
              value={draft.fragmentInterval}
              onChange={(e) => ttsDraft.commit({
                ...draft,
                fragmentInterval: clamp(toNumber(e.target.value, draft.fragmentInterval), 0, 0.5),
              })}
            />
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">topK (1~100)</span>
            </div>
            <input
              type="number"
              className="input input-sm input-bordered w-full"
              min={1}
              max={100}
              step={1}
              value={draft.topK}
              onChange={(e) => ttsDraft.commit({
                ...draft,
                topK: Math.round(clamp(toNumber(e.target.value, draft.topK), 1, 100)),
              })}
            />
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">topP (0~1)</span>
            </div>
            <input
              type="number"
              className="input input-sm input-bordered w-full"
              min={0}
              max={1}
              step={0.01}
              value={draft.topP}
              onChange={(e) => ttsDraft.commit({
                ...draft,
                topP: clamp(toNumber(e.target.value, draft.topP), 0, 1),
              })}
            />
          </label>

          <label className="form-control md:col-span-2">
            <div className="label py-0">
              <span className="label-text text-xs">temperature (0~1)</span>
            </div>
            <input
              type="number"
              className="input input-sm input-bordered w-full"
              min={0}
              max={1}
              step={0.01}
              value={draft.temperature}
              onChange={(e) => ttsDraft.commit({
                ...draft,
                temperature: clamp(toNumber(e.target.value, draft.temperature), 0, 1),
              })}
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

        <div className="text-xs text-base-content/60">
          提示：本页已通过 AIAPI.tts 持久化到模型配置，并依赖配置快照回流展示。
        </div>
      </section>
    </div>
  );
}
