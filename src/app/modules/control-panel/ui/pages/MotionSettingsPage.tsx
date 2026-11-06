import { useEffect, useRef, useState } from 'react';
import ChatPanel from '../components/common/ChatPanel.js';
import Modal from '../components/common/Modal.js';
import type { ActionSettingsView, ActionSettingsCallbacks } from '../../modules/action-settings/domain/view';
import { actionMention, activeMention } from '../../modules/action-settings/domain/session';
import { effortOptionList, findModelEfforts, modelOptionList } from '../components/ai/effortOptions';
import type { ActionCategory } from '../../../../../../shared/live2d/actionCatalog.js';
import {
  AtSign, Check, Clock, Eraser, ListChecks, LoaderCircle, Pencil, PersonStanding, Play, Square, WandSparkles, X,
} from 'lucide-react';
import { Page } from '../components/common/Page';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { Input, Textarea } from '../components/common/FormControls';
import { EmptyState, Notice } from '../components/common/Feedback';
import { cn } from '../components/common/cn';

const CATEGORY_META: Record<ActionCategory, { label: string; badge: string; stamp: string; dot: string }> = {
  head: { label: '头部', badge: 'bg-primary/12 text-primary', stamp: 'bg-primary/12 text-primary', dot: 'bg-primary' },
  gaze: { label: '视线', badge: 'bg-info/12 text-info', stamp: 'bg-info/12 text-info', dot: 'bg-info' },
  blink: { label: '眨眼', badge: 'bg-success/12 text-success', stamp: 'bg-success/12 text-success', dot: 'bg-success' },
  emotion: { label: '情绪', badge: 'bg-warning/15 text-warning', stamp: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  body: { label: '身体', badge: 'bg-accent/12 text-accent', stamp: 'bg-accent/12 text-accent', dot: 'bg-accent' },
  other: { label: '其他', badge: 'bg-muted text-muted-foreground', stamp: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
};

const DETAILS = 'group/details mt-2 text-xs';
const SUMMARY = `flex cursor-pointer list-none items-center gap-1 opacity-80 transition-opacity hover:opacity-100
  before:inline-block before:content-['▸'] before:text-[10px] before:transition-transform group-open/details:before:rotate-90`;

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
  onUpdateMetadata, onSubmit, onClearChat, llmModels, actionModel, actionReasoningEffort,
  onActionModelChange, onActionReasoningEffortChange }: {
  view: ActionSettingsView;
  voice: MotionVoiceProps;
  /** 动作表生成用的模型与思考强度；两者都只存前端缓存。 */
  llmModels: readonly PetLlmModel[];
  actionModel: string;
  actionReasoningEffort: PetReasoningEffort | '';
  onActionModelChange: (modelId: string) => void;
  onActionReasoningEffortChange: (effort: PetReasoningEffort | '') => void;
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
  // 只有当前动作表模型探测出的档位可选；没有档位时整块控件不出现。
  const actionEfforts = findModelEfforts(llmModels, actionModel);
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

  return <Page fill title="动作设置" description="生成动作表后，在对话中微调或增加动作。"
    actions={view.canCancel
      ? <Button variant="outline" size="md" className="text-danger" onClick={onCancel}><Square />取消生成 / 调整</Button>
      : <Button variant="primary" size="md" disabled={view.busy} onClick={() => void onGenerate()}>
        {view.busy ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}
        {view.busy ? '正在提交…' : '重新生成动作表'}
      </Button>}>
    {view.taskNotice && <Notice tone={view.busy ? 'busy' : 'info'} className="shrink-0">{view.taskNotice}</Notice>}

    <ChatPanel fill showHeader={false} title="动作表"
      messages={view.messages} draft={view.draft} busy={view.busy} error={view.error}
      onDraftChange={onDraftChange} onSubmit={onSubmit} inputRef={inputRef}
      inputLabel="动作表微调输入"
      placeholder="描述调整要求，输入 @ 引用动作。Shift+Enter 换行，Enter 发送"
      emptyMessage="例如：新增一个害羞动作，或输入 @ 引用某个动作后说明要改成什么样。"
      mentions={view.actions.map((action) => ({ id: action.id, label: action.label, category: action.category }))}
      model={llmModels.length ? {
        label: 'Model',
        value: actionModel,
        options: modelOptionList(llmModels),
        disabled: view.busy,
        onChange: onActionModelChange,
      } : undefined}
      effort={actionEfforts.length ? {
        label: 'Reasoning',
        value: actionReasoningEffort || actionEfforts[0],
        options: effortOptionList(actionEfforts),
        disabled: view.busy,
        onChange: (value) => onActionReasoningEffortChange(value as PetReasoningEffort),
      } : undefined}
      voiceInput={{
        enabled: voice.enabled,
        statusLabel: MIC_STATE_LABEL[voice.state] ?? '语音输入',
        partialText: voice.partialText,
        errorText: voice.error,
        loading: voice.loading,
        onChange: voice.onToggle,
      }}
      toolbar={<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <Button variant="soft" size="xs" disabled={view.busy} onClick={() => setListOpen(true)}>
          <ListChecks />动作表查看
          <span className="rounded bg-foreground/8 px-1 text-[10px] tabular-nums">{view.actions.length}</span>
        </Button>
        <Button variant="danger" size="xs" className="ml-auto"
          disabled={view.busy || !view.messages.length} onClick={onClearChat}><Eraser />清空对话</Button>
      </div>}
      suggestions={mention && !view.busy && (
        <div id="action-mention-options" role="listbox" aria-label="选择动作"
          className="ui-scroll absolute bottom-full z-10 mb-1.5 max-h-48 w-full overflow-y-auto rounded-xl bg-card p-1 shadow-pop">
          {suggestions.length ? suggestions.map((action, index) => {
            const meta = CATEGORY_META[action.category] ?? CATEGORY_META.other;
            return <button key={action.id} id={`action-option-${action.id}`} type="button" role="option"
              aria-selected={index === selectedChoice}
              className={cn('flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                index === selectedChoice ? 'bg-muted' : 'hover:bg-muted/60')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertText(actionMention(action), true)}>
              <span className={cn('size-2 shrink-0 rounded-full', meta.dot)} aria-hidden="true" />
              <span className="truncate">{action.label}</span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{meta.label}</span>
            </button>;
          }) : <div className="px-3 py-2 text-xs text-muted-foreground">没有匹配动作</div>}
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
          <details className={DETAILS} open={message.status === 'sending'}>
            <summary className={SUMMARY}>任务状态 · {message.task.currentVersionId}（最佳 {message.task.bestVersionId}）</summary>
            <div className="mt-2 space-y-1 rounded-lg bg-card/70 p-2.5 leading-relaxed">
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
        {message.reasoningSummary && <details className={DETAILS}>
          <summary className={SUMMARY}>查看本步模型摘要</summary>
          <div className="mt-2 whitespace-pre-wrap rounded-lg bg-card/70 p-2.5 leading-relaxed">{message.reasoningSummary}</div>
        </details>}
        {!!message.reviewNotes?.length && (
          <details className={DETAILS}>
            <summary className={SUMMARY}>查看 {message.reviewNotes.length} 条表现建议（未做视觉验收）</summary>
            <div className="mt-2 space-y-2">
              {message.reviewNotes.map((note, index) => (
                <div key={`${note.actionId}:${index}`} className="space-y-1 rounded-lg bg-card/70 p-2.5">
                  <Button variant="soft" size="xs"
                    disabled={view.busy || !view.actions.some((action) => action.id === note.actionId)}
                    onClick={() => insertText(`${actionMention({ id: note.actionId, label: labelOf(note.actionId) })} 请结合预览反馈评估这条建议：${note.message}`)}>
                    <AtSign />{labelOf(note.actionId)} · 引用到微调
                  </Button>
                  <div className="whitespace-pre-wrap wrap-break-word leading-relaxed">{note.message}</div>
                </div>
              ))}
            </div>
          </details>
        )}
      </>} />

    <Modal open={listOpen} title="动作表" onClose={() => setListOpen(false)}
      description={`${view.actions.length} 个动作 · 点击卡片即可在模型中播放`}>
      {!view.actions.length
        ? <EmptyState icon={<PersonStanding />} title="暂无动作">
          可以重新生成，或在对话里说“新增一个动作”。
        </EmptyState>
        : <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
          {view.actions.map((action) => {
            const meta = CATEGORY_META[action.category] ?? CATEGORY_META.other;
            const playing = playingId === action.id;
            const isEditing = editing?.id === action.id;
            return <div key={action.id}
              ref={(node) => { if (isEditing) cardRef.current = node; }}
              onClick={() => play(action.id)}
              title={isEditing ? undefined : '点击播放'}
              className={cn('group flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4 transition-all',
                !isEditing && 'cursor-pointer hover:border-primary/40 hover:shadow-pop',
                view.selectedId === action.id && 'border-primary/60 ring-2 ring-primary/25',
                view.busy && 'pointer-events-none opacity-60')}>
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
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span aria-hidden="true"
                        className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold', meta.stamp)}>
                        {meta.label.slice(0, 1)}
                      </span>
                      <Input size="xs" className="h-7 font-medium" required aria-label="动作名称"
                        placeholder="动作名称" value={editing.label}
                        onChange={(event) => setEditing({ ...editing, label: event.target.value })} />
                    </div>
                    <Badge className={meta.badge}>{meta.label}</Badge>
                  </div>
                  <fieldset disabled={view.busy} className="flex flex-col gap-2">
                    <Textarea className="min-h-20 max-h-40 resize-none overflow-y-auto field-sizing-content"
                      aria-label="动作描述"
                      placeholder="描述实际动作及适用情绪，帮助模型正确选择" value={editing.description}
                      onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" size="xs" onClick={() => setEditing(null)}>取消</Button>
                      <Button type="submit" variant="primary" size="xs" disabled={!editing.label.trim()}><Check />保存</Button>
                    </div>
                  </fieldset>
                </form>
                : <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden="true"
                        className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold', meta.stamp)}>
                        {meta.label.slice(0, 1)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold">{action.label}</div>
                        <div className={cn('flex items-center gap-1 text-[11px] tabular-nums',
                          playing ? 'text-primary' : 'text-muted-foreground')}>
                          {playing ? <><LoaderCircle aria-hidden="true" className="size-3 animate-spin" />播放中…</>
                            : <><Clock aria-hidden="true" className="size-3" />{(action.durationMs / 1000).toFixed(2)}s</>}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge className={meta.badge}>{meta.label}</Badge>
                      <Button variant="ghost" size="icon-xs" className="hover:text-danger"
                        aria-label={`删除 ${action.label}`} title="删除"
                        onClick={(event) => { event.stopPropagation(); void onDelete(action.id); }}><X /></Button>
                    </div>
                  </div>
                  <p className="line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">{action.description || '暂无描述'}</p>
                  <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      <Play aria-hidden="true" className="size-3" />点击播放
                    </span>
                    <Button variant="ghost" size="xs"
                      onClick={(event) => { event.stopPropagation(); startEditing(action); }}><Pencil />编辑</Button>
                  </div>
                </>}
            </div>;
          })}
        </div>}
    </Modal>
  </Page>;
};

export default MotionSettingsPage;
