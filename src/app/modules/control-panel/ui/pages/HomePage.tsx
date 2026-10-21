import ChatPanel from '../components/common/ChatPanel';
import { useScaleControl } from '../hooks/useScaleControl';
import { effortOptionList, findModelEfforts, modelOptionList } from '../components/ai/effortOptions';
import type { ChatMessage, ModelEntry } from '../../domain/types';

const MIC_STATE_LABEL: Record<PetMicState, string> = {
  off: '语音输入',
  requesting: '等待授权',
  active: '识别中',
  denied: '未授权',
  error: '异常',
};

export default function HomePage({
  model,
  scale,
  onScalePreview,
  onScalePersist,
  onGotoModels,
  chatMessages,
  chatDraft,
  chatSending,
  chatError,
  chatReasoningEffort,
  llmModels,
  chatModel,
  asrEnabled,
  asrState,
  asrPartialText,
  asrError,
  asrSwitchLoading,
  onChatDraftChange,
  onChatSubmit,
  onClearChat,
  onToggleAsr,
  onChatReasoningEffortChange,
  onChatModelChange,
}: {
  model: ModelEntry;
  scale: number;
  onScalePreview: (scale: number) => void;
  onScalePersist: (scale: number) => Promise<void>;
  onGotoModels: () => void;
  chatMessages: ChatMessage[];
  chatDraft: string;
  chatSending: boolean;
  chatError: string | null;
  chatReasoningEffort: PetReasoningEffort | '';
  llmModels: PetLlmModel[];
  chatModel: string;
  asrEnabled: boolean;
  asrState: PetMicState;
  asrPartialText: string;
  asrError: string | null;
  asrSwitchLoading: boolean;
  onChatDraftChange: (value: string) => void;
  onChatSubmit: () => void;
  onClearChat: () => void;
  onToggleAsr: (nextEnabled: boolean) => void | Promise<void>;
  onChatReasoningEffortChange: (effort: PetReasoningEffort | '') => void;
  onChatModelChange: (modelId: string) => void;
}) {
  const scaleControl = useScaleControl({ scale, onPreview: onScalePreview, onPersist: onScalePersist });
  // 思考深度只在当前模型确实有档位时出现；空集不是“默认值”，而是接口不接受该参数。
  const efforts = findModelEfforts(llmModels, chatModel);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-5">
      {/* 顶部工具条独立成卡，与页面底色区分：模型大小占满中间，右侧切模型。 */}
      <div className="flex shrink-0 items-center gap-3 rounded-box border border-base-300 bg-base-100 px-3 py-2">
        <span className="shrink-0 text-xs text-base-content/50">模型大小</span>
        <input
          type="range"
          min={0.3}
          max={2}
          step={0.01}
          aria-label="模型大小"
          value={scaleControl.value}
          onPointerDown={(event) => scaleControl.beginGesture(event.currentTarget, event.pointerId)}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
              event.currentTarget.releasePointerCapture?.(event.pointerId);
            }
            scaleControl.finishGesture();
          }}
          onLostPointerCapture={scaleControl.finishGesture}
          onPointerCancel={scaleControl.finishGesture}
          onBlur={scaleControl.finishGesture}
          onChange={(event) => scaleControl.changeScale(Number.parseFloat(event.target.value))}
          className="range range-xs min-w-0 flex-1"
        />
        <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-base-content/45">
          {scaleControl.label}
        </span>
        <button
          type="button"
          className="btn btn-outline btn-sm shrink-0"
          title={`当前模型：${model.name}`}
          onClick={onGotoModels}
        >
          切换模型
        </button>
      </div>

      <ChatPanel
        fill
        showHeader={false}
        title="对话"
        messages={chatMessages}
        draft={chatDraft}
        busy={chatSending}
        error={chatError}
        onDraftChange={onChatDraftChange}
        onSubmit={onChatSubmit}
        inputLabel="对话输入"
        placeholder="在这里与 AI 对话，Shift+Enter 换行，Enter 发送"
        emptyMessage="还没有对话。直接输入文字即可开始，语音识别结果会汇入同一条链路。"
        model={llmModels.length ? {
          label: 'Model',
          value: chatModel,
          options: modelOptionList(llmModels),
          disabled: chatSending,
          onChange: onChatModelChange,
        } : undefined}
        effort={efforts.length ? {
          label: 'Reasoning',
          value: chatReasoningEffort || efforts[0],
          options: effortOptionList(efforts),
          disabled: chatSending,
          onChange: (value) => onChatReasoningEffortChange(value as PetReasoningEffort),
        } : undefined}
        toolbar={
          <button
            type="button"
            className="btn btn-outline btn-error btn-xs ml-auto"
            disabled={chatSending || chatMessages.length === 0}
            onClick={onClearChat}
          >
            清空对话
          </button>
        }
        voiceInput={{
          enabled: asrEnabled,
          statusLabel: MIC_STATE_LABEL[asrState] ?? '语音输入',
          partialText: asrPartialText,
          errorText: asrError,
          loading: asrSwitchLoading,
          onChange: (next) => void onToggleAsr(next),
        }}
      />
    </div>
  );
}
