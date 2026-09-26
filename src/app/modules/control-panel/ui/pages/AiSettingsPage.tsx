import { useState } from 'react';
import TTSSettingsPage from './TTSSettingsPage';
import AsrSettingsPage from './AsrSettingsPage';
import type { ModelConfig, AsrConfig } from '../../domain/types';

export default function AiSettingsPage({
  model,
  apiBaseUrl,
  apiKey,
  displayLang,
  onChange,
  modelConfig,
  asrConfig,
  preheatState,
  preheatMessage,
  onTtsConfigChange,
  onPickPath,
  onAsrConfigChange,
}: {
  model: string;
  apiBaseUrl: string;
  apiKey: string;
  displayLang: 'zh' | 'en' | 'ja' | 'ko';
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
}) {
  const [tab, setTab] = useState<'text' | 'asr' | 'tts'>('text');
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">AI 设置</h1>
          <p className="text-xs text-base-content/60">文字 AI、语音识别和语音合成共享同一套 AI 设置入口。</p>
        </div>
        <div role="tablist" className="tabs tabs-boxed">
          <button type="button" role="tab" className={tab === 'text' ? 'tab tab-active' : 'tab'} onClick={() => setTab('text')}>文字 AI</button>
          <button type="button" role="tab" className={tab === 'asr' ? 'tab tab-active' : 'tab'} onClick={() => setTab('asr')}>ASR</button>
          <button type="button" role="tab" className={tab === 'tts' ? 'tab tab-active' : 'tab'} onClick={() => setTab('tts')}>TTS</button>
        </div>
      </div>

      {tab === 'asr' && <AsrSettingsPage config={asrConfig} onChange={onAsrConfigChange} />}
      {tab === 'tts' && (
        <TTSSettingsPage
          modelConfig={modelConfig}
          preheatState={preheatState}
          preheatMessage={preheatMessage}
          onTtsConfigChange={onTtsConfigChange}
          onPickPath={onPickPath}
        />
      )}
      {tab === 'text' && <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
        <div className="text-sm font-medium">API</div>
        <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3">
          <div className="text-xs text-base-content/70 text-right">Model</div>
          <input
            className="input input-sm input-bordered w-full"
            placeholder="https://example.com/api"
            value={model}
            onChange={(e) => onChange({
              model: e.target.value,
              apiBaseUrl,
              apiKey,
              displayLang,
            })}
          />

          <div className="text-xs text-base-content/70 text-right">Base URL</div>
          <input
            className="input input-sm input-bordered w-full"
            placeholder="https://example.com/api"
            value={apiBaseUrl}
            onChange={(e) => onChange({
              model,
              apiBaseUrl: e.target.value,
              apiKey,
              displayLang,
            })}
          />

          <div className="text-xs text-base-content/70 text-right">API Key（可选）</div>
          <input
            className="input input-sm input-bordered w-full"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => onChange({
              model,
              apiBaseUrl,
              apiKey: e.target.value,
              displayLang,
            })}
          />

          <div className="text-xs text-base-content/70 text-right">展示语言</div>
          <select
            className="select select-sm select-bordered w-full"
            value={displayLang}
            onChange={(e) => onChange({
              model,
              apiBaseUrl,
              apiKey,
              displayLang: e.target.value as 'zh' | 'en' | 'ja' | 'ko',
            })}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>

        </div>
      </section>}
    </div>
  );
}
