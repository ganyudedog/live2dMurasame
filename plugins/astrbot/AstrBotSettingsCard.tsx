import { useEffect, useMemo, useState } from 'react';
import type { AiModelCatalogHostApi, AstrBotUiContext } from './types';
import { DEFAULT_ASTRBOT_SETTINGS, normalizeSettings, type AstrBotBridgeSettings } from './settings';

const EFFORT_LABELS: Record<string, string> = { none: '关闭', minimal: '最少', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大', ultra: '超高' };

const getModelsHost = (context: AstrBotUiContext): AiModelCatalogHostApi | null => {
  const value = context.hostApi.aiModels;
  return value && typeof value.getModels === 'function' && typeof value.subscribe === 'function' ? value : null;
};

export function AstrBotSettingsCard(context: AstrBotUiContext) {
  const modelsHost = getModelsHost(context);
  const [models, setModels] = useState<readonly { id: string; efforts: readonly string[] }[]>([]);
  const [settings, setSettings] = useState<AstrBotBridgeSettings>(DEFAULT_ASTRBOT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [connectionDraft, setConnectionDraft] = useState({ bridgeUrl: DEFAULT_ASTRBOT_SETTINGS.bridgeUrl, token: DEFAULT_ASTRBOT_SETTINGS.token });
  const [systemPromptDraft, setSystemPromptDraft] = useState(DEFAULT_ASTRBOT_SETTINGS.systemPrompt);

  useEffect(() => {
    let active = true;
    void context.storage.get<AstrBotBridgeSettings>('settings', DEFAULT_ASTRBOT_SETTINGS)
      .then((value) => { if (active) { const next = normalizeSettings(value, DEFAULT_ASTRBOT_SETTINGS); setSettings(next); setConnectionDraft({ bridgeUrl: next.bridgeUrl, token: next.token }); setSystemPromptDraft(next.systemPrompt); setLoaded(true); } })
      .catch((error: unknown) => { context.logger.error('settings.load.failed', { error: String(error) }); if (active) { setSaveError(String(error)); setLoaded(true); } });
    return () => { active = false; };
  }, [context.storage, context.logger]);

  useEffect(() => {
    if (!modelsHost) return;
    const refresh = () => setModels(modelsHost.getModels());
    refresh();
    return modelsHost.subscribe(refresh);
  }, [modelsHost]);

  const selectedModel = useMemo(() => models.find(({ id }) => id === settings.model), [models, settings.model]);
  const efforts = selectedModel?.efforts ?? [];
  const update = (patch: Partial<AstrBotBridgeSettings>) => {
    const next = normalizeSettings({ ...settings, ...patch });
    setSettings(next);
    void context.storage.set('settings', next)
      .then(() => setSaveError(''))
      .catch((error: unknown) => { context.logger.error('settings.save.failed', { error: String(error) }); setSaveError(String(error)); });
  };
  const updateModel = (model: string) => {
    const nextModel = models.find((item) => item.id === model);
    update({ model, reasoningEffort: nextModel?.efforts.includes(settings.reasoningEffort) ? settings.reasoningEffort : (nextModel?.efforts[0] ?? '') });
  };

  if (!modelsHost) return <p className="text-sm text-error">模型目录服务不可用。</p>;
  if (!loaded) return <p className="text-sm text-base-content/60">正在读取插件配置…</p>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-base-content/60">这里配置 AstrBot 独立对话通道。请求策略在 WebSocket 握手时协商，桌面聊天仍由桌面 AI 链路处理。</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="form-control gap-1"><span className="label-text text-xs">桥接地址</span>
          <input className="input input-sm" value={connectionDraft.bridgeUrl} onChange={(event) => setConnectionDraft((current) => ({ ...current, bridgeUrl: event.target.value }))} onBlur={() => update({ bridgeUrl: connectionDraft.bridgeUrl })} />
        </label>
        <label className="form-control gap-1"><span className="label-text text-xs">访问令牌</span>
          <input className="input input-sm" type="password" value={connectionDraft.token} onChange={(event) => setConnectionDraft((current) => ({ ...current, token: event.target.value }))} onBlur={() => update({ token: connectionDraft.token })} />
        </label>
        <label className="form-control gap-1"><span className="label-text text-xs">对话模型</span>
          <select className="select select-sm" value={settings.model} onChange={(event) => updateModel(event.target.value)}>
            <option value="">请选择模型</option>{models.map(({ id }) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label className="form-control gap-1"><span className="label-text text-xs">思考深度</span>
          <select className="select select-sm" value={settings.reasoningEffort} disabled={!efforts.length} onChange={(event) => update({ reasoningEffort: event.target.value })}>
            {efforts.length ? efforts.map((effort) => <option key={effort} value={effort}>{EFFORT_LABELS[effort] ?? effort}</option>) : <option value="">该模型不支持</option>}
          </select>
        </label>
        <label className="form-control gap-1"><span className="label-text text-xs">请求策略</span>
          <select className="select select-sm" value={settings.interactionMode} onChange={(event) => update({ interactionMode: event.target.value as AstrBotBridgeSettings['interactionMode'] })}>
            <option value="queue">排队</option><option value="concurrent">并发</option><option value="interrupt">打断</option>
          </select>
        </label>
        <label className="form-control gap-1"><span className="label-text text-xs">最大并发</span>
          <input className="input input-sm" type="number" min={1} max={8} value={settings.maxConcurrent} disabled={settings.interactionMode === 'queue'} onChange={(event) => update({ maxConcurrent: Number(event.target.value) || 1 })} />
        </label>
        <label className="form-control gap-1"><span className="label-text text-xs">最大排队数</span>
          <input className="input input-sm" type="number" min={0} max={100} value={settings.maxQueued} onChange={(event) => update({ maxQueued: Number(event.target.value) || 0 })} />
        </label>
        <label className="form-control gap-1"><span className="label-text text-xs">展示语言</span>
          <select className="select select-sm" value={settings.displayLang} onChange={(event) => update({ displayLang: event.target.value as AstrBotBridgeSettings['displayLang'] })}>
            <option value="zh">中文</option><option value="en">英语</option><option value="ja">日语</option><option value="ko">韩语</option>
          </select>
        </label>
        <label className="form-control gap-1"><span className="label-text text-xs">朗读文本语言（不含音频传输）</span>
          <select className="select select-sm" value={settings.speakLang} onChange={(event) => update({ speakLang: event.target.value as AstrBotBridgeSettings['speakLang'] })}>
            <option value="">仅文字</option><option value="all_zh">中文</option><option value="all_en">英语</option><option value="all_ja">日语</option><option value="all_ko">韩语</option><option value="all_yue">粤语</option><option value="auto">自动</option>
          </select>
        </label>
      </div>
      <label className="form-control gap-1">
        <span className="label-text text-xs">对话场景提示词</span>
        <textarea className="textarea min-h-32" value={systemPromptDraft}
          onChange={(event) => setSystemPromptDraft(event.target.value)}
          onBlur={() => update({ systemPrompt: systemPromptDraft })}
          placeholder="说明群聊场景、回复方式等；当前角色人设由应用自动注入" />
        <span className="text-xs text-base-content/60">角色人设沿用当前角色配置，这里只配置插件的对话场景。</span>
      </label>
      {saveError && <p className="text-sm text-error">保存配置失败：{saveError}</p>}
    </div>
  );
}
