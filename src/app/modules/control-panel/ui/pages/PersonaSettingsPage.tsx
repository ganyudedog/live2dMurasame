import { useEffect, useRef } from 'react';
import type { ModelConfig } from '../../domain/types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';
import { Field, SettingsCard } from '../components/common/SettingsSection';

const isSamePersona = (left: ModelConfig['persona'], right: ModelConfig['persona']) => (
  left.personal === right.personal
  && left.speakingStyle === right.speakingStyle
  && left.relation === right.relation
  && left.banned === right.banned
  && left.world === right.world
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
    { key: 'personal', label: '角色个性', placeholder: '例如：傲娇但礼貌，偏短句，喜欢吐槽', tall: true },
    { key: 'speakingStyle', label: '说话风格', placeholder: '例如：口语化、少用书面词' },
    { key: 'relation', label: '关系设定', placeholder: '例如：青梅竹马、略傲娇但会照顾人' },
    { key: 'banned', label: '禁忌与边界', placeholder: '例如：不编造事实，不进行人身攻击' },
    { key: 'world', label: '世界观', placeholder: '例如：故事发生在架空近未来学园都市', tall: true },
  ];

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">角色人设</h1>
        <p className="mt-1 text-xs text-base-content/60">人设与动作表保存在当前模型配置中，日常对话读取同一份配置快照。</p>
      </div>

      <SettingsCard title="人设文本" description="这些文字会拼进对话的系统提示词；留空则该项不参与。">
        <div className="grid grid-cols-1 gap-3">
          {fields.map(({ key, label, placeholder, tall }) => (
            <Field key={key} label={label}>
              {/* 宽度固定、不可拖拽拉伸；高度随内容在 min/max 之间自适应，超出后内部滚动 */}
              <textarea value={draft.draft[key]} placeholder={placeholder}
                className={`textarea textarea-sm w-full resize-none overflow-y-auto field-sizing-content
                  ${tall ? 'min-h-24 max-h-56' : 'min-h-20 max-h-40'}`}
                onChange={(event) => draft.commit({ ...draft.draft, [key]: event.target.value })} />
            </Field>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}
