import { useEffect, useRef } from 'react';
import type { ModelConfig } from '../../domain/types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';

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

  const fields: Array<{ key: keyof ModelConfig['persona']; label: string; placeholder: string; rows: number }> = [
    { key: 'personal', label: '角色个性', placeholder: '例如：傲娇但礼貌，偏短句，喜欢吐槽', rows: 3 },
    { key: 'speakingStyle', label: '说话风格', placeholder: '例如：口语化、少用书面词', rows: 2 },
    { key: 'relation', label: '关系设定', placeholder: '例如：青梅竹马、略傲娇但会照顾人', rows: 2 },
    { key: 'banned', label: '禁忌与边界', placeholder: '例如：不编造事实，不进行人身攻击', rows: 2 },
    { key: 'world', label: '世界观', placeholder: '例如：故事发生在架空近未来学园都市', rows: 3 },
  ];

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">角色人设</h1>
        <p className="text-xs text-base-content/60">人设与动作表保存在当前模型配置中，日常对话读取同一份配置快照。</p>
      </div>
      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-4">
        {fields.map(({ key, label, placeholder, rows }) => (
          <label className="form-control" key={key}>
            <span className="label-text text-xs pb-1">{label}</span>
            <textarea className="textarea textarea-sm textarea-bordered w-full" rows={rows}
              value={draft.draft[key]} placeholder={placeholder}
              onChange={(event) => draft.commit({ ...draft.draft, [key]: event.target.value })} />
          </label>
        ))}
      </section>
    </div>
  );
}
