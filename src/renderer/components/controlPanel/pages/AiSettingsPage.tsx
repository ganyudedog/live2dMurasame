export default function AiSettingsPage({
  apiBaseUrl,
  apiKey,
  displayLang,
  onChange,
}: {
  apiBaseUrl: string;
  apiKey: string;
  displayLang: 'zh' | 'en' | 'ja' | 'ko';
  onChange: (next: { apiBaseUrl: string; apiKey: string; displayLang: 'zh' | 'en' | 'ja' | 'ko' }) => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">AI设置</h1>
        <p className="text-xs text-base-content/60">apiKey 与 Base URL 会写入 globalModelConfig，其余暂为本地状态</p>
      </div>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
        <div className="text-sm font-medium">API</div>
        <div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3">
          <div className="text-xs text-base-content/70 text-right">Base URL</div>
          <input
            className="input input-sm input-bordered w-full"
            placeholder="https://example.com/api"
            value={apiBaseUrl}
            onChange={(e) => onChange({ apiBaseUrl: e.target.value, apiKey, displayLang })}
          />

          <div className="text-xs text-base-content/70 text-right">API Key（可选）</div>
          <input
            className="input input-sm input-bordered w-full"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => onChange({ apiBaseUrl, apiKey: e.target.value, displayLang })}
          />

          <div className="text-xs text-base-content/70 text-right">展示语言</div>
          <select
            className="select select-sm select-bordered w-full"
            value={displayLang}
            onChange={(e) => onChange({ apiBaseUrl, apiKey, displayLang: e.target.value as 'zh' | 'en' | 'ja' | 'ko' })}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>
        </div>
      </section>
    </div>
  );
}
