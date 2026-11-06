import { useState } from 'react';
import { AudioLines, Eye, EyeOff, Languages, Link, MessageSquare, Mic } from 'lucide-react';
import { Page } from '../components/common/Page';
import { SegmentedTabs } from '../components/common/SegmentedTabs';
import { Input, Select } from '../components/common/FormControls';
import TTSSettingsPage from './TTSSettingsPage';
import AsrSettingsPage from './AsrSettingsPage';
import { SubtitleSettings } from '../components/subtitle/SubtitleSettingsCard';
import { Field, SettingsCard } from '../components/common/SettingsSection';
import { ModelRegistryCard } from '../components/ai/ModelRegistryCard';
import { keepFetchedModels } from '../components/ai/keepFetchedModels';
import { MemoryModelCard } from '../components/ai/MemoryModelCard';
import { AgentCard } from '../components/ai/AgentCard';
import { probeModelEfforts } from '@app/modules/ai/modules/llm/infrastructure/effortProbe';
import { listRemoteModels, type RemoteModel } from '@app/modules/ai/modules/llm/infrastructure/modelCatalog';
import type { ModelConfig, AsrConfig } from '../../domain/types';

const CAPABILITIES = [
  { key: 'text', label: '文字 AI', icon: <MessageSquare /> },
  { key: 'asr', label: '语音识别', icon: <Mic /> },
  { key: 'tts', label: '语音合成', icon: <AudioLines /> },
] as const;

type Capability = typeof CAPABILITIES[number]['key'];

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

  /**
   * 拉取接口提供的全部模型。清单是权威来源：接口这次没返回的模型直接从后端清单里删掉，
   * 不保留“以前选过但现在不存在”的残项。
   */
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
      const fetched = await listRemoteModels({ apiKey, baseURL: apiBaseUrl });
      setAvailable(fetched);
      const { kept, dropped } = keepFetchedModels(llmModels, fetched);
      if (dropped.length) {
        await onLlmModelsChange(kept);
        if (memoryModel && dropped.includes(memoryModel)) onMemoryChange({ memoryModel: '', memoryReasoningEffort: '' });
        setNotice(`接口已不再返回：${dropped.join('、')}，已从模型清单移除`);
      }
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
    <Page title="AI 设置" description="文字对话、语音识别和语音合成各自独立配置，修改后立即生效。">
      <SegmentedTabs label="模型能力" value={tab} onChange={setTab}
        items={CAPABILITIES.map((item) => ({ ...item, caption: status[item.key] }))} />

      {tab === 'text' && <>
        <SettingsCard title="接口" icon={<Link />} description="OpenAI 兼容接口；模型清单、对话与记忆整理都走同一套凭据。">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Base URL" hint="自建或代理地址；留空则使用服务默认地址">
              <Input className="font-mono" value={apiBaseUrl} placeholder="https://api.example.com/v1"
                onChange={(event) => onChange({ apiBaseUrl: event.target.value, apiKey, displayLang })} />
            </Field>
            <Field label="API Key" hint="免鉴权的本地接口可以留空">
              <div className="relative">
                <Input className="pr-9 font-mono" type={revealKey ? 'text' : 'password'}
                  value={apiKey} placeholder="sk-..." autoComplete="off" spellCheck={false}
                  onChange={(event) => onChange({ apiBaseUrl, apiKey: event.target.value, displayLang })} />
                <button type="button" title={revealKey ? '隐藏' : '显示'}
                  aria-label={revealKey ? '隐藏 API Key' : '显示 API Key'}
                  onClick={() => setRevealKey((value) => !value)}
                  className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center rounded-r-lg
                    text-muted-foreground/70 transition-colors hover:text-foreground">
                  {revealKey ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                </button>
              </div>
            </Field>
          </div>
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

        <SettingsCard title="生成与显示" icon={<Languages />} description="思考深度由每个模型自己检测，只能从它支持的档位里选。">
          <Field label="展示语言" className="md:max-w-xs">
            <Select value={displayLang}
              onChange={(event) => onChange({ apiBaseUrl, apiKey, displayLang: event.target.value as 'zh' | 'en' | 'ja' | 'ko' })}>
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </Select>
          </Field>
        </SettingsCard>

        <AgentCard settings />
      </>}

      {tab === 'asr' && <>
        <AsrSettingsPage config={asrConfig} onChange={onAsrConfigChange} />
        <SubtitleSettings config={globalConfig} onChange={onGlobalConfigChange} />
      </>}

      {tab === 'tts' && (
        <TTSSettingsPage
          modelConfig={modelConfig}
          onTtsConfigChange={onTtsConfigChange}
          onPickPath={onPickPath}
        />
      )}
    </Page>
  );
}
