import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiHostApi, AstrBotUiContext } from '../types';
import { DEFAULT_ASTRBOT_SETTINGS, normalizeSettings, type AstrBotBridgeSettings } from '../settings';

const getModelsHost = (context: AstrBotUiContext): AiHostApi | null => {
  const value = context.hostApi.ai;
  return value
    && typeof value.getModels === 'function'
    && typeof value.subscribe === 'function'
    ? value : null;
};

const toMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * 各设置页共用的桥接配置：读取一次、每次改动立即落盘，并给出保存反馈。
 * 页面各自持有输入草稿，只在提交时调用 update。
 */
export function useBridgeSettings(context: AstrBotUiContext) {
  const modelsHost = useMemo(() => getModelsHost(context), [context]);
  const [models, setModels] = useState<readonly { id: string; efforts: readonly string[] }[]>([]);
  const [settings, setSettings] = useState<AstrBotBridgeSettings>(DEFAULT_ASTRBOT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
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

  return { modelsHost, models, settings, loaded, saveError, saved, update };
}

export type BridgeSettingsStore = ReturnType<typeof useBridgeSettings>;
