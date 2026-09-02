import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, GlobalUiSettings, ModelEntry } from '../../domain/types';

const SCALE_PERSIST_DEBOUNCE_MS = 250;

export default function HomePage({
  model,
  globalSettings,
  onGlobalSettingsChange,
  onScalePreview,
  onGotoModels,
  chatMessages,
  chatDraft,
  chatSending,
  chatError,
  asrEnabled,
  asrState,
  asrPartialText,
  asrError,
  asrSwitchLoading,
  onChatDraftChange,
  onChatSubmit,
  onClearChat,
  onToggleAsr,
}: {
  model: ModelEntry;
  globalSettings: GlobalUiSettings;
  onGlobalSettingsChange: (patch: Partial<GlobalUiSettings>) => Promise<void>;
  onScalePreview: (scale: number) => void;
  onGotoModels: () => void;
  chatMessages: ChatMessage[];
  chatDraft: string;
  chatSending: boolean;
  chatError: string | null;
  asrEnabled: boolean;
  asrState: PetMicState;
  asrPartialText: string;
  asrError: string | null;
  asrSwitchLoading: boolean;
  onChatDraftChange: (value: string) => void;
  onChatSubmit: () => void;
  onClearChat: () => void;
  onToggleAsr: (nextEnabled: boolean) => void | Promise<void>;
}) {
  const [scaleDraft, setScaleDraft] = useState(globalSettings.scale);
  const scaleLabel = useMemo(() => scaleDraft.toFixed(2), [scaleDraft]);
  const scalePersistTimerRef = useRef<number | null>(null);
  const latestScaleRef = useRef(globalSettings.scale);
  const scaleDraggingRef = useRef(false);
  const ignoreRemoteScaleUntilRef = useRef(0);
  const scaleDirtyRef = useRef(false);
  const persistScaleRef = useRef(onGlobalSettingsChange);

  useEffect(() => {
    persistScaleRef.current = onGlobalSettingsChange;
  }, [onGlobalSettingsChange]);

  useEffect(() => {
    // SharedWorker delivery is asynchronous. Its older echo must not move a range
    // thumb that is currently owned by the pointer gesture.
    if (scaleDraggingRef.current) return;
    if (performance.now() < ignoreRemoteScaleUntilRef.current) return;
    latestScaleRef.current = globalSettings.scale;
    setScaleDraft(globalSettings.scale);
  }, [globalSettings.scale]);

  const scheduleScalePersist = useCallback((nextScale: number) => {
    latestScaleRef.current = nextScale;
    scaleDirtyRef.current = true;
    if (scalePersistTimerRef.current != null) {
      window.clearTimeout(scalePersistTimerRef.current);
    }
    scalePersistTimerRef.current = window.setTimeout(() => {
      scalePersistTimerRef.current = null;
      scaleDirtyRef.current = false;
      persistScaleRef.current({ scale: latestScaleRef.current }).catch(() => {});
    }, SCALE_PERSIST_DEBOUNCE_MS);
  }, []);

  const finishScaleGesture = useCallback(() => {
    if (!scaleDraggingRef.current) return;
    scaleDraggingRef.current = false;
    const finalScale = latestScaleRef.current;
    // Re-publish the final sample so a coalesced worker batch cannot finish on an
    // earlier pointer sample.
    ignoreRemoteScaleUntilRef.current = performance.now() + 50;
    onScalePreview(finalScale);
    scheduleScalePersist(finalScale);
  }, [onScalePreview, scheduleScalePersist]);

  useEffect(() => {
    return () => {
      if (scalePersistTimerRef.current != null) {
        window.clearTimeout(scalePersistTimerRef.current);
        scalePersistTimerRef.current = null;
      }
      if (!scaleDirtyRef.current) return;
      persistScaleRef.current({ scale: latestScaleRef.current }).catch(() => {});
    };
  }, []);

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
            value={scaleDraft}
            onPointerDown={() => {
              scaleDraggingRef.current = true;
            }}
            onPointerUp={finishScaleGesture}
            onPointerCancel={finishScaleGesture}
            onBlur={finishScaleGesture}
            onChange={(e) => {
              const nextScale = Number.parseFloat(e.target.value);
              setScaleDraft(nextScale);
              latestScaleRef.current = nextScale;
              ignoreRemoteScaleUntilRef.current = performance.now() + 50;
              onScalePreview(nextScale);
              scheduleScalePersist(nextScale);
            }}
            className="range range-xs"
          />
        </section>

        {/* 文字对话框 */}
        <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
          <div className="rounded-box border border-base-300 bg-base-200/50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">麦克风（ASR）</div>
                <div className="text-xs text-base-content/60">
                  状态：{asrState}
                </div>
              </div>
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={asrEnabled}
                disabled={asrSwitchLoading}
                onChange={(e) => onToggleAsr(e.target.checked)}
              />
            </div>
            {asrPartialText && (
              <div className="mt-2 text-xs text-base-content/70 break-all">
                识别中：{asrPartialText}
              </div>
            )}
            {asrError && (
              <div className="mt-2 text-xs text-error break-all">
                错误：{asrError}
              </div>
            )}
          </div>

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
