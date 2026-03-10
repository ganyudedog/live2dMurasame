import { useEffect, useRef } from 'react';
import type { ModelConfig } from '../types';
import { useDebouncedRemoteDraft } from '../hooks/useDebouncedRemoteDraft';

const isSameRagRetrieval = (
  left: ModelConfig['rag']['retrieval'],
  right: ModelConfig['rag']['retrieval'],
) => {
  return (
    left.enabled === right.enabled &&
    left.topK === right.topK &&
    left.threshold === right.threshold &&
    left.knowledgeBasePath === right.knowledgeBasePath &&
    left.embeddingModel === right.embeddingModel &&
    left.rerankerModel === right.rerankerModel
  );
};

export default function RagParamsPage({
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

  const ragRetrievalDraft = useDebouncedRemoteDraft<ModelConfig['rag']['retrieval']>({
    remoteValue: modelConfig.rag.retrieval,
    debounceMs: 260,
    isEqual: isSameRagRetrieval,
    onCommit: (nextRetrieval) => {
      const current = modelConfigRef.current;
      return onModelConfigChange({
        ...current,
        rag: {
          ...current.rag,
          retrieval: nextRetrieval,
        },
      });
    },
  });

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">RAG 参数</h1>
        <p className="text-xs text-base-content/60">检索与知识库配置</p>
      </div>

      <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-4">
        <header className="flex items-center justify-between">
          <div className="text-sm font-medium">检索参数</div>
          <label className="label cursor-pointer gap-2">
            <span className="label-text text-xs">启用 RAG</span>
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={ragRetrievalDraft.draft.enabled}
              onChange={(e) =>
                ragRetrievalDraft.commit({
                  ...ragRetrievalDraft.draft,
                  enabled: e.target.checked,
                })
              }
            />
          </label>
        </header>

        <div className="space-y-3">
          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">知识库路径</span>
            </div>
            <input
              type="text"
              className="input input-sm input-bordered w-full"
              value={ragRetrievalDraft.draft.knowledgeBasePath}
              placeholder="knowledge/default.txt"
              onChange={(e) =>
                ragRetrievalDraft.commit({
                  ...ragRetrievalDraft.draft,
                  knowledgeBasePath: e.target.value,
                })
              }
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">检索数量 (topK)</span>
              </div>
              <input
                type="number"
                className="input input-sm input-bordered w-full"
                value={ragRetrievalDraft.draft.topK}
                min={1}
                max={8}
                onChange={(e) =>
                  ragRetrievalDraft.commit({
                    ...ragRetrievalDraft.draft,
                    topK: Number.parseInt(e.target.value, 10),
                  })
                }
              />
            </label>

            <label className="form-control">
              <div className="label py-0">
                <span className="label-text text-xs">阈值 (threshold)</span>
              </div>
              <input
                type="number"
                className="input input-sm input-bordered w-full"
                value={ragRetrievalDraft.draft.threshold}
                min={0}
                max={1}
                step={0.1}
                onChange={(e) =>
                  ragRetrievalDraft.commit({
                    ...ragRetrievalDraft.draft,
                    threshold: Number.parseFloat(e.target.value),
                  })
                }
              />
            </label>
          </div>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">Embedding 模型</span>
            </div>
            <input
              type="text"
              className="input input-sm input-bordered w-full"
              value={ragRetrievalDraft.draft.embeddingModel}
              placeholder="text-embedding-v3"
              onChange={(e) =>
                ragRetrievalDraft.commit({
                  ...ragRetrievalDraft.draft,
                  embeddingModel: e.target.value,
                })
              }
            />
          </label>

          <label className="form-control">
            <div className="label py-0">
              <span className="label-text text-xs">Reranker 模型</span>
            </div>
            <input
              type="text"
              className="input input-sm input-bordered w-full"
              value={ragRetrievalDraft.draft.rerankerModel}
              placeholder="bge-reranker-v2"
              onChange={(e) =>
                ragRetrievalDraft.commit({
                  ...ragRetrievalDraft.draft,
                  rerankerModel: e.target.value,
                })
              }
            />
          </label>
        </div>

        <div className="text-xs text-base-content/60">
          说明：这些参数控制知识库检索的精度与范围，当前使用本地轻量级检索。
        </div>
      </section>
    </div>
  );
}
