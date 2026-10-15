import { useEffect, useRef, useState } from 'react';
import type { ActionSettingsView, ActionSettingsCallbacks } from '../../modules/action-settings/domain/view';
import { actionMention, activeMention, referencedActionIds } from '../../modules/action-settings/domain/session';

export const ACTION_DRAG_TYPE = 'application/x-live2d-action';

const ActionCatalogChat = ({ view, onDraftChange, onSubmit, onClearChat }: { view: ActionSettingsView } & Pick<ActionSettingsCallbacks, 'onDraftChange' | 'onSubmit' | 'onClearChat'>) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);
  const [choice, setChoice] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const mention = dismissed ? null : activeMention(view.draft, cursor);
  const suggestions = mention ? view.actions.filter((action) => action.id.includes(mention.query)
    || action.label.toLowerCase().includes(mention.query)) : [];
  const selectedChoice = Math.min(choice, Math.max(0, suggestions.length - 1));
  const referenceIds = referencedActionIds(view.draft);
  const lastText = view.messages.at(-1)?.text;

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [view.messages.length, lastText]);

  const insertText = (text: string, replaceMention = false) => {
    if (view.busy) return;
    const input = inputRef.current;
    const start = replaceMention && mention ? mention.start : input?.selectionStart ?? view.draft.length;
    const end = input?.selectionEnd ?? start;
    const prefix = view.draft.slice(0, start);
    const insertion = `${prefix && !/\s$/.test(prefix) ? ' ' : ''}${text} `;
    onDraftChange(prefix + insertion + view.draft.slice(end));
    const nextCursor = start + insertion.length;
    setCursor(nextCursor);
    setDismissed(true);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3"
      onDragOver={(event) => {
        if (!view.busy && event.dataTransfer.types.includes(ACTION_DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        const id = event.dataTransfer.getData(ACTION_DRAG_TYPE);
        if (!view.actions.some((action) => action.id === id)) return;
        event.preventDefault();
        insertText(actionMention(id));
      }}>
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">动作表微调</div>
          <div className="text-xs text-base-content/60">输入 @ 选择动作，或拖入上方动作；可以直接描述新增、删除和调整要求。</div>
        </div>
        <button type="button" className="btn btn-ghost btn-xs" disabled={view.busy || !view.messages.length}
          onClick={onClearChat}>清空对话</button>
      </header>
      <div className="rounded-box border border-base-300 bg-base-200/40 p-3">
        <div className="flex h-[55vh] min-h-96 flex-col gap-3">
          <div className="min-h-0 flex-1 rounded-box border border-base-300 bg-base-300 p-3 overflow-y-auto space-y-3" aria-live="polite">
            {view.messages.length === 0 && (
              <div className="rounded-box border border-dashed border-base-300 bg-base-100/70 p-3 text-xs text-base-content/60">
                例如：“新增一个害羞动作”，或引用某个动作后说“把这个动作换成更明显的转头”。
              </div>
            )}
            {view.messages.map((message) => (
              <div key={message.id} className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}>
                <div className="chat-header text-[11px] text-base-content/50">
                  {message.role === 'user' ? '你' : message.role === 'system' ? '系统' : 'AI'}
                </div>
                <div className={`chat-bubble ${message.role === 'user' ? 'chat-bubble-primary'
                  : message.role === 'system' ? 'chat-bubble-warning' : ''}`}>
                  <div className="whitespace-pre-wrap wrap-break-word text-sm">{message.text}</div>
                  {message.status === 'sending' && <span className="loading loading-dots loading-xs mt-1" />}
                  {message.status === 'error' && <div className="mt-1 text-[11px] opacity-70">调整未完成，原动作表已保留。</div>}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="rounded-box border border-base-300 bg-base-100 p-3">
            <div className="flex flex-wrap gap-1 mb-2">
              {referenceIds.map((id) => <span key={id} className={`badge badge-sm ${view.actions.some((action) => action.id === id)
                ? 'badge-primary badge-outline' : 'badge-error badge-outline'}`}>
                @{view.actions.find((action) => action.id === id)?.label ?? id}
              </span>)}
              <button type="button" className="btn btn-ghost btn-xs" disabled={view.busy}
                onClick={() => insertText('新增一个动作：')}>＋ 新增动作</button>
            </div>
            <div className="relative">
              {mention && !view.busy && (
                <div id="action-mention-options" role="listbox" aria-label="选择动作"
                  className="absolute bottom-full mb-1 w-full max-h-48 overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow-lg z-10">
                  {suggestions.length ? suggestions.map((action, index) => (
                    <button key={action.id} id={`action-option-${action.id}`} type="button" role="option"
                      aria-selected={index === selectedChoice}
                      className={`flex w-full items-center justify-between px-3 py-2 text-sm ${index === selectedChoice ? 'bg-base-200' : ''}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertText(actionMention(action.id), true)}>
                      <span>{action.label}</span><span className="text-xs opacity-60">{action.id}</span>
                    </button>
                  )) : <div className="p-3 text-xs opacity-60">没有匹配动作</div>}
                </div>
              )}
              <textarea ref={inputRef} rows={4} value={view.draft} disabled={view.busy}
                className="textarea textarea-bordered min-h-32 w-full resize-none pr-20 outline-0"
                aria-label="动作表微调输入" aria-controls={mention ? 'action-mention-options' : undefined}
                aria-activedescendant={mention && suggestions[selectedChoice] ? `action-option-${suggestions[selectedChoice].id}` : undefined}
                placeholder="描述调整要求，输入 @ 引用动作。Shift+Enter 换行，Enter 发送"
                onChange={(event) => {
                  onDraftChange(event.target.value);
                  setCursor(event.target.selectionStart);
                  setChoice(0);
                  setDismissed(false);
                }}
                onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (mention && suggestions.length && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault();
                    setChoice((selectedChoice + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
                    return;
                  }
                  if (event.key === 'Escape') { setDismissed(true); return; }
                  if (event.key !== 'Enter' || event.shiftKey) return;
                  event.preventDefault();
                  if (mention && suggestions.length) insertText(actionMention(suggestions[selectedChoice].id), true);
                  else void onSubmit();
                }}
              />
              <button type="button" className="btn btn-sm btn-primary absolute bottom-3 right-3"
                disabled={view.busy || !view.draft.trim()} onClick={() => void onSubmit()}>发送</button>
            </div>
          </div>
        </div>
      </div>
      {view.error && <div className="text-xs text-error" role="alert">{view.error}</div>}
      <p className="text-xs text-base-content/60">对话和草稿按当前模型自动缓存；动作表调整后自动保存。</p>
    </section>
  );
};

export default ActionCatalogChat;
