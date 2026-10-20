import { useState } from 'react';
import TTSSettingsPage from './TTSSettingsPage';
import AsrSettingsPage from './AsrSettingsPage';
import { SubtitleSettings } from '../../modules/subtitle/ui/SubtitleSettings';
import { Field, SettingsCard } from '../components/SettingsSection';
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

export default function AiSettingsPage({
  model,
  apiBaseUrl,
  apiKey,
  displayLang,
  memoryReasoningEffort = 'default',
  onMemoryReasoningEffortChange,
  onChange,
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
  model: string;
  apiBaseUrl: string;
  apiKey: string;
  displayLang: 'zh' | 'en' | 'ja' | 'ko';
  memoryReasoningEffort?: PetReasoningEffort;
  onMemoryReasoningEffortChange: (value: PetReasoningEffort) => void;
  onChange: (next: {
    model: string;
    apiBaseUrl: string;
    apiKey: string;
    displayLang: 'zh' | 'en' | 'ja' | 'ko';
  }) => void;
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

  const status: Record<Capability, string> = {
    text: model.trim() || '未配置模型',
    asr: asrConfig.mode === 'local' ? '本地引擎' : '远程引擎',
    tts: modelConfig.tts.enabled ? '已启用' : '未启用',
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
        <SettingsCard title="接口" description="OpenAI 兼容的对话模型，用于宠物对话、动作表生成和记忆整理。">
          <Field label="模型" hint="服务端要求的模型名，例如 deepseek-chat">
            <input className="input input-sm w-full" value={model} placeholder="deepseek-chat"
              onChange={(event) => onChange({ model: event.target.value, apiBaseUrl, apiKey, displayLang })} />
          </Field>
          <Field label="Base URL" hint="自建或代理地址；留空则使用服务默认地址">
            <input className="input input-sm w-full" value={apiBaseUrl} placeholder="https://api.example.com/v1"
              onChange={(event) => onChange({ model, apiBaseUrl: event.target.value, apiKey, displayLang })} />
          </Field>
          <Field label="API Key" hint="免鉴权的本地接口可以留空">
            <div className="relative">
              <input className="input input-sm w-full pr-9" type={revealKey ? 'text' : 'password'}
                value={apiKey} placeholder="sk-..." autoComplete="off" spellCheck={false}
                onChange={(event) => onChange({ model, apiBaseUrl, apiKey: event.target.value, displayLang })} />
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

        <SettingsCard title="生成与显示" description="推理深度会原样作为 reasoning_effort 发送；选择「接口默认」则不发送该参数。">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="展示语言">
              <select className="select select-sm w-full" value={displayLang}
                onChange={(event) => onChange({ model, apiBaseUrl, apiKey, displayLang: event.target.value as 'zh' | 'en' | 'ja' | 'ko' })}>
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
              </select>
            </Field>
            <Field label="记忆整理推理深度" hint="后台整理记忆时使用；对话与动作表在各自的对话里选深度">
              <select className="select select-sm w-full" value={memoryReasoningEffort}
                onChange={(event) => onMemoryReasoningEffortChange(event.target.value as PetReasoningEffort)}>
                <option value="default">接口默认</option>
                <option value="none">关闭（none）</option>
                <option value="minimal">最少（minimal）</option>
                <option value="low">低（low）</option>
                <option value="medium">中（medium）</option>
                <option value="high">高（high）</option>
                <option value="xhigh">最高（xhigh）</option>
              </select>
            </Field>
          </div>
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
