import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AiModelCatalogHostApi, AstrBotUiContext } from './types';
import { DEFAULT_ASTRBOT_SETTINGS, normalizeSettings, type AstrBotBridgeSettings } from './settings';

const MODES: ReadonlyArray<{
  value: AstrBotBridgeSettings['interactionMode'];
  label: string;
  description: string;
}> = [
  { value: 'queue', label: '排队', description: '一次只处理一条消息，其余排队等待' },
  { value: 'concurrent', label: '并发', description: '同时处理多条，超过并发数后排队' },
  { value: 'interrupt', label: '打断', description: '新消息打断正在生成的那条回复' },
];

const DISPLAY_LANGS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
] as const;

const SPEAK_LANGS = [
  { value: '', label: '仅文字' },
  { value: 'all_zh', label: '中文' },
  { value: 'all_en', label: '英语' },
  { value: 'all_ja', label: '日语' },
  { value: 'all_ko', label: '韩语' },
  { value: 'all_yue', label: '粤语' },
  { value: 'auto', label: '自动' },
] as const;

const getModelsHost = (context: AstrBotUiContext): AiModelCatalogHostApi | null => {
  const value = context.hostApi.aiModels;
  return value && typeof value.getModels === 'function' && typeof value.subscribe === 'function' ? value : null;
};

const toMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 标签在上、控件在下；只有需要解释的字段才带 hint。 */
function Field({ label, hint, tone = 'muted', children }: {
  label: string;
  hint?: ReactNode;
  tone?: 'muted' | 'warn';
  children: ReactNode;
}) {
  return <div className="flex min-w-0 flex-col gap-1">
    <span className="text-[11px] text-base-content/50">{label}</span>
    {children}
    {hint ? <span className={`text-[11px] leading-snug ${tone === 'warn' ? 'text-warning' : 'text-base-content/40'}`}>{hint}</span> : null}
  </div>;
}

export function AstrBotSettingsCard(context: AstrBotUiContext) {
  const modelsHost = useMemo(() => getModelsHost(context), [context]);
  const [models, setModels] = useState<readonly { id: string; efforts: readonly string[] }[]>([]);
  const [settings, setSettings] = useState<AstrBotBridgeSettings>(DEFAULT_ASTRBOT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [revealToken, setRevealToken] = useState(false);
  const [connectionDraft, setConnectionDraft] = useState({
    bridgeUrl: DEFAULT_ASTRBOT_SETTINGS.bridgeUrl,
    token: DEFAULT_ASTRBOT_SETTINGS.token,
  });
  const [promptDraft, setPromptDraft] = useState(DEFAULT_ASTRBOT_SETTINGS.systemPrompt);
  // 数字项也走草稿：每敲一个字符就落盘会让桌面端反复重连。
  const [numberDraft, setNumberDraft] = useState({
    maxConcurrent: DEFAULT_ASTRBOT_SETTINGS.maxConcurrent,
    maxQueued: DEFAULT_ASTRBOT_SETTINGS.maxQueued,
  });
  const savedTimer = useRef<number | null>(null);
  // 订阅回调里需要最新的配置（effect 闭包会过期），用 ref 跟踪而不是在渲染期回写 state。
  const settingsRef = useRef<AstrBotBridgeSettings>(DEFAULT_ASTRBOT_SETTINGS);

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1600);
  }, []);

  useEffect(() => () => {
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
  }, []);

  useEffect(() => {
    let active = true;
    void context.storage.get<AstrBotBridgeSettings>('settings', DEFAULT_ASTRBOT_SETTINGS)
      .then((value) => {
        if (!active) return;
        const next = normalizeSettings(value, DEFAULT_ASTRBOT_SETTINGS);
        settingsRef.current = next;
        setSettings(next);
        setConnectionDraft({ bridgeUrl: next.bridgeUrl, token: next.token });
        setPromptDraft(next.systemPrompt);
        setNumberDraft({ maxConcurrent: next.maxConcurrent, maxQueued: next.maxQueued });
        setLoaded(true);
      })
      .catch((error: unknown) => {
        context.logger.error('settings.load.failed', { error: String(error) });
        if (!active) return;
        setSaveError(toMessage(error));
        setLoaded(true);
      });
    return () => { active = false; };
  }, [context.storage, context.logger]);

  useEffect(() => {
    if (!modelsHost) return undefined;
    const refresh = () => {
      const list = modelsHost.getModels();
      setModels(list);
      // 持久化的档位可能已经不属于当前模型（模型被重新检测过），顺手收敛到第一档。
      const current = settingsRef.current;
      const found = list.find((item) => item.id === current.model);
      if (!found || found.efforts.includes(current.reasoningEffort)) return;
      const next = normalizeSettings({ ...current, reasoningEffort: found.efforts[0] ?? '' });
      settingsRef.current = next;
      setSettings(next);
      void context.storage.set('settings', next).catch((error: unknown) => {
        context.logger.error('settings.save.failed', { error: String(error) });
        setSaveError(toMessage(error));
      });
    };
    refresh();
    return modelsHost.subscribe(refresh);
  }, [modelsHost, context.storage, context.logger]);

  const selectedModel = useMemo(() => models.find(({ id }) => id === settings.model), [models, settings.model]);
  const efforts = selectedModel?.efforts ?? [];
  // 展示也用收敛后的值：持久化的档位可能已经不在这个模型的支持集合里。
  const shownEffort = efforts.includes(settings.reasoningEffort) ? settings.reasoningEffort : (efforts[0] ?? '');
  const mode = MODES.find((item) => item.value === settings.interactionMode) ?? MODES[0];
  const promptDirty = promptDraft !== settings.systemPrompt;

  /** 每次改动立即落盘；值没变就不写，避免无意义的重连与日志。 */
  const update = (patch: Partial<AstrBotBridgeSettings>) => {
    const current = settingsRef.current;
    const next = normalizeSettings({ ...current, ...patch });
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    settingsRef.current = next;
    setSettings(next);
    void context.storage.set('settings', next)
      .then(() => { setSaveError(''); flashSaved(); })
      .catch((error: unknown) => {
        context.logger.error('settings.save.failed', { error: String(error) });
        setSaveError(toMessage(error));
      });
  };

  const updateModel = (modelId: string) => {
    const nextModel = models.find((item) => item.id === modelId);
    // 换模型后深度收敛到新模型的第一档，不保留上一个模型的值。
    const keep = nextModel?.efforts.includes(settings.reasoningEffort) ? settings.reasoningEffort : '';
    update({ model: modelId, reasoningEffort: keep || (nextModel?.efforts[0] ?? '') });
  };

  const commitConnection = () => {
    update({ bridgeUrl: connectionDraft.bridgeUrl, token: connectionDraft.token });
  };

  const commitNumbers = () => {
    update({ maxConcurrent: numberDraft.maxConcurrent, maxQueued: numberDraft.maxQueued });
  };

  if (!modelsHost) return <p className="text-sm text-error">模型目录服务不可用，无法读取可用模型。</p>;
  if (!loaded) return <p className="text-sm text-base-content/60">正在读取插件配置…</p>;

  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] leading-snug text-base-content/40">
        角色人设由应用自动注入，这里只配置桥接通道与场景说明。
      </p>
      {saveError
        ? <span role="alert" className="text-[11px] text-error">保存失败：{saveError}</span>
        : saved ? <span role="status" className="text-[11px] text-base-content/45">已保存</span> : null}
    </div>

    {/* 前两行各三列，第三行两列；都在这里直接输入，不再用只读摘要重复一遍。 */}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="桥接地址">
        <input className="input input-sm w-full font-mono text-xs" value={connectionDraft.bridgeUrl}
          spellCheck={false} placeholder="ws://127.0.0.1:6198/ws"
          onChange={(event) => setConnectionDraft((current) => ({ ...current, bridgeUrl: event.target.value }))}
          onBlur={commitConnection}
          onKeyDown={(event) => { if (event.key === 'Enter') commitConnection(); }} />
      </Field>

      <Field label="访问令牌">
        <div className="relative">
          <input className="input input-sm w-full pr-9 font-mono text-xs" value={connectionDraft.token}
            type={revealToken ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="可留空"
            onChange={(event) => setConnectionDraft((current) => ({ ...current, token: event.target.value }))}
            onBlur={commitConnection}
            onKeyDown={(event) => { if (event.key === 'Enter') commitConnection(); }} />
          <button type="button" title={revealToken ? '隐藏' : '显示'}
            aria-label={revealToken ? '隐藏访问令牌' : '显示访问令牌'}
            onClick={() => setRevealToken((value) => !value)}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-field
              text-base-content/40 transition-colors hover:text-base-content/80">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
              strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
              <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
              <circle cx="12" cy="12" r="2.6" />
              {revealToken && <path d="M4 4l16 16" />}
            </svg>
          </button>
        </div>
      </Field>

      <Field label="对话模型" tone="warn"
        hint={settings.model && selectedModel
          ? undefined
          : (!settings.model ? '未选择时 AstrBot 的请求会失败' : '该模型已不在清单里，请重新选择')}>
        <select className="select select-sm w-full font-mono text-xs" value={settings.model}
          onChange={(event) => updateModel(event.target.value)}>
          <option value="">请选择模型</option>
          {models.map(({ id }) => <option key={id} value={id}>{id}</option>)}
        </select>
      </Field>

      <Field label="思考深度">
        <select className="select select-sm w-full font-mono text-xs" value={shownEffort}
          disabled={!efforts.length}
          onChange={(event) => update({ reasoningEffort: event.target.value })}>
          {efforts.length
            ? efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)
            : <option value="">{settings.model ? '不支持' : '先选择模型'}</option>}
        </select>
      </Field>

      <Field label="交互策略">
        <select className="select select-sm w-full" value={settings.interactionMode}
          onChange={(event) => update({ interactionMode: event.target.value as AstrBotBridgeSettings['interactionMode'] })}>
          {MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <span className="text-[11px] leading-snug text-base-content/40">{mode.description}</span>
      </Field>

      <Field label="并发 / 排队上限" hint="左：同时生成上限（排队模式固定 1）· 右：队列上限">
        <div className="flex items-center gap-1.5">
          <input className="input input-sm w-full min-w-0" type="number" min={1} max={8}
            aria-label="最大并发"
            value={settings.interactionMode === 'queue' ? 1 : numberDraft.maxConcurrent}
            disabled={settings.interactionMode === 'queue'}
            onChange={(event) => setNumberDraft((current) => ({ ...current, maxConcurrent: Number(event.target.value) }))}
            onBlur={commitNumbers} />
          <span className="shrink-0 text-[11px] text-base-content/30">/</span>
          <input className="input input-sm w-full min-w-0" type="number" min={0} max={100}
            aria-label="最大排队数" value={numberDraft.maxQueued}
            onChange={(event) => setNumberDraft((current) => ({ ...current, maxQueued: Number(event.target.value) }))}
            onBlur={commitNumbers} />
        </div>
      </Field>

      <Field label="展示语言">
        <select className="select select-sm w-full" value={settings.displayLang}
          onChange={(event) => update({ displayLang: event.target.value as AstrBotBridgeSettings['displayLang'] })}>
          {DISPLAY_LANGS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </Field>

      <Field label="朗读文本" hint={settings.speakLang ? undefined : '仅文字：不生成朗读文本'}>
        <select className="select select-sm w-full" value={settings.speakLang}
          onChange={(event) => update({ speakLang: event.target.value as AstrBotBridgeSettings['speakLang'] })}>
          {SPEAK_LANGS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </Field>
    </div>

    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-base-content/50">场景说明</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-base-content/35">
            {promptDraft.length} 字{promptDirty ? ' · 有未保存的修改' : ''}
          </span>
          {promptDirty && (
            <button type="button" className="btn btn-ghost btn-xs"
              onClick={() => { setPromptDraft(DEFAULT_ASTRBOT_SETTINGS.systemPrompt); update({ systemPrompt: DEFAULT_ASTRBOT_SETTINGS.systemPrompt }); }}>
              恢复默认
            </button>
          )}
        </div>
      </div>
      <textarea className="textarea h-56 w-full resize-y text-xs leading-relaxed" value={promptDraft}
        placeholder="例如：QQ 群聊场景，每条不超过两句话，避免使用列表和标题"
        onChange={(event) => setPromptDraft(event.target.value)}
        onBlur={() => update({ systemPrompt: promptDraft })} />
    </div>
  </div>;
}
