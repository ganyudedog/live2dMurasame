import { useEffect, useRef } from 'react';
import type { ModelConfig } from '../types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';

const isSameRagProfile = (
  left: ModelConfig['rag']['profile'],
  right: ModelConfig['rag']['profile'],
) => {
  return (
    left.personal === right.personal &&
    left.speakingStyle === right.speakingStyle &&
    left.relation === right.relation &&
    left.banned === right.banned &&
    left.world === right.world
  );
};

export default function RagSettingsPage({
  modelConfig,
  onModelConfigChange,
}: {
  modelConfig: ModelConfig;
  onModelConfigChange: (next: ModelConfig) => Promise<void>;
}) {
  const modelConfigRef = useRef(modelConfig);

  useEffect(() => {
    modelConfigRef.current = modelConfig;
  }, [modelConfig]);

  const ragProfileDraft = useDebouncedRemoteDraft<ModelConfig['rag']['profile']>({
    remoteValue: modelConfig.rag.profile,
    debounceMs: 260,
    isEqual: isSameRagProfile,
    onCommit: (nextProfile) => {
      const current = modelConfigRef.current;
      return onModelConfigChange({
        ...current,
        rag: {
          ...current.rag,
          profile: nextProfile,
        },
      });
    },
  });

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">RAG 设置</h1>
        <p className="text-xs text-base-content/60">角色个性与对话风格</p>
      </div>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-4">
        <header className="flex items-center justify-between">
          <div className="text-sm font-medium">角色设定</div>
          <span className="badge badge-ghost">阶段 3</span>
        </header>

        <div className="space-y-3">
          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">角色个性</span>
            </div>
            <textarea
              className="textarea textarea-sm textarea-bordered w-full"
              rows={3}
              value={ragProfileDraft.draft.personal}
              placeholder="例如：傲娇但礼貌，偏短句，喜欢吐槽"
              onChange={(e) =>
                ragProfileDraft.commit({
                  ...ragProfileDraft.draft,
                  personal: e.target.value,
                })
              }
            />
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">说话风格</span>
            </div>
            <textarea
              className="textarea textarea-sm textarea-bordered w-full"
              rows={2}
              value={ragProfileDraft.draft.speakingStyle}
              placeholder="例如：口语化、每句不超过25字、少用书面词"
              onChange={(e) =>
                ragProfileDraft.commit({
                  ...ragProfileDraft.draft,
                  speakingStyle: e.target.value,
                })
              }
            />
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">关系设定</span>
            </div>
            <textarea
              className="textarea textarea-sm textarea-bordered w-full"
              rows={2}
              value={ragProfileDraft.draft.relation}
              placeholder="例如：青梅竹马、略傲娇但会照顾人"
              onChange={(e) =>
                ragProfileDraft.commit({
                  ...ragProfileDraft.draft,
                  relation: e.target.value,
                })
              }
            />
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">禁忌/禁止内容</span>
            </div>
            <textarea
              className="textarea textarea-sm textarea-bordered w-full"
              rows={2}
              value={ragProfileDraft.draft.banned}
              placeholder="例如：禁止人身攻击、禁止编造事实"
              onChange={(e) =>
                ragProfileDraft.commit({
                  ...ragProfileDraft.draft,
                  banned: e.target.value,
                })
              }
            />
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">世界观</span>
            </div>
            <textarea
              className="textarea textarea-sm textarea-bordered w-full"
              rows={3}
              value={ragProfileDraft.draft.world}
              placeholder="例如：故事发生在架空近未来学园都市"
              onChange={(e) =>
                ragProfileDraft.commit({
                  ...ragProfileDraft.draft,
                  world: e.target.value,
                })
              }
            />
          </label>
        </div>

        <div className="text-xs text-base-content/60">
          说明：这些设定会影响 AI 的对话风格与角色表现。
        </div>
      </section>
    </div>
  );
}
