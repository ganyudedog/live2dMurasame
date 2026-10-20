import { useEffect, useRef, useState } from 'react';
import ChatPanel from '../components/ChatPanel';
import Modal from '../components/Modal';
import type { ActionSettingsView, ActionSettingsCallbacks } from '../../modules/action-settings/domain/view';
import { actionMention, activeMention } from '../../modules/action-settings/domain/session';
import type { ActionCategory } from '../../../../../../shared/actionCatalog.js';

const CATEGORY_META: Record<ActionCategory, { label: string; badge: string; stamp: string; dot: string }> = {
  head: { label: '头部', badge: 'badge-primary', stamp: 'bg-primary/15 text-primary', dot: 'bg-primary' },
  gaze: { label: '视线', badge: 'badge-info', stamp: 'bg-info/15 text-info', dot: 'bg-info' },
  blink: { label: '眨眼', badge: 'badge-success', stamp: 'bg-success/15 text-success', dot: 'bg-success' },
  emotion: { label: '情绪', badge: 'badge-warning', stamp: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  body: { label: '身体', badge: 'badge-secondary', stamp: 'bg-secondary/15 text-secondary', dot: 'bg-secondary' },
  other: { label: '其他', badge: 'badge-ghost', stamp: 'bg-base-content/10 text-base-content/70', dot: 'bg-base-content/40' },
};

const MIC_STATE_LABEL: Record<PetMicState, string> = {
  off: '语音输入',
  requesting: '等待授权',
  active: '识别中',
  denied: '未授权',
  error: '异常',
};

/** 语音开关的展示投影，与首页共用同一套 ASR 状态。 */
export interface MotionVoiceProps {
  enabled: boolean;
  state: PetMicState;
  partialText: string;
  error: string | null;
  loading: boolean;
  onToggle: (next: boolean) => void;
}

const MotionSettingsPage = ({ view, voice, onGenerate, onCancel, onSelect, onDraftChange, onPreview, onDelete,
  onUpdateMetadata, onSubmit, onClearChat, onReasoningEffortChange }: {
  view: ActionSettingsView;
  voice: MotionVoiceProps;
  onReasoningEffortChange: (effort: PetReasoningEffort) => void;
} & ActionSettingsCallbacks) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [listOpen, setListOpen] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string; description: string } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [choice, setChoice] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // 事件回调用 ref 读最新草稿，避免键盘每敲一下就重挂文档监听。
  const editingRef = useRef(editing);
  const committingRef = useRef('');
  useEffect(() => { editingRef.current = editing; }, [editing]);
  const editingId = editing?.id ?? null;

  const mention = dismissed ? null : activeMention(view.draft, cursor);
  const suggestions = mention ? view.actions.filter((action) => action.id.includes(mention.query)
    || action.label.toLowerCase().includes(mention.query)) : [];
  const selectedChoice = Math.min(choice, Math.max(0, suggestions.length - 1));
  const labelOf = (id: string) => view.actions.find((action) => action.id === id)?.label ?? id;
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
  /** 退出编辑态并保存；同一张卡同时只提交一次。 */
  const commitEditing = () => {
    const current = editingRef.current;
    if (!current || committingRef.current === current.id) return;
    committingRef.current = current.id;
    void onUpdateMetadata(current.id, current.label, current.description).finally(() => {
      committingRef.current = '';
      setEditing((value) => value === current ? null : value);
    });
  };
  // 点到卡片以外的任何地方（含面板空白、其它弹窗区域）都保存并退出编辑态。
  useEffect(() => {
    if (!editingId) return;
    const onPointerDown = (event: PointerEvent) => {
      if (cardRef.current?.contains(event.target as Node)) return;
      commitEditing();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editingId]);  // eslint-disable-line react-hooks/exhaustive-deps
  const play = (id: string) => {
    if (view.busy) return;
    // 正在编辑同一张卡时不播放；编辑别的卡则先保存，避免切换丢掉改动。
    if (editing) {
      if (editing.id === id) return;
      commitEditing();
    }
    onSelect(id);
    setPlayingId(id);
    void onPreview(id).finally(() => setPlayingId((current) => current === id ? null : current));
  };
  const startEditing = (action: { id: string; label: string; description?: string }) => {
    if (editing && editing.id !== action.id) commitEditing();
    setEditing({ id: action.id, label: action.label, description: action.description ?? '' });
  };

  return <div className="flex h-full min-h-0 flex-col gap-3 p-5">
    <header className="flex shrink-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold">动作设置</h1>
        <p className="mt-0.5 text-xs text-base-content/50">生成动作表后，在对话中微调或增加动作</p>
      </div>
      {view.canCancel
        ? <button type="button" className="btn btn-outline btn-error btn-sm shrink-0" onClick={onCancel}>取消生成 / 调整</button>
        : <button type="button" className="btn btn-primary btn-sm shrink-0" disabled={view.busy}
          onClick={() => void onGenerate()}>{view.busy ? '正在提交…' : '重新生成动作表'}</button>}
    </header>
    {view.taskNotice && <p role="status" className="shrink-0 text-xs text-base-content/60">{view.taskNotice}</p>}

    <ChatPanel fill showHeader={false} title="动作表"
      messages={view.messages} draft={view.draft} busy={view.busy} error={view.error}
      onDraftChange={onDraftChange} onSubmit={onSubmit} inputRef={inputRef}
      inputLabel="动作表微调输入"
      placeholder="描述调整要求，输入 @ 引用动作。Shift+Enter 换行，Enter 发送"
      emptyMessage="例如：新增一个害羞动作，或输入 @ 引用某个动作后说明要改成什么样。"
      reasoningEffort={{ value: view.reasoningEffort, disabled: view.busy, onChange: onReasoningEffortChange }}
      mentions={view.actions.map((action) => ({ id: action.id, label: action.label, category: action.category }))}
      voiceInput={{
        enabled: voice.enabled,
        statusLabel: MIC_STATE_LABEL[voice.state] ?? '语音输入',
        partialText: voice.partialText,
        errorText: voice.error,
        loading: voice.loading,
        onChange: voice.onToggle,
      }}
      toolbar={<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <button type="button" className="btn btn-outline btn-xs" disabled={view.busy}
          onClick={() => setListOpen(true)}>动作表查看</button>
        <button type="button" className="btn btn-outline btn-error btn-xs ml-auto"
          disabled={view.busy || !view.messages.length} onClick={onClearChat}>清空对话</button>
      </div>}
      suggestions={mention && !view.busy && (
        <div id="action-mention-options" role="listbox" aria-label="选择动作"
          className="absolute bottom-full z-10 mb-1 max-h-48 w-full overflow-y-auto rounded-box border border-base-content/20 bg-base-100 shadow-xl">
          {suggestions.length ? suggestions.map((action, index) => {
            const meta = CATEGORY_META[action.category] ?? CATEGORY_META.other;
            return <button key={action.id} id={`action-option-${action.id}`} type="button" role="option"
              aria-selected={index === selectedChoice}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors
                ${index === selectedChoice ? 'bg-base-content/10' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertText(actionMention(action), true)}>
              <span className={`size-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
              <span className="truncate">{action.label}</span>
              <span className="ml-auto shrink-0 text-[11px] text-base-content/40">{meta.label}</span>
            </button>;
          }) : <div className="px-3 py-2 text-xs text-base-content/50">没有匹配动作</div>}
        </div>
      )}
      inputProps={{
        'aria-controls': mention ? 'action-mention-options' : undefined,
        'aria-activedescendant': mention && suggestions[selectedChoice] ? `action-option-${suggestions[selectedChoice].id}` : undefined,
        onChange: (event) => {
          setCursor(event.target.selectionStart);
          setChoice(0);
          setDismissed(false);
        },
        onSelect: (event) => setCursor(event.currentTarget.selectionStart),
        onKeyDown: (event) => {
          if (mention && suggestions.length && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            setChoice((selectedChoice + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
            return;
          }
          if (event.key === 'Escape') { setDismissed(true); return; }
          if (event.key === 'Enter' && !event.shiftKey && mention && suggestions.length) {
            event.preventDefault();
            insertText(actionMention(suggestions[selectedChoice]), true);
          }
        },
      }}
      renderMessageError={() => '调整未完成，原动作表已保留。'}
      renderMessageDetails={(message) => <>
        {message.task && (
          <details className="mt-2 text-xs" open={message.status === 'sending'}>
            <summary className="cursor-pointer">任务状态 · {message.task.currentVersionId}（最佳 {message.task.bestVersionId}）</summary>
            <div className="mt-2 space-y-1 rounded-box bg-base-200/60 p-2">
              <div>任务计划：{message.task.plan.join(' → ')}</div>
              <div>版本：第 {message.task.revision} 版 · 本次调用 {message.task.runCalls}/{message.task.budget.maxCalls} 次（累计 {message.task.calls} 次）· 连续无进展 {message.task.noProgressCount}/{message.task.budget.maxNoProgress} 次</div>
              <div>待处理问题：{message.task.issues.length ? '' : '无'}</div>
              {message.task.issues.map((issue) => <div key={issue.issueId} className="whitespace-pre-wrap">
                {issue.issueId} · {labelOf(issue.actionId)} · {issue.severity === 'error' ? '执行约束' : '表现建议'}：{issue.message}
              </div>)}
              {message.task.lastSummary && <div>任务结论：{message.task.lastSummary}</div>}
              {message.task.history.map((entry, index) => <div key={index}>{entry.versionId}：{entry.summary}</div>)}
            </div>
          </details>
        )}
        {message.reasoningSummary && <details className="mt-2 text-xs">
          <summary className="cursor-pointer">查看本步模型摘要</summary>
          <div className="mt-2 whitespace-pre-wrap">{message.reasoningSummary}</div>
        </details>}
        {!!message.reviewNotes?.length && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer">查看 {message.reviewNotes.length} 条表现建议（未做视觉验收）</summary>
            <div className="mt-2 space-y-3">
              {message.reviewNotes.map((note, index) => (
                <div key={`${note.actionId}:${index}`}>
                  <button type="button" className="btn btn-xs btn-ghost"
                    disabled={view.busy || !view.actions.some((action) => action.id === note.actionId)}
                    onClick={() => insertText(`${actionMention({ id: note.actionId, label: labelOf(note.actionId) })} 请结合预览反馈评估这条建议：${note.message}`)}>
                    {labelOf(note.actionId)} · 引用到微调
                  </button>
                  <div className="whitespace-pre-wrap wrap-break-word">{note.message}</div>
                </div>
              ))}
            </div>
          </details>
        )}
      </>} />

    <Modal open={listOpen} title="动作表" onClose={() => setListOpen(false)}
      description={`${view.actions.length} 个动作 · 点击卡片即可在模型中播放`}>
      {!view.actions.length
        ? <div className="rounded-box border border-dashed border-base-300 px-4 py-8 text-center text-xs text-base-content/50">
          暂无动作，可以重新生成，或在对话里说“新增一个动作”。
        </div>
        : <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
          {view.actions.map((action) => {
            const meta = CATEGORY_META[action.category] ?? CATEGORY_META.other;
            const playing = playingId === action.id;
            const isEditing = editing?.id === action.id;
            return <div key={action.id}
              ref={(node) => { if (isEditing) cardRef.current = node; }}
              onClick={() => play(action.id)}
              title={isEditing ? undefined : '点击播放'}
              className={`flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-4 transition-colors
                ${isEditing ? '' : 'cursor-pointer hover:bg-base-200/60'}
                ${view.selectedId === action.id ? 'ring-2 ring-primary' : ''}
                ${view.busy ? 'pointer-events-none opacity-60' : ''}`}>
              {isEditing && editing
                ? <form className="flex flex-col gap-2" onClick={(event) => event.stopPropagation()}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const draft = editing;
                    if (await onUpdateMetadata(draft.id, draft.label, draft.description)) {
                      setEditing((current) => current === draft ? null : current);
                    }
                  }}>
                  {/* 名称在原来的位置就地变成输入框，不换行、不下降。 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span aria-hidden="true"
                        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-field text-xs font-medium ${meta.stamp}`}>
                        {meta.label.slice(0, 1)}
                      </span>
                      <input className="input input-xs w-full font-medium" required aria-label="动作名称"
                        placeholder="动作名称" value={editing.label}
                        onChange={(event) => setEditing({ ...editing, label: event.target.value })} />
                    </div>
                    <span className={`badge badge-sm shrink-0 ${meta.badge}`}>{meta.label}</span>
                  </div>
                  <fieldset disabled={view.busy} className="flex flex-col gap-2">
                    <textarea className="textarea min-h-20 max-h-40 w-full resize-none overflow-y-auto
                      field-sizing-content text-xs leading-relaxed" aria-label="动作描述"
                      placeholder="描述实际动作及适用情绪，帮助模型正确选择" value={editing.description}
                      onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
                    <div className="flex justify-end gap-2">
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing(null)}>取消</button>
                      <button type="submit" className="btn btn-primary btn-xs" disabled={!editing.label.trim()}>保存</button>
                    </div>
                  </fieldset>
                </form>
                : <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true"
                        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-field text-xs font-medium ${meta.stamp}`}>
                        {meta.label.slice(0, 1)}
                      </span>
                      <div className="truncate text-sm font-medium">{action.label}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className={`badge badge-sm ${meta.badge}`}>{meta.label}</span>
                      <button type="button" className="btn btn-ghost btn-xs"
                        aria-label={`删除 ${action.label}`} title="删除"
                        onClick={(event) => { event.stopPropagation(); void onDelete(action.id); }}>✕</button>
                    </div>
                  </div>
                  <p className="line-clamp-2 min-h-8 text-xs text-base-content/60">{action.description || '暂无描述'}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] tabular-nums ${playing ? 'text-primary' : 'text-base-content/45'}`}>
                      {playing ? '播放中…' : `${(action.durationMs / 1000).toFixed(2)}s`}
                    </span>
                    <button type="button" className="btn btn-outline btn-xs"
                      onClick={(event) => { event.stopPropagation(); startEditing(action); }}>编辑</button>
                  </div>
                </>}
            </div>;
          })}
        </div>}
    </Modal>
  </div>;
};

export default MotionSettingsPage;
