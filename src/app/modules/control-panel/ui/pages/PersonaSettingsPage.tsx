import { useEffect, useRef } from 'react';
import { buildPersonaPrompt, normalizePersona, RELATIONSHIP_STAGES } from '@app/modules/ai/modules/llm/domain/memory/memoryContext';
import type { ModelConfig } from '../../domain/types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';
import { useModelRelationship } from '../hooks/useModelRelationship';
import { Field, SettingsCard } from '../components/common/SettingsSection';

type PersonaKey = keyof ModelConfig['persona'];

/** 长文本段落：标签 + 字数 + 可自动增高的多行输入 + 一句写法提示。 */
const LONG_FIELDS: ReadonlyArray<{
  key: PersonaKey;
  label: string;
  hint: string;
  placeholder: string;
  minHeight: string;
}> = [
  {
    key: 'voice',
    label: '性格与口吻',
    hint: '写具体习惯，比一堆形容词有用',
    minHeight: 'min-h-32',
    placeholder: '先吐槽再帮忙，句子通常到逗号就停。\n答应事情用「嗯」「算了」开头，不说「当然可以」。',
  },
  {
    key: 'examples',
    label: '示例对话',
    hint: '三到六轮短对白，只示范口吻，不是本轮输出格式',
    minHeight: 'min-h-40',
    placeholder: '你：今天好累\n丛雨：（放下剑）那就别撑着了。\n你：可还有工作\n丛雨：先吃饭，工作跑不掉。',
  },
  {
    key: 'boundaries',
    label: '边界',
    hint: '明确不该做的事，比「要温柔」这种要求更有用',
    minHeight: 'min-h-28',
    placeholder: '不编造共同经历。\n不替用户做决定，最多给一句判断。\n不主动提起恋爱。',
  },
  {
    key: 'notes',
    label: '补充设定',
    hint: '只写会影响说话方式的事实，留空就不参与',
    minHeight: 'min-h-28',
    placeholder: '外表十六七岁，用词带一点旧时代感。\n不知道任何互联网梗。',
  },
];

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
  const stage = relationship.view?.stage ?? '';

  const persona = draft.draft;
  const filled = (Object.keys(persona) as PersonaKey[]).filter((key) => persona[key].trim() !== '').length;
  // 空段落不会进入提示词，所以这里直接展示拼装后的结果，改完当场能核对结构。
  const preview = buildPersonaPrompt(normalizePersona(persona));

  const edit = (patch: Partial<ModelConfig['persona']>) => draft.commit({ ...persona, ...patch });

  return <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-5">
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold">角色人设</h1>
        <p className="mt-0.5 text-xs text-base-content/50">
          角色卡随当前模型保存，每次回复都会整段放进系统提示词。关系阶段由对话整理写入记忆，不在这里编辑。
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-[11px] text-base-content/45">
        <span className="tabular-nums">{filled} / 6 项已填写</span>
        <span>{draft.pending ? '正在保存' : '已保存'}</span>
      </div>
    </header>

    <SettingsCard title="当前关系"
      description="只读：由对话整理写入记忆，前端暂不提供修改入口。"
      actions={<button type="button" className="btn btn-ghost btn-xs" onClick={relationship.reload}
        disabled={relationship.loading}>{relationship.loading ? '读取中' : '刷新'}</button>}>
      {relationship.error
        ? <p className="text-xs text-error">读取记忆失败：{relationship.error}</p>
        : <div className="flex flex-wrap items-center gap-3">
          <span className="badge badge-sm badge-outline shrink-0">
            {relationship.view ? (stage || '未记录') : '读取中'}
          </span>
          <p className="text-[11px] text-base-content/40">
            {RELATIONSHIP_STAGES.map((item, index) => <span key={item}>
              {index ? ' · ' : null}
              <span className={item === stage ? 'font-medium text-base-content/80' : ''}>{item}</span>
            </span>)}
          </p>
        </div>}
      <p className="rounded-field bg-base-content/5 px-2.5 py-2 text-xs leading-relaxed text-base-content/70">
        {relationship.loading && !relationship.view ? '正在读取…' : relationship.view?.line ?? '暂无可读的关系说明。'}
      </p>
      <p className="text-[11px] leading-relaxed text-base-content/40">
        {relationship.view?.recorded
          ? '阶段与说明都来自记忆里的「当前关系」一节，随对话整理更新。'
          : '记忆里还没有「当前关系」一节，提示词暂时按默认阶段处理。'}
      </p>
    </SettingsCard>

    <SettingsCard title="角色卡"
      description="每段都会成为提示词里的一节；留空的段落直接跳过，不会留下空标题。">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="名字" hint="角色在提示词里的自称，通常也是角色名">
          <input className="input input-sm w-full" value={persona.name} placeholder="例如：丛雨"
            onChange={(event) => edit({ name: event.target.value })} />
        </Field>
        <Field label="对用户的称呼" hint="决定她怎么叫你；留空则不提称呼">
          <input className="input input-sm w-full" value={persona.userAddress} placeholder="例如：主人，生气时叫全名"
            onChange={(event) => edit({ userAddress: event.target.value })} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {LONG_FIELDS.map(({ key, label, hint, placeholder, minHeight }) => {
          const value = persona[key];
          return <div key={key} className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-base-content/55">{label}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-base-content/30">
                {value.trim() ? `${value.trim().length} 字` : '未填写'}
              </span>
            </div>
            <textarea className={`textarea textarea-sm ${minHeight} w-full resize-none overflow-y-auto field-sizing-content max-h-72 leading-relaxed`}
              value={value} placeholder={placeholder}
              onChange={(event) => edit({ [key]: event.target.value })} />
            <span className="text-[11px] leading-relaxed text-base-content/40">{hint}</span>
          </div>;
        })}
      </div>

      <details className="group">
        <summary className="cursor-pointer select-none text-[11px] text-base-content/45 marker:text-base-content/30 hover:text-base-content/70">
          提示词预览{preview ? ` · ${preview.length} 字` : '（暂无内容）'}
        </summary>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-field bg-base-content/5 p-2.5 font-mono text-[11px] leading-relaxed text-base-content/65">
          {preview || '六项都还是空的，人设这一段不会出现在系统提示词里。'}
        </pre>
      </details>
    </SettingsCard>
  </div>;
}
