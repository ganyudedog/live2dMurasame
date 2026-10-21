import { Field, SettingsCard } from '../common/SettingsSection';
import { effortOptionList } from './effortOptions';

/**
 * 记忆整理是后台自动触发的，前端没有交互点，所以这两项必须落后端。
 * 没选模型时不做任何兜底：不借用对话模型，也不发送请求。
 */
export function MemoryModelCard({
  models,
  memoryModel,
  memoryEffort,
  onChange,
}: {
  models: readonly PetLlmModel[];
  memoryModel: string;
  memoryEffort: PetReasoningEffort | '';
  onChange: (patch: { memoryModel?: string; memoryReasoningEffort?: PetReasoningEffort | '' }) => void;
}) {
  const selected = models.find((model) => model.id === memoryModel) ?? null;
  const efforts = selected?.efforts ?? [];
  return <SettingsCard
    title="记忆整理"
    description="对话结束后由后台调用，归纳长期记忆。只有这一步需要固定模型，所以保存在后端配置里。"
  >
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Field label="记忆整理模型">
        <select className="select select-sm w-full" value={memoryModel}
          onChange={(event) => onChange({ memoryModel: event.target.value })}>
          <option value="">不整理（不调用模型）</option>
          {models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
        </select>
      </Field>
      <Field label="思考深度" hint={selected
        ? (efforts.length ? '只列出该模型检测到的档位；默认取第一档' : '该模型不接受思考深度，请求里不会带这个参数')
        : '先选择记忆整理模型'}>
        <select className="select select-sm w-full" value={efforts.length ? (memoryEffort || efforts[0]) : ''}
          disabled={!efforts.length}
          onChange={(event) => onChange({ memoryReasoningEffort: event.target.value as PetReasoningEffort })}>
          {efforts.length
            ? effortOptionList(efforts).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))
            : <option value="">—</option>}
        </select>
      </Field>
    </div>
    {!memoryModel && (
      <p className="text-[11px] text-error">未选择记忆整理模型，后台不会长期记忆。</p>
    )}
  </SettingsCard>;
}
