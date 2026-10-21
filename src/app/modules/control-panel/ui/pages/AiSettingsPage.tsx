import { useState } from 'react';
import TTSSettingsPage from './TTSSettingsPage';
import AsrSettingsPage from './AsrSettingsPage';
import { SubtitleSettings } from '../components/subtitle/SubtitleSettingsCard';
import { Field, SettingsCard } from '../components/common/SettingsSection';
import { ModelRegistryCard } from '../components/ai/ModelRegistryCard';
import { MemoryModelCard } from '../components/ai/MemoryModelCard';
import { probeModelEfforts } from '@app/modules/ai/modules/llm/infrastructure/effortProbe';
import { listRemoteModels, type RemoteModel } from '@app/modules/ai/modules/llm/infrastructure/modelCatalog';
import type { ModelConfig, AsrConfig } from '../../domain/types';

const CAPABILITIES = [
  { key: 'text', label: '文字 AI' },
  { key: 'asr', label: '语音识别' },
  { key: 'tts', label: '语音合成' },
] as const;

type Capability = typeof CAPABILITIES[number]['key'];

/** 密码框右侧的眼睛，样式与原生控件一致：无边框、只有图标。 */
function EyeIcon({ off = false }: { off?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
    strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="2.6" />
    {off && <path d="M4 4l16 16" />}
  </svg>;
}

interface InterfacePatch {
  apiBaseUrl: string;
  apiKey: string;
  displayLang: 'zh' | 'en' | 'ja' | 'ko';
}

export default function AiSettingsPage({
  apiBaseUrl,
  apiKey,
  displayLang,
  llmModels,
  memoryModel,
  memoryReasoningEffort,
  onChange,
  onLlmModelsChange,
  onMemoryChange,
  modelConfig,
  asrConfig,
  preheatState,
  preheatMessage,
  onTtsConfigChange,
  onPickPath,
  onAsrConfigChange,
  globalConfig,
  onGlobalConfigChange,
}: {
  apiBaseUrl: string;
  apiKey: string;
  displayLang: 'zh' | 'en' | 'ja' | 'ko';
  llmModels: PetLlmModel[];
  memoryModel: string;
  memoryReasoningEffort: PetReasoningEffort | '';
  onChange: (next: InterfacePatch) => void;
  onLlmModelsChange: (next: PetLlmModel[]) => Promise<unknown>;
  onMemoryChange: (patch: { memoryModel?: string; memoryReasoningEffort?: PetReasoningEffort | '' }) => void;
  modelConfig: ModelConfig;
  asrConfig: AsrConfig;
  preheatState: 'idle' | 'pending' | 'ok' | 'failed';
  preheatMessage: string;
  onTtsConfigChange: (next: ModelConfig['tts']) => Promise<void>;
  onPickPath: (kind: 'gpt' | 'sovits' | 'ref') => Promise<string | null>;
  onAsrConfigChange: (next: AsrConfig) => Promise<void>;
  globalConfig: PetGlobalModelConfig;
  onGlobalConfigChange: (patch: PetGlobalModelConfigPayload) => Promise<unknown>;
}) {
  const [tab, setTab] = useState<Capability>('text');
  const [revealKey, setRevealKey] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<RemoteModel[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const status: Record<Capability, string> = {
    text: llmModels.length ? `${llmModels.length} 个模型` : '未启用模型',
    asr: asrConfig.mode === 'local' ? '本地引擎' : '远程引擎',
    tts: modelConfig.tts.enabled ? '已启用' : '未启用',
  };

  const canFetch = Boolean(apiBaseUrl.trim());

  /** 拉取接口提供的全部模型；清单只是候选，勾选与否才决定启用哪些。 */
  const fetchModels = async () => {
    if (!canFetch) {
      setFetchError('先填写 Base URL：模型清单是从这个地址的 /models 拉取的。');
      return;
    }
    setFetching(true);
    setFetchError(null);
    setError(null);
    setNotice(null);
    try {
      // 免鉴权的本地接口允许不带 API Key；需要鉴权时接口会返回 401，再让用户补 Key。
      setAvailable(await listRemoteModels({ apiKey, baseURL: apiBaseUrl }));
    } catch (reason) {
      setAvailable([]);
      setFetchError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFetching(false);
    }
  };

  /** 勾选即启用：接口若已声明档位就直接用，否则立刻探一次，避免启用后深度控件是空的。 */
  const enableModel = async (id: string) => {
    setError(null);
    setNotice(null);
    const declared = available.find((model) => model.id === id)?.efforts ?? [];
    let entry: PetLlmModel;
    if (declared.length) {
      entry = { id, efforts: declared, effortsSource: 'catalog', probedAt: Date.now() };
    } else {
      setBusyLabel(`正在检测 ${id}：逐个档位验证中`);
      const outcome = await probeModelEfforts({ apiKey, baseURL: apiBaseUrl, model: id },
        (done, total) => setBusyLabel(`正在检测 ${id}：档位 ${done}/${total}`));
      setBusyLabel(null);
      if (outcome.status === 'unknown') {
        setError(`已启用 ${id}，但思考深度未检测出：${outcome.message ?? '接口未返回可用结果'}。可稍后点「重新检测」。`);
      }
      entry = outcome.status === 'ok'
        ? { id, efforts: outcome.efforts, effortsSource: outcome.source, probedAt: Date.now() }
        : { id, efforts: [], effortsSource: 'none', probedAt: 0 };
    }
    // 写清单期间禁用其它勾选，避免两次改动互相覆盖。
    setBusyLabel('正在更新模型清单…');
    try {
      await onLlmModelsChange([...llmModels, entry]);
      setNotice(`已启用 ${id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyLabel(null);
    }
  };

  /** 取消勾选即移除；被移除的模型不能继续当记忆整理模型。 */
  const disableModel = async (id: string) => {
    setError(null);
    setNotice(null);
    setBusyLabel('正在更新模型清单…');
    try {
      await onLlmModelsChange(llmModels.filter((model) => model.id !== id));
      if (memoryModel === id) onMemoryChange({ memoryModel: '', memoryReasoningEffort: '' });
      setNotice(`已移除 ${id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyLabel(null);
    }
  };

  const probeModel = async (id: string) => {
    setError(null);
    setNotice(null);
    setBusyLabel(`正在检测 ${id}：逐个档位验证中`);
    const outcome = await probeModelEfforts({ apiKey, baseURL: apiBaseUrl, model: id },
      (done, total) => setBusyLabel(`正在检测 ${id}：档位 ${done}/${total}`));
    setBusyLabel(null);
    if (outcome.status === 'unknown') {
      setError(`检测未完成：${outcome.message ?? '接口未返回可用结果'}。已保留原有档位。`);
      return;
    }
    const next = llmModels.map((model) => (model.id === id
      ? { ...model, efforts: outcome.efforts, effortsSource: outcome.source, probedAt: Date.now() }
      : model));
    try {
      await onLlmModelsChange(next);
      // 深度集合变了，记忆整理的选择也要跟着收敛到新的第一档。
      if (memoryModel === id) onMemoryChange({ memoryReasoningEffort: outcome.efforts[0] ?? '' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">AI 设置</h1>
        <p className="mt-1 text-xs text-base-content/60">
          文字对话、语音识别和语音合成各自独立配置，修改后立即生效。
        </p>
      </div>

      <section className="rounded-box border border-base-300 bg-base-100">
        <div className="flex items-center justify-between gap-3 border-b border-base-300 px-3 py-2.5">
          <span className="text-sm font-medium">模型能力</span>
        </div>
        <div role="tablist" className="flex items-stretch gap-1 p-1.5">
          {CAPABILITIES.map((item) => {
            const active = tab === item.key;
            return <button key={item.key} type="button" role="tab" aria-selected={active}
              onClick={() => setTab(item.key)}
              className={`flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-field px-3 py-2 text-left
                transition-all duration-150 active:scale-95
                ${active ? 'bg-primary/10 text-primary' : 'text-base-content/60 hover:bg-base-content/5 hover:text-base-content/80'}`}>
              <span className="truncate text-sm font-medium">{item.label}</span>
              <span className="w-full truncate text-[11px] opacity-70">{status[item.key]}</span>
            </button>;
          })}
        </div>
      </section>

      {tab === 'text' && <>
        <SettingsCard title="接口" description="OpenAI 兼容接口；模型清单、对话与记忆整理都走同一套凭据。">
          <Field label="Base URL" hint="自建或代理地址；留空则使用服务默认地址">
            <input className="input input-sm w-full" value={apiBaseUrl} placeholder="https://api.example.com/v1"
              onChange={(event) => onChange({ apiBaseUrl: event.target.value, apiKey, displayLang })} />
          </Field>
          <Field label="API Key" hint="免鉴权的本地接口可以留空">
            <div className="relative">
              <input className="input input-sm w-full pr-9" type={revealKey ? 'text' : 'password'}
                value={apiKey} placeholder="sk-..." autoComplete="off" spellCheck={false}
                onChange={(event) => onChange({ apiBaseUrl, apiKey: event.target.value, displayLang })} />
              <button type="button" title={revealKey ? '隐藏' : '显示'}
                aria-label={revealKey ? '隐藏 API Key' : '显示 API Key'}
                onClick={() => setRevealKey((value) => !value)}
                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-field
                  text-base-content/40 transition-colors hover:text-base-content/80">
                <EyeIcon off={revealKey} />
              </button>
            </div>
          </Field>
        </SettingsCard>

        <ModelRegistryCard
          models={llmModels}
          available={available}
          canFetch={canFetch}
          fetching={fetching}
          fetchError={fetchError}
          busyLabel={busyLabel}
          notice={notice}
          error={error}
          onFetch={() => void fetchModels()}
          onToggle={(id, enabled) => void (enabled ? enableModel(id) : disableModel(id))}
          onProbe={(id) => void probeModel(id)}
        />

        <MemoryModelCard
          models={llmModels}
          memoryModel={memoryModel}
          memoryEffort={memoryReasoningEffort}
          onChange={onMemoryChange}
        />

        <SettingsCard title="生成与显示" description="思考深度由每个模型自己检测，只能从它支持的档位里选。">
          <Field label="展示语言">
            <select className="select select-sm w-full" value={displayLang}
              onChange={(event) => onChange({ apiBaseUrl, apiKey, displayLang: event.target.value as 'zh' | 'en' | 'ja' | 'ko' })}>
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </select>
          </Field>
        </SettingsCard>
      </>}

      {tab === 'asr' && <>
        <AsrSettingsPage config={asrConfig} onChange={onAsrConfigChange} />
        <SubtitleSettings config={globalConfig} onChange={onGlobalConfigChange} />
      </>}

      {tab === 'tts' && (
        <TTSSettingsPage
          modelConfig={modelConfig}
          preheatState={preheatState}
          preheatMessage={preheatMessage}
          onTtsConfigChange={onTtsConfigChange}
          onPickPath={onPickPath}
        />
      )}
    </div>
  );
}
