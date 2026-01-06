export default function AiSettingsPage({
  apiBaseUrl,
  apiKey,
  ttsProvider,
  ttsVoice,
  onChange,
}: {
  apiBaseUrl: string;
  apiKey: string;
  ttsProvider: string;
  ttsVoice: string;
  onChange: (next: { apiBaseUrl: string; apiKey: string; ttsProvider: string; ttsVoice: string }) => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">AI设置</h1>
        <p className="text-xs text-base-content/60">仅 UI / 本地状态（后续再接入 TTS 与 API）</p>
      </div>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
        <div className="text-sm font-medium">API</div>
        <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3">
          <div className="text-xs text-base-content/70 text-right">Base URL</div>
          <input
            className="input input-sm input-bordered w-full"
            placeholder="https://example.com/api"
            value={apiBaseUrl}
            onChange={(e) => onChange({ apiBaseUrl: e.target.value, apiKey, ttsProvider, ttsVoice })}
          />

          <div className="text-xs text-base-content/70 text-right">API Key（可选）</div>
          <input
            className="input input-sm input-bordered w-full"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => onChange({ apiBaseUrl, apiKey: e.target.value, ttsProvider, ttsVoice })}
          />
        </div>
      </section>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
        <div className="text-sm font-medium">TTS</div>
        <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3">
          <div className="text-xs text-base-content/70 text-right">Provider</div>
          <select
            className="select select-sm select-bordered w-full"
            value={ttsProvider}
            onChange={(e) => onChange({ apiBaseUrl, apiKey, ttsProvider: e.target.value, ttsVoice })}
          >
            <option value="disabled">disabled</option>
            <option value="edge">edge</option>
            <option value="openai">openai</option>
            <option value="custom">custom</option>
          </select>

          <div className="text-xs text-base-content/70 text-right">Voice</div>
          <input
            className="input input-sm input-bordered w-full"
            placeholder="zh-CN-XiaoxiaoNeural"
            value={ttsVoice}
            onChange={(e) => onChange({ apiBaseUrl, apiKey, ttsProvider, ttsVoice: e.target.value })}
          />
        </div>
      </section>
    </div>
  );
}
