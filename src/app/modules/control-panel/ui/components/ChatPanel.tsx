import { useEffect, useRef } from 'react';
import type { DragEventHandler, KeyboardEvent, ReactNode, Ref, TextareaHTMLAttributes } from 'react';
import type { ActionCategory } from '../../../../../../shared/actionCatalog.js';

interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  status: 'done' | 'sending' | 'error';
  error?: string;
}

/** 输入框里整体成块的引用标签：文本就是 @显示名，发送前才还原成稳定 ID。 */
export interface ChatMention {
  id: string;
  label: string;
  category: ActionCategory;
}

const MENTION_TONES: Record<ActionCategory, string> = {
  head: 'bg-primary/20',
  gaze: 'bg-info/20',
  blink: 'bg-success/20',
  emotion: 'bg-warning/25',
  body: 'bg-secondary/20',
  other: 'bg-base-content/15',
};

function mentionTokens(mentions: readonly ChatMention[]): string[] {
  return mentions
    .map((mention) => mention.label.trim())
    .filter((token) => token.length > 0)
    .sort((left, right) => right.length - left.length);
}

/**
 * 只画标签底色、不动排版：标签文本本身就是显示名，所以与 textarea 逐字对齐，
 * 光标、换行、点选都落在真实位置上。
 */
function renderMentionHighlights(text: string, mentions: readonly ChatMention[]): ReactNode {
  const tokens = mentionTokens(mentions);
  if (!tokens.length) return text;
  const toneOf = new Map(mentions.map((mention) =>
    [mention.label.trim(), MENTION_TONES[mention.category] ?? MENTION_TONES.other]));
  const parts: ReactNode[] = [];
  let plain = '';
  let cursor = 0;
  while (cursor < text.length) {
    const token = tokens.find((value) => text.startsWith(value, cursor));
    if (!token) { plain += text[cursor]; cursor += 1; continue; }
    if (plain) { parts.push(plain); plain = ''; }
    parts.push(<span key={cursor} className={`rounded-sm ${toneOf.get(token)}`}>{token}</span>);
    cursor += token.length;
  }
  if (plain) parts.push(plain);
  return parts;
}

/** 标签在文本中的位置，用于整块删除。 */
function mentionSpans(text: string, mentions: readonly ChatMention[]): Array<{ start: number; end: number }> {
  const tokens = mentionTokens(mentions);
  if (!tokens.length) return [];
  const spans: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const token = tokens.find((value) => text.startsWith(value, cursor));
    if (!token) { cursor += 1; continue; }
    spans.push({ start: cursor, end: cursor + token.length });
    cursor += token.length;
  }
  return spans;
}

/** 输入区语音开关的展示投影；共享组件不持有 ASR 服务，只接收状态与回调。 */
export interface ChatVoiceInput {
  enabled: boolean;
  /** 开关旁的短语，例如“识别中”“等待授权”；缺省时显示“语音输入”。 */
  statusLabel?: string | null;
  /** 实时识别文本，展示在输入框上方。 */
  partialText?: string;
  /** 语音链路错误，展示在输入框上方。 */
  errorText?: string | null;
  /** 切换进行中，禁用开关。 */
  loading?: boolean;
  onChange: (next: boolean) => void;
}

/** 输入区思考深度：选项文案由聊天框自带，业务只提供当前值与回调。 */
export interface ChatReasoningEffort {
  value: PetReasoningEffort;
  disabled?: boolean;
  onChange: (effort: PetReasoningEffort) => void;
}

const REASONING_OPTIONS: ReadonlyArray<{ value: PetReasoningEffort; label: string }> = [
  { value: 'none', label: '关闭' },
  { value: 'minimal', label: '最少' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '最高' },
];

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
  reasoningEffort?: ChatReasoningEffort;
  /** 可被识别成名称胶囊的引用；只有动作编辑这类业务需要传入。 */
  mentions?: readonly ChatMention[];
  /** 思考深度右侧的插槽：放属于本次会话的附加操作，例如清空对话。 */
  toolbar?: ReactNode;
  suggestions?: ReactNode;
  voiceInput?: ChatVoiceInput;
}

/** 公共输入行为：中文输入法、Shift+Enter、空输入与发送中状态统一处理。 */
export function ChatComposer({ draft, busy, inputLabel, placeholder, onDraftChange, onSubmit,
  inputRef, inputProps, reasoningEffort, mentions, toolbar, suggestions, voiceInput }: ChatComposerProps) {
  const submit = () => { if (!busy && draft.trim()) void onSubmit(); };
  // 原生与 daisyUI 的聚焦描边统一取消，输入区只靠排版区分层级。
  const noOutline = 'outline-none focus:outline-none focus-visible:outline-none';
  // select-ghost 自身没有 hover 态，补一层和 ghost 按钮一致的底色提示可点击。
  const selectHover = 'cursor-pointer transition-colors hover:bg-base-content/10 active:bg-base-content/15 disabled:cursor-not-allowed disabled:opacity-60';
  const chips = Boolean(mentions?.length);
  const layerOf = (input: HTMLTextAreaElement) =>
    input.parentElement?.querySelector<HTMLElement>('[data-mention-overlay]') ?? null;
  // 引用标签是整体：光标贴着标签时按退格/Delete 一次删除整块，而不是逐字删。
  const removeMentionToken = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
    const input = event.currentTarget;
    if (input.selectionStart !== input.selectionEnd) return false;
    const caret = input.selectionStart;
    const back = event.key === 'Backspace';
    const hit = mentionSpans(draft, mentions ?? []).find((span) =>
      back ? caret > span.start && caret <= span.end : caret >= span.start && caret < span.end);
    if (!hit) return false;
    // 顺带吃掉标签后的一个空格，避免留下双空格。
    const end = draft[hit.end] === ' ' ? hit.end + 1 : hit.end;
    event.preventDefault();
    onDraftChange(draft.slice(0, hit.start) + draft.slice(end));
    requestAnimationFrame(() => input.setSelectionRange(hit.start, hit.start));
    return true;
  };
  return <div className="p-3">
    {(reasoningEffort || toolbar) && (
      <div className="mb-1 flex flex-wrap items-center gap-2 px-1">
        {reasoningEffort && <>
          <span className="text-[11px] text-base-content/45">思考深度</span>
          <select
            aria-label="思考深度"
            title="随本轮请求下发，只影响下一轮回复；不修改 AI 设置"
            className={`select select-ghost select-xs w-20 text-xs ${selectHover} ${noOutline}`}
            value={reasoningEffort.value}
            disabled={reasoningEffort.disabled}
            onChange={(event) => reasoningEffort.onChange(event.target.value as PetReasoningEffort)}
          >
            {REASONING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </>}
        {toolbar}
      </div>
    )}
    {voiceInput?.partialText && (
      <p className="truncate px-2 pb-1 text-xs text-base-content/50">识别中：{voiceInput.partialText}</p>
    )}
    {voiceInput?.errorText && (
      <p className="px-2 pb-1 text-xs text-error">语音识别错误：{voiceInput.errorText}</p>
    )}
    <div className="relative">
      {suggestions}
      <div className="relative">
        {chips && (
          <div data-mention-overlay aria-hidden="true"
            className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap wrap-break-word
              px-2 py-1.5 text-sm leading-relaxed text-transparent ${busy ? 'opacity-60' : ''}`}>
            {renderMentionHighlights(draft, mentions ?? [])}
          </div>
        )}
        <textarea {...inputProps} ref={inputRef} rows={3} value={draft} disabled={busy}
          className={`min-h-20 max-h-60 w-full resize-none field-sizing-content overflow-y-auto bg-transparent
            px-2 py-1.5 text-sm leading-relaxed placeholder:text-base-content/40
            disabled:opacity-60 ${noOutline}`}
          aria-label={inputLabel} placeholder={placeholder}
          onChange={(event) => { onDraftChange(event.target.value); inputProps?.onChange?.(event); }}
          onScroll={(event) => {
            const layer = layerOf(event.currentTarget);
            if (layer) layer.scrollTop = event.currentTarget.scrollTop;
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            // 标签整体删除：光标贴着标签按退格/删除时一次吃掉整块。
            if (chips && removeMentionToken(event)) return;
            // @候选等扩展先处理按键；preventDefault 后公共发送逻辑不再消费。
            inputProps?.onKeyDown?.(event);
            if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            submit();
          }} />
      </div>
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          {voiceInput && (
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
              <input type="checkbox" className="toggle toggle-xs toggle-primary" aria-label="语音输入"
                checked={voiceInput.enabled} disabled={voiceInput.loading}
                onChange={(event) => voiceInput.onChange(event.target.checked)} />
              <span className={`truncate text-[11px] ${voiceInput.enabled ? 'text-primary' : 'text-base-content/40'}`}>
                {voiceInput.statusLabel ?? '语音输入'}
              </span>
            </label>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[11px] text-base-content/30 sm:inline">Enter 发送 · Shift+Enter 换行</span>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || !draft.trim()} onClick={submit}>
            发送
          </button>
        </div>
      </div>
    </div>
  </div>;
}

interface ChatPanelProps<T extends ChatMessageView> extends ChatComposerProps {
  title: string;
  description?: string;
  messages: readonly T[];
  emptyMessage: string;
  /** 提供时在标题行右侧渲染“清空对话”；首页把该操作放在输入区插槽里。 */
  onClear?: () => void;
  error?: string | null;
  /** 填满父容器高度（首页对话）；默认为固定高度（侧栏内的微调会话）。 */
  fill?: boolean;
  /** 是否渲染标题行；首页只保留消息与输入区。 */
  showHeader?: boolean;
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
  onClear, error, fill = false, showHeader = true, heightClassName = 'h-[55vh] min-h-96', beforeHeader, footer,
  renderMessageDetails, renderMessageError, onDragOver, onDrop, ...composer }: ChatPanelProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const lastText = messages.at(-1)?.text;
  useEffect(() => {
    const list = listRef.current;
    if (list && followBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages.length, lastText, composer.busy]);

  return <section className={`flex min-h-0 flex-col gap-3 ${fill ? 'flex-1' : ''}`}
    onDragOver={onDragOver} onDrop={onDrop}>
    {beforeHeader}
    {showHeader && (
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          {description && <div className="truncate text-xs text-base-content/50">{description}</div>}
        </div>
        {onClear && (
          <button type="button" className="btn btn-outline btn-error btn-xs"
            disabled={composer.busy || !messages.length} onClick={onClear}>清空对话</button>
        )}
      </header>
    )}
    {/* 消息区与输入区共用同一张带边框的卡片，与页面底色区分。 */}
    <div className={`flex min-h-0 flex-col rounded-box border border-base-300 bg-base-100
      ${fill ? 'flex-1' : heightClassName}`}>
      <div ref={listRef} role="log" aria-label={title} aria-live="polite"
        onScroll={(event) => {
          const list = event.currentTarget;
          followBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!messages.length && <div className="rounded-box bg-base-200/60 px-3 py-4 text-xs text-base-content/45">{emptyMessage}</div>}
        {messages.map((message) => <div key={message.id} className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'}`}>
          <div className="chat-header mb-1 text-[11px] text-base-content/40">
            {message.role === 'user' ? '你' : message.role === 'system' ? '系统' : 'AI'}
          </div>
          <div className={`chat-bubble text-sm ${message.role === 'user' ? 'chat-bubble-primary'
            : message.role === 'system' ? 'chat-bubble-warning' : ''}`}>
            <div className="whitespace-pre-wrap wrap-break-word">{message.text}</div>
            {renderMessageDetails?.(message)}
            {message.status === 'sending' && <span aria-label="发送中" className="loading loading-dots loading-xs mt-1" />}
            {message.status === 'error' && <div className="mt-1 text-[11px] opacity-70">
              {renderMessageError ? renderMessageError(message) : message.error}
            </div>}
          </div>
        </div>)}
      </div>
      <div className="border-t border-base-300">
        <ChatComposer {...composer} />
      </div>
      {error && <div className="border-t border-base-300 px-4 py-2 text-xs text-error" role="alert">{error}</div>}
      {footer && <div className="border-t border-base-300 px-4 py-2 text-xs text-base-content/50">{footer}</div>}
    </div>
  </section>;
}
