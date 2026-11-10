import { useEffect, useState, useRef, type ReactNode } from 'react';
import { buildPersonaPrompt, normalizePersona, RELATIONSHIP_STAGES } from '@app/modules/ai/modules/llm/domain/memory/memoryContext';
import type { ModelConfig } from '../../domain/types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';
import { useModelRelationship, type RelationshipView } from '../hooks/useModelRelationship';
import {
  ChevronRight, Heart, IdCard, MessageCircleHeart, MessagesSquare, NotebookPen, RefreshCw, ScrollText, ShieldCheck,
} from 'lucide-react';
import { Field, SettingsCard } from '../components/common/SettingsSection';
import { Page } from '../components/common/Page';
import { Button } from '../components/common/Button';
import { Badge, StatusDot } from '../components/common/Badge';
import { Input, Select, Textarea } from '../components/common/FormControls';
import { Notice } from '../components/common/Feedback';
import { cn } from '../components/common/cn';

type PersonaKey = keyof ModelConfig['persona'];

/** 名片上的完整度刻度按这个顺序排，与提示词里各节的顺序一致。 */
const PERSONA_FIELDS: ReadonlyArray<{ key: PersonaKey; label: string }> = [
  { key: 'name', label: '名字' },
  { key: 'userAddress', label: '对用户的称呼' },
  { key: 'voice', label: '性格与口吻' },
  { key: 'examples', label: '示例对话' },
  { key: 'boundaries', label: '边界' },
  { key: 'notes', label: '补充设定' },
];

/** 长文本段落：图标 + 标签 + 字数 + 可自动增高的多行输入。 */
const LONG_FIELDS: ReadonlyArray<{
  key: PersonaKey;
  label: string;
  icon: ReactNode;
  placeholder: string;
  minHeight: string;
}> = [
  {
    key: 'voice',
    label: '性格与口吻',
    icon: <MessageCircleHeart />,
    minHeight: 'min-h-28',
    placeholder: '描述角色的性格和说话方式',
  },
  {
    key: 'examples',
    label: '示例对话',
    icon: <MessagesSquare />,
    minHeight: 'min-h-36',
    placeholder: '三到六轮短对白，只示范口吻',
  },
  {
    key: 'boundaries',
    label: '边界',
    icon: <ShieldCheck />,
    minHeight: 'min-h-24',
    placeholder: '明确不该做的事，比「要温柔」这种要求更有用',
  },
  {
    key: 'notes',
    label: '补充设定',
    icon: <NotebookPen />,
    minHeight: 'min-h-24',
    placeholder: '只写会影响说话方式的事实，留空就不参与',
  },
];

/** 五个阶段等分的刻度：当前阶段及之前点亮；待选择时全部熄灭，不暗示任何阶段。 */
function StageTrack({ stage }: { stage: string }) {
  const current = RELATIONSHIP_STAGES.indexOf(stage as typeof RELATIONSHIP_STAGES[number]);
  return <ol aria-label="阶段进度" className="grid grid-cols-5 gap-1">
    {RELATIONSHIP_STAGES.map((item, index) => {
      const reached = current >= 0 && index <= current;
      return <li key={item} aria-current={index === current ? 'step' : undefined} className="space-y-1.5">
        <span aria-hidden="true" className={cn('block h-1.5 rounded-full', reached ? 'bg-primary' : 'bg-muted')} />
        <span className={cn('block text-center text-[10px]',
          index === current ? 'font-semibold text-primary' : reached ? 'text-foreground/70' : 'text-muted-foreground/70')}>
          {item}
        </span>
      </li>;
    })}
  </ol>;
}

export function RelationshipCard({
  view, loading, busy, error, actionError, onReload, onApply,
}: {
  view: RelationshipView | null;
  loading: boolean;
  busy: boolean;
  error: string;
  actionError: string;
  onReload: () => void;
  onApply: (input: { stage: string }) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<{ revision: number; stage: string } | null>(null);
  const form = view && draft?.revision === view.revision
    ? draft
    : view
      ? { revision: view.revision, stage: view.needsSelection ? '' : view.stage }
      : null;
  const unchanged = Boolean(view && form && !view.needsSelection && form.stage === view.stage);

  return <SettingsCard title="当前关系" icon={<Heart />}
    description="关系会随相处自然发展，也可以手动修改。"
    actions={<Button variant="ghost" size="xs" onClick={onReload} disabled={loading || busy}>
      <RefreshCw className={loading ? 'animate-spin' : undefined} />
      {loading ? '读取中' : '刷新'}
    </Button>}>
    {error ? <Notice tone="danger">读取记忆失败：{error}</Notice> : null}
    {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
    {loading && !view ? <Notice tone="busy">正在读取关系…</Notice> : null}
    {view?.needsSelection ? <Notice tone="warning">{view.line}</Notice> : null}
    {view && form ? <div className="space-y-4">
      <div className="space-y-3">
        <p className={cn('text-lg font-semibold tracking-tight',
          view.needsSelection ? 'text-muted-foreground' : 'text-primary')}>
          {view.needsSelection ? '待选择' : (view.stage || '未记录')}
        </p>
        <StageTrack stage={view.needsSelection ? '' : view.stage} />
      </div>
      {view.needsSelection ? null : <p className="text-xs leading-relaxed text-foreground/85">{view.line}</p>}
      <div className="space-y-2 border-t border-border pt-4">
        <Field label="调整阶段">
          <Select aria-label="关系阶段" value={form.stage} disabled={busy}
            onChange={(event) => setDraft({ ...form, stage: event.target.value })}>
            {view.needsSelection ? <option value="">请选择阶段</option> : null}
            {RELATIONSHIP_STAGES.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
        <Button variant="primary" size="sm" className="w-full" disabled={busy || !form.stage || unchanged}
          onClick={() => { void onApply({ stage: form.stage }); }}>
          {busy ? '正在写入…' : '应用这个阶段'}
        </Button>
      </div>
    </div> : null}
  </SettingsCard>;
}

const isSamePersona = (left: ModelConfig['persona'], right: ModelConfig['persona']) => (
  left.name === right.name
  && left.userAddress === right.userAddress
  && left.voice === right.voice
  && left.examples === right.examples
  && left.boundaries === right.boundaries
  && left.notes === right.notes
);

export default function PersonaSettingsPage({
  modelConfig,
  modelPath,
  onModelConfigChange,
}: {
  modelConfig: ModelConfig;
  modelPath: string | null;
  onModelConfigChange: (next: ModelConfig) => Promise<void>;
}) {
  const configRef = useRef(modelConfig);
  useEffect(() => { configRef.current = modelConfig; }, [modelConfig]);
  const draft = useDebouncedRemoteDraft<ModelConfig['persona']>({
    remoteValue: modelConfig.persona,
    debounceMs: 260,
    isEqual: isSamePersona,
    onCommit: (persona) => onModelConfigChange({ ...configRef.current, persona }),
  });
  const relationship = useModelRelationship(modelPath);

  const persona = draft.draft;
  const filled = PERSONA_FIELDS.filter(({ key }) => persona[key].trim() !== '').length;
  // 空段落不会进入提示词，所以这里直接展示拼装后的结果，改完当场能核对结构。
  const preview = buildPersonaPrompt(normalizePersona(persona));
  const initial = Array.from(persona.name.trim())[0] ?? '?';

  const edit = (patch: Partial<ModelConfig['persona']>) => draft.commit({ ...persona, ...patch });

  return <Page title="角色人设"
    description="角色卡随当前模型保存，每次回复都会整段放进系统提示词。关系阶段写在这个模型的记忆里，也可以在下面直接调整。"
    meta={<>
      <Badge tone="outline" className="tabular-nums">{filled} / 6 项已填写</Badge>
      <StatusDot tone={draft.pending ? 'warning' : 'success'} pulse={draft.pending}>
        {draft.pending ? '正在保存' : '已保存'}
      </StatusDot>
    </>}>
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-4">
        <section aria-label="角色名片" className="overflow-hidden rounded-xl bg-card shadow-card">
          <div aria-hidden="true" className="h-16 bg-primary/10" />
          <div className="-mt-8 space-y-4 px-4 pb-4">
            <span aria-hidden="true" className="grid size-16 place-items-center rounded-2xl bg-primary text-2xl font-bold
              text-primary-foreground shadow-sm ring-4 ring-card">
              {initial}
            </span>
            <Field label="名字">
              <Input className="h-9 text-sm font-semibold" value={persona.name} placeholder="例如：丛雨"
                onChange={(event) => edit({ name: event.target.value })} />
            </Field>
            <Field label="对用户的称呼">
              <Input value={persona.userAddress} placeholder="例如：主人，生气时叫全名"
                onChange={(event) => edit({ userAddress: event.target.value })} />
            </Field>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
                <span>完整度</span>
                <span className="tabular-nums">{filled} / 6</span>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {PERSONA_FIELDS.map(({ key, label }) => (
                  <span key={key} title={`${label}${persona[key].trim() ? '' : '（未填写）'}`}
                    className={cn('h-1.5 rounded-full', persona[key].trim() ? 'bg-primary' : 'bg-muted')} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <RelationshipCard view={relationship.view} loading={relationship.loading} busy={relationship.busy}
          error={relationship.error} actionError={relationship.actionError} onReload={relationship.reload}
          onApply={relationship.adjust} />
      </div>

      <div className="min-w-0 space-y-4">
        <SettingsCard title="角色卡" icon={<IdCard />} bodyClassName="divide-y divide-border p-0"
          description="每段都会成为提示词里的一节；留空的段落直接跳过，不会留下空标题。">
          {LONG_FIELDS.map(({ key, label, icon, placeholder, minHeight }) => {
            const value = persona[key].trim();
            return <label key={key} className="block space-y-2 px-4 py-4">
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className={cn('grid size-6 shrink-0 place-items-center rounded-md [&_svg]:size-3.5',
                  value ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                  {icon}
                </span>
                <span className="text-xs font-medium text-foreground">{label}</span>
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/70">
                  {value ? `${value.length} 字` : '未填写'}
                </span>
              </span>
              <Textarea className={`${minHeight} max-h-72 resize-none overflow-y-auto field-sizing-content`}
                value={persona[key]} placeholder={placeholder}
                onChange={(event) => edit({ [key]: event.target.value })} />
            </label>;
          })}
        </SettingsCard>

        <details className="group rounded-xl bg-card shadow-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs text-muted-foreground
            select-none transition-colors hover:text-foreground">
            <ScrollText aria-hidden="true" className="size-3.5" />
            <span className="flex-1">提示词预览{preview ? ` · ${preview.length} 字` : '（暂无内容）'}</span>
            <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-90" />
          </summary>
          <pre className="ui-scroll mx-4 mb-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono
            text-[11px] leading-relaxed text-foreground/75">
            {preview || '六项都还是空的，人设这一段不会出现在系统提示词里。'}
          </pre>
        </details>
      </div>
    </div>
  </Page>;
}
