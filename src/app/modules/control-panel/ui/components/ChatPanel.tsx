import { useEffect, useRef } from 'react';
import type { DragEventHandler, ReactNode, Ref, TextareaHTMLAttributes } from 'react';

interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  status: 'done' | 'sending' | 'error';
  error?: string;
}

type ComposerInputProps = Pick<TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange' | 'onSelect' | 'onKeyDown' | 'aria-controls' | 'aria-activedescendant'>;

interface ChatComposerProps {
  draft: string;
  busy: boolean;
  inputLabel: string;
  placeholder: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  inputRef?: Ref<HTMLTextAreaElement>;
  inputProps?: ComposerInputProps;
  toolbar?: ReactNode;
  suggestions?: ReactNode;
}

/** 公共输入行为：中文输入法、Shift+Enter、空输入与发送中状态统一处理。 */
export function ChatComposer({ draft, busy, inputLabel, placeholder, onDraftChange, onSubmit,
  inputRef, inputProps, toolbar, suggestions }: ChatComposerProps) {
  const submit = () => { if (!busy && draft.trim()) void onSubmit(); };
  return <div className="rounded-box border border-base-300 bg-base-100 p-3">
    {toolbar}
    <div className="relative">
      {suggestions}
      <textarea {...inputProps} ref={inputRef} rows={4} value={draft} disabled={busy}
        className="textarea textarea-bordered min-h-32 w-full resize-none pr-20 outline-0"
        aria-label={inputLabel} placeholder={placeholder}
        onChange={(event) => { onDraftChange(event.target.value); inputProps?.onChange?.(event); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          // @候选等扩展先处理按键；preventDefault 后公共发送逻辑不再消费。
          inputProps?.onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          submit();
        }} />
      <button type="button" className="btn btn-sm btn-primary absolute bottom-3 right-3"
        disabled={busy || !draft.trim()} onClick={submit}>发送</button>
    </div>
  </div>;
}

interface ChatPanelProps<T extends ChatMessageView> extends ChatComposerProps {
  title: string;
  description: string;
  messages: readonly T[];
  emptyMessage: string;
  onClear: () => void;
  error?: string | null;
  heightClassName?: string;
  beforeHeader?: ReactNode;
  footer?: ReactNode;
  renderMessageDetails?: (message: T) => ReactNode;
  renderMessageError?: (message: T) => ReactNode;
  onDragOver?: DragEventHandler<HTMLElement>;
  onDrop?: DragEventHandler<HTMLElement>;
}

/** 只接收展示数据和回调；任务状态、语音、动作引用与缓存由各自业务拥有。 */
export default function ChatPanel<T extends ChatMessageView>({ title, description, messages, emptyMessage,
  onClear, error, heightClassName = 'h-[55vh] min-h-96', beforeHeader, footer,
  renderMessageDetails, renderMessageError, onDragOver, onDrop, ...composer }: ChatPanelProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const lastText = messages.at(-1)?.text;
  useEffect(() => {
    const list = listRef.current;
    if (list && followBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages.length, lastText, composer.busy]);

  return <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3"
    onDragOver={onDragOver} onDrop={onDrop}>
    {beforeHeader}
    <header className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-base-content/60">{description}</div>
      </div>
      <button type="button" className="btn btn-ghost btn-xs" disabled={composer.busy || !messages.length}
        onClick={onClear}>清空对话</button>
    </header>
    <div className="rounded-box border border-base-300 bg-base-200/40 p-3">
      <div className={`flex flex-col gap-3 ${heightClassName}`}>
        <div ref={listRef} role="log" aria-label={title} aria-live="polite"
          onScroll={(event) => {
            const list = event.currentTarget;
            followBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
          }}
          className="min-h-0 flex-1 rounded-box border border-base-300 bg-base-300 p-3 overflow-y-auto space-y-3">
          {!messages.length && <div className="rounded-box border border-dashed border-base-300 bg-base-100/70 p-3 text-xs text-base-content/60">{emptyMessage}</div>}
          {messages.map((message) => <div key={message.id} className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}>
            <div className="chat-header text-[11px] text-base-content/50">{message.role === 'user' ? '你' : message.role === 'system' ? '系统' : 'AI'}</div>
            <div className={`chat-bubble ${message.role === 'user' ? 'chat-bubble-primary' : message.role === 'system' ? 'chat-bubble-warning' : ''}`}>
              <div className="whitespace-pre-wrap wrap-break-word text-sm">{message.text}</div>
              {renderMessageDetails?.(message)}
              {message.status === 'sending' && <span aria-label="发送中" className="loading loading-dots loading-xs mt-1" />}
              {message.status === 'error' && <div className="mt-1 text-[11px] opacity-70">{renderMessageError ? renderMessageError(message) : message.error}</div>}
            </div>
          </div>)}
        </div>
        <ChatComposer {...composer} />
      </div>
    </div>
    {error && <div className="text-xs text-error" role="alert">{error}</div>}
    {footer && <div className="text-xs text-base-content/60">{footer}</div>}
  </section>;
}
