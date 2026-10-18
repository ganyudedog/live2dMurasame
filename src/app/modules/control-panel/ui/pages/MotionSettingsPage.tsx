import { useRef, useState } from 'react';
import type { ActionSettingsView, ActionSettingsCallbacks } from '../../modules/action-settings/domain/view';
import { actionMention } from '../../modules/action-settings/domain/session';
import ActionCatalogChat, { ACTION_DRAG_TYPE } from '../components/ActionCatalogChat';

const categoryLabels = { head: '头部', gaze: '视线', blink: '眨眼', emotion: '情绪', body: '身体', other: '其他' };

const MotionSettingsPage = ({ view, onGenerate, onCancel, onSelect, onDraftChange, onPreview, onDelete, onUpdateMetadata, onSubmit, onClearChat }: { view: ActionSettingsView } & ActionSettingsCallbacks) => {
  const chatRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ id: string; label: string; description: string } | null>(null);
  const referenceAction = (id: string) => {
    onSelect(id);
    const nextDraft = `${view.draft}${view.draft && !/\s$/.test(view.draft) ? ' ' : ''}${actionMention(id)} `;
    onDraftChange(nextDraft);
    requestAnimationFrame(() => {
      const input = chatRef.current?.querySelector('textarea');
      input?.focus();
      input?.setSelectionRange(nextDraft.length, nextDraft.length);
    });
  };

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">动作设置</h1>
          <p className="text-xs text-base-content/60">自动分析、编排和检查组合动作，通过后替换整表。后续调整在下方对话中完成。</p>
        </div>
        {view.canCancel ? <button type="button" className="btn btn-outline btn-sm shrink-0" onClick={onCancel}>取消生成 / 调整</button>
          : <button type="button" className="btn btn-primary btn-sm shrink-0" disabled={view.busy}
            onClick={() => void onGenerate()}>{view.busy ? '正在提交…' : '重新生成动作表'}</button>}
      </header>
      {view.taskNotice && <p role="status" className="text-xs text-base-content/70">{view.taskNotice}</p>}
      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-3">
        <header className="flex items-center justify-between">
          <div className="text-sm font-medium">动作表</div>
          <span className="text-xs text-base-content/60">{view.actions.length} 个动作 · 点击或拖拽动作以引用</span>
        </header>
        {!view.actions.length && <p className="text-xs text-base-content/60">暂无动作，可以重新生成或在下方对话中新增。</p>}
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {view.actions.map((action) => (
            <div key={action.id} draggable={!view.busy && editing?.id !== action.id}
              title="拖到下方输入框以引用该动作"
              onDragStart={(event) => {
                event.dataTransfer.setData(ACTION_DRAG_TYPE, action.id);
                event.dataTransfer.setData('text/plain', `${actionMention(action.id)} `);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              className={`flex flex-wrap items-center gap-2 rounded-box border border-base-300 p-2 ${view.selectedId === action.id ? 'bg-base-200' : ''}`}>
              <span className="cursor-grab text-base-content/40" aria-hidden="true">⠿</span>
              <button type="button" className="flex-1 min-w-0 text-left" disabled={view.busy}
                aria-label={`引用动作 ${action.label}`} onClick={() => referenceAction(action.id)}>
                <div className="text-sm font-medium">{action.label} <span className="text-xs opacity-60">@{action.id}</span></div>
                {action.description && <div className="text-xs text-base-content/60 truncate">{action.description}</div>}
              </button>
              <span className="badge badge-ghost badge-sm">{categoryLabels[action.category]}</span>
              <button type="button" className="btn btn-outline btn-xs" disabled={view.busy}
                onClick={() => onPreview(action.id)}>预览</button>
              <button type="button" className="btn btn-ghost btn-xs" disabled={view.busy}
                aria-label={`编辑动作 ${action.label}`} onClick={() => setEditing({ id: action.id,
                  label: action.label, description: action.description ?? '' })}>编辑</button>
              <button type="button" className="btn btn-ghost btn-xs text-error" disabled={view.busy}
                aria-label={`删除动作 ${action.label}`} onClick={() => void onDelete(action.id)}>删除</button>
              {editing?.id === action.id && <form className="w-full border-t border-base-300 pt-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const draft = editing;
                  if (await onUpdateMetadata(draft.id, draft.label, draft.description)) {
                    setEditing((current) => current === draft ? null : current);
                  }
                }}>
                <fieldset disabled={view.busy} className="space-y-2">
                  <label className="block text-xs">动作名称
                    <input className="input input-bordered input-sm mt-1 w-full" required value={editing.label}
                      onChange={(event) => setEditing({ ...editing, label: event.target.value })} />
                  </label>
                  <label className="block text-xs">描述
                    <textarea className="textarea textarea-bordered mt-1 w-full" rows={2} value={editing.description}
                      placeholder="描述实际动作及适用情绪，帮助模型正确选择"
                      onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
                  </label>
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing(null)}>取消</button>
                    <button type="submit" className="btn btn-primary btn-xs" disabled={!editing.label.trim()}>保存</button>
                  </div>
                </fieldset>
              </form>}
            </div>
          ))}
        </div>
      </section>
      <div ref={chatRef}><ActionCatalogChat view={view} onDraftChange={onDraftChange} onSubmit={onSubmit} onClearChat={onClearChat} /></div>
    </div>
  );
};

export default MotionSettingsPage;
