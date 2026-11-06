import { ArrowLeftRight, Boxes, Eraser, Heart, Scaling } from 'lucide-react';
import ChatPanel from '../components/common/ChatPanel';
import { Page } from '../components/common/Page';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { AgentCard } from '../components/ai/AgentCard';
import { useScaleControl } from '../hooks/useScaleControl';
import { useModelRelationship } from '../hooks/useModelRelationship';
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
  const relationship = useModelRelationship(model.path || null);
  // 思考深度只在当前模型确实有档位时出现；空集不是“默认值”，而是接口不接受该参数。
  const efforts = findModelEfforts(llmModels, chatModel);

  return (
    <Page fill title="主页" description="和角色直接对话，语音识别的结果也会汇入这里。"
      meta={/* 关系只读：由对话整理写入记忆，这里只显示当前阶段，不提供修改入口。 */
        <Badge tone="primary" title={relationship.view?.line ?? '还没有读取到关系记录'}>
          <Heart aria-hidden="true" className="size-3" />
          关系 · {relationship.view?.stage || '未记录'}
        </Badge>}>
      {/* 顶部工具条独立成卡，与页面底色区分：模型大小占满中间，右侧切模型。 */}
      <div className="flex shrink-0 items-center gap-3 rounded-xl bg-card px-4 py-2.5 shadow-card">
        <Scaling aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs font-medium text-foreground/80">模型大小</span>
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
          className="ui-range min-w-0 flex-1"
        />
        <span className="w-10 shrink-0 rounded-md bg-muted py-0.5 text-center font-mono text-[11px] tabular-nums text-foreground/80">
          {scaleControl.label}
        </span>
        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
        <Button variant="ghost" title={`当前模型：${model.name}`} onClick={onGotoModels} className="max-w-56">
          <Boxes />
          <span className="truncate">{model.name || '切换模型'}</span>
          <ArrowLeftRight className="text-muted-foreground" />
        </Button>
      </div>

      <AgentCard />
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
          <Button variant="danger" size="xs" className="ml-auto"
            disabled={chatSending || chatMessages.length === 0} onClick={onClearChat}>
            <Eraser />
            清空对话
          </Button>
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
    </Page>
  );
}
