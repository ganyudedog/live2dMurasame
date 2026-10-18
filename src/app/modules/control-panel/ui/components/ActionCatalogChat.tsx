import { useRef, useState } from 'react';
import ChatPanel from './ChatPanel';
import type { ActionSettingsView, ActionSettingsCallbacks } from '../../modules/action-settings/domain/view';
import { actionMention, activeMention, referencedActionIds } from '../../modules/action-settings/domain/session';

export const ACTION_DRAG_TYPE = 'application/x-live2d-action';

const ActionCatalogChat = ({ view, onDraftChange, onSubmit, onClearChat }: { view: ActionSettingsView } & Pick<ActionSettingsCallbacks, 'onDraftChange' | 'onSubmit' | 'onClearChat'>) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [choice, setChoice] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const mention = dismissed ? null : activeMention(view.draft, cursor);
  const suggestions = mention ? view.actions.filter((action) => action.id.includes(mention.query)
    || action.label.toLowerCase().includes(mention.query)) : [];
  const selectedChoice = Math.min(choice, Math.max(0, suggestions.length - 1));
  const referenceIds = referencedActionIds(view.draft);
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

  return <ChatPanel title="动作表微调"
    description="输入 @ 选择动作，或拖入上方动作；可以直接描述新增、删除和调整要求。"
    messages={view.messages} draft={view.draft} busy={view.busy} error={view.error}
    onDraftChange={onDraftChange} onSubmit={onSubmit} onClear={onClearChat}
    inputRef={inputRef} inputLabel="动作表微调输入"
    placeholder="描述调整要求，输入 @ 引用动作。Shift+Enter 换行，Enter 发送"
    emptyMessage="例如：新增一个害羞动作，或引用某个动作后说把这个动作换成更明显的转头。"
    footer="对话和草稿按当前模型自动缓存；动作表调整后自动保存。"
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
              {issue.issueId} · @{issue.actionId} · {issue.severity === 'error' ? '执行约束' : '表现建议'}：{issue.message}
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
                  onClick={() => insertText(`${actionMention(note.actionId)} 请结合预览反馈评估这条建议：${note.message}`)}>
                  @{note.actionId} · 引用到微调
                </button>
                <div className="whitespace-pre-wrap wrap-break-word">{note.message}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </>}
    toolbar={<div className="flex flex-wrap gap-1 mb-2">
      {referenceIds.map((id) => <span key={id} className={`badge badge-sm ${view.actions.some((action) => action.id === id)
        ? 'badge-primary badge-outline' : 'badge-error badge-outline'}`}>
        @{view.actions.find((action) => action.id === id)?.label ?? id}
      </span>)}
      <button type="button" className="btn btn-ghost btn-xs" disabled={view.busy}
        onClick={() => insertText('新增一个动作：')}>＋ 新增动作</button>
    </div>}
    suggestions={mention && !view.busy && (
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
          insertText(actionMention(suggestions[selectedChoice].id), true);
        }
      },
    }} />;
};

export default ActionCatalogChat;
