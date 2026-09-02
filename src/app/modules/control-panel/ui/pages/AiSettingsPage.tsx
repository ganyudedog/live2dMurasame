export default function AiSettingsPage({
  apiBaseUrl,
  apiKey,
  displayLang,
  ttsMediaType,
  ttsStreamingMode,
  onChange,
}: {
  apiBaseUrl: string;
  apiKey: string;
  displayLang: 'zh' | 'en' | 'ja' | 'ko';
  ttsMediaType: 'wav' | 'ogg' | 'aac';
  ttsStreamingMode: boolean;
  onChange: (next: {
    apiBaseUrl: string;
    apiKey: string;
    displayLang: 'zh' | 'en' | 'ja' | 'ko';
    ttsMediaType: 'wav' | 'ogg' | 'aac';
    ttsStreamingMode: boolean;
  }) => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">AI设置</h1>
        <p className="text-xs text-base-content/60">apiKey、Base URL、展示语言、音频格式与流式开关都会写入 globalModelConfig（全局生效）。</p>
      </div>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
        <div className="text-sm font-medium">API</div>
        <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3">
          <div className="text-xs text-base-content/70 text-right">Base URL</div>
          <input
            className="input input-sm input-bordered w-full"
            placeholder="https://example.com/api"
            value={apiBaseUrl}
            onChange={(e) => onChange({
              apiBaseUrl: e.target.value,
              apiKey,
              displayLang,
              ttsMediaType,
              ttsStreamingMode,
            })}
          />

          <div className="text-xs text-base-content/70 text-right">API Key（可选）</div>
          <input
            className="input input-sm input-bordered w-full"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => onChange({
              apiBaseUrl,
              apiKey: e.target.value,
              displayLang,
              ttsMediaType,
              ttsStreamingMode,
            })}
          />

          <div className="text-xs text-base-content/70 text-right">展示语言</div>
          <select
            className="select select-sm select-bordered w-full"
            value={displayLang}
            onChange={(e) => onChange({
              apiBaseUrl,
              apiKey,
              displayLang: e.target.value as 'zh' | 'en' | 'ja' | 'ko',
              ttsMediaType,
              ttsStreamingMode,
            })}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>

          <div className="text-xs text-base-content/70 text-right">全局音频格式</div>
          <select
            className="select select-sm select-bordered w-full"
            value={ttsMediaType}
            onChange={(e) => onChange({
              apiBaseUrl,
              apiKey,
              displayLang,
              ttsMediaType: e.target.value as 'wav' | 'ogg' | 'aac',
              ttsStreamingMode,
            })}
          >
            <option value="wav">wav</option>
            <option value="ogg">ogg</option>
            <option value="aac">aac</option>
          </select>

          <div className="text-xs text-base-content/70 text-right">全局流式模式</div>
          <label className="label cursor-pointer justify-start gap-2 py-0">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={ttsStreamingMode}
              onChange={(e) => onChange({
                apiBaseUrl,
                apiKey,
                displayLang,
                ttsMediaType,
                ttsStreamingMode: e.target.checked,
              })}
            />
            <span className="label-text text-xs">启用 streaming_mode</span>
          </label>
        </div>
      </section>
    </div>
  );
}
