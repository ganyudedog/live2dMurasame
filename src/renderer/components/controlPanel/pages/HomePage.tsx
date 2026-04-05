import { useEffect, useMemo, useRef } from 'react';
import type { ChatMessage, GlobalUiSettings, ModelEntry } from '../types';
import { sharedStoreClient } from '../../../shared/sharedStoreClient';

const SCALE_PERSIST_DEBOUNCE_MS = 250;

export default function HomePage({
  model,
  globalSettings,
  onGlobalSettingsChange,
  onGotoModels,
  chatMessages,
  chatDraft,
  chatSending,
  chatError,
  onChatDraftChange,
  onChatSubmit,
  onClearChat,
}: {
  model: ModelEntry;
  globalSettings: GlobalUiSettings;
  onGlobalSettingsChange: (patch: Partial<GlobalUiSettings>) => Promise<void>;
  onGotoModels: () => void;
  chatMessages: ChatMessage[];
  chatDraft: string;
  chatSending: boolean;
  chatError: string | null;
  onChatDraftChange: (value: string) => void;
  onChatSubmit: () => void;
  onClearChat: () => void;
}) {
  const scaleLabel = useMemo(() => globalSettings.scale.toFixed(2), [globalSettings.scale]);

  const scalePersistTimerRef = useRef<number | null>(null);
  const latestScaleRef = useRef(globalSettings.scale);

  useEffect(() => {
    latestScaleRef.current = globalSettings.scale;
  }, [globalSettings.scale]);

  useEffect(() => {
    return () => {
      if (scalePersistTimerRef.current == null) return;
      window.clearTimeout(scalePersistTimerRef.current);
      scalePersistTimerRef.current = null;
      const last = latestScaleRef.current;
      onGlobalSettingsChange({ scale: last }).catch(() => {});
    };
  }, [onGlobalSettingsChange]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">首页</h1>
          <p className="text-xs text-base-content/60">当前模型与基本操作</p>
        </div>
        <button type="button" className="btn btn-sm btn-outline" onClick={onGotoModels}>
          切换模型
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* 当前模型 */}
        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <header className="flex items-center justify-between">
            <div className="text-sm font-medium">当前模型</div>
            <span className="badge badge-outline">{model.id}</span>
          </header>
          <div className="text-sm">名称：{model.name}</div>
          <div className="text-xs text-base-content/60 break-all">路径：{model.path}</div>
        </section>

        {/* Scale 调整 */}
        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <header className="flex items-center justify-between">
            <div className="text-sm font-medium">缩放</div>
            <span className="text-xs text-base-content/60">{scaleLabel}</span>
          </header>
          <input
            type="range"
            min={0.3}
            max={2}
            step={0.01}
            value={globalSettings.scale}
            onChange={(e) => {
              const nextScale = Number.parseFloat(e.target.value);
              sharedStoreClient.dispatchPatch([{ path: 'global.scale', value: nextScale }]);

              latestScaleRef.current = nextScale;
              if (scalePersistTimerRef.current != null) {
                window.clearTimeout(scalePersistTimerRef.current);
                scalePersistTimerRef.current = null;
              }
              scalePersistTimerRef.current = window.setTimeout(() => {
                scalePersistTimerRef.current = null;
                onGlobalSettingsChange({ scale: latestScaleRef.current }).catch(() => {});
              }, SCALE_PERSIST_DEBOUNCE_MS);
            }}
            className="range range-xs"
          />
        </section>

        {/* 文字对话框 */}
        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <header className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">对话</div>
              <div className="text-xs text-base-content/60">文字输入会在前端请求千问，并在返回后触发 TTS 合成</div>
            </div>
            <button type="button" className="btn btn-ghost btn-xs" onClick={onClearChat} disabled={chatSending || chatMessages.length === 0}>
              清空
            </button>
          </header>
          <div className="rounded-box border border-base-300 bg-base-200/40 p-3">
            <div className="flex h-[70vh] flex-col gap-3">
              <div className="min-h-0 flex-1 rounded-box border border-base-300 bg-base-300 p-3">
                <div className="h-full space-y-3 overflow-y-scroll pr-1">
                  {chatMessages.length === 0 && (
                    <div className="rounded-box border border-dashed border-base-300 bg-base-100/70 p-3 text-xs text-base-content/60">
                      当前模型暂无会话缓存。你可以在这里输入文字，后续 ASR 也会汇入同一条处理链路。
                    </div>
                  )}
                  {chatMessages.map((message) => {
                    const bubbleClass = message.role === 'user'
                      ? 'chat-bubble chat-bubble-primary'
                      : message.role === 'system'
                        ? 'chat-bubble chat-bubble-warning'
                        : 'chat-bubble';
                    const alignClass = message.role === 'user' ? 'chat-end' : 'chat-start';
                    const label = message.role === 'user' ? '你' : message.role === 'system' ? '系统' : 'AI';
                    return (
                      <div key={message.id} className={`chat ${alignClass}`}>
                        <div className="chat-header text-[11px] text-base-content/50">{label}</div>
                        <div className={bubbleClass}>
                          <div className="whitespace-pre-wrap wrap-break-word text-sm">{message.text}</div>
                          {message.status === 'sending' && <div className="mt-1 text-[11px] opacity-70">发送中...</div>}
                          {message.status === 'error' && message.error && <div className="mt-1 text-[11px] opacity-80">{message.error}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-box border border-base-300 bg-base-100 p-3">
                <div className="relative">
                  <textarea
                    className="textarea textarea-bordered min-h-32 w-full resize-none pr-20 outline-0"
                    rows={4}
                    placeholder="在这里与 AI 对话，Shift+Enter 换行，Enter 发送"
                    value={chatDraft}
                    disabled={chatSending}
                    onChange={(e) => onChatDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.shiftKey) return;
                      e.preventDefault();
                      onChatSubmit();
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary absolute bottom-3 right-3"
                    onClick={onChatSubmit}
                    disabled={chatSending || !chatDraft.trim()}
                  >
                    发送
                  </button>
                </div>
              </div>
            </div>
          </div>
          {chatError && <div className="text-xs text-error">{chatError}</div>}
          <div className="text-xs text-base-content/60">
            说明：这里的会话只做本地缓存恢复；RAG 与 memory 在前端运行时处理，TTS 仅在千问返回文本后触发。
          </div>
        </section>
      </div>
    </div>
  );
}
