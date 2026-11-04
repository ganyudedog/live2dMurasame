import { useEffect, useRef } from 'react';
import type { ModelConfig } from '../../domain/types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';
import { Field, SettingsCard } from '../components/common/SettingsSection';

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
  onModelConfigChange,
}: {
  modelConfig: ModelConfig;
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

  const fields: Array<{ key: keyof ModelConfig['persona']; label: string; placeholder: string; tall?: boolean }> = [
    { key: 'name', label: '名字', placeholder: '例如：丛雨' },
    { key: 'userAddress', label: '对用户的称呼', placeholder: '例如：叫你主人，生气时叫全名' },
    { key: 'voice', label: '性格与口吻', placeholder: '写具体习惯，少写形容词。例如：先吐槽再帮忙，句子通常到逗号就停', tall: true },
    { key: 'examples', label: '示例对话', placeholder: '三到六轮短对白，覆盖打招呼、接话、安慰和拒绝。用角色真正会说的长度', tall: true },
    { key: 'boundaries', label: '边界', placeholder: '例如：不编造共同经历，不替用户做决定' },
    { key: 'notes', label: '补充设定', placeholder: '外貌、知识、世界里真正会影响说话的事实。留空则不参与', tall: true },
  ];

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">角色人设</h1>
        <p className="mt-1 text-xs text-base-content/60">角色卡保存在当前模型配置中。关系阶段由对话整理写入记忆，从亲近开始，不在这里编辑。</p>
      </div>

      <SettingsCard title="角色卡" description="这些文字会放进系统提示词；留空则该项不参与。示例对话示范口吻，不是输出格式。">
        <div className="grid grid-cols-1 gap-3">
          {fields.map(({ key, label, placeholder, tall }) => (
            <Field key={key} label={label}>
              <textarea value={draft.draft[key]} placeholder={placeholder}
                className={`textarea textarea-sm w-full resize-none overflow-y-auto field-sizing-content
                  ${tall ? 'min-h-24 max-h-56' : 'min-h-16 max-h-32'}`}
                onChange={(event) => draft.commit({ ...draft.draft, [key]: event.target.value })} />
            </Field>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}
