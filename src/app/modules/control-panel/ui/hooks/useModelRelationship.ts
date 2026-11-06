import { useCallback, useEffect, useState } from 'react';
import { LlmMemoryRepository } from '@app/modules/ai/modules/llm/infrastructure/LlmMemoryRepository';
import { RELATIONSHIP_STAGES, currentRelationshipLine, extractRelationship } from '@app/modules/ai/modules/llm/domain/memory/memoryContext';

const STAGE_PATTERN = /阶段[:：]\s*([^\s。，,、]+)/u;

export interface RelationshipView {
  /** 记忆里记录的阶段；没有「当前关系」一节时为空。 */
  stage: string;
  /** 实际进入提示词的那一行（未记录时是默认阶段）。 */
  line: string;
  recorded: boolean;
  coreChars: number;
}

/** 从核心记忆文本推导只读的关系视图；非预设阶段也原样显示，不做静默改写。 */
export const readRelationshipView = (coreText: string): RelationshipView => {
  const text = String(coreText ?? '');
  const { stageLine } = extractRelationship(text);
  return {
    stage: STAGE_PATTERN.exec(stageLine)?.[1] ?? '',
    line: currentRelationshipLine(text),
    recorded: Boolean(stageLine),
    coreChars: text.length,
  };
};

export const isKnownStage = (stage: string): boolean =>
  (RELATIONSHIP_STAGES as readonly string[]).includes(stage);

/** 关系由对话整理写入记忆，前端只读展示；这里只负责读取当前模型的记忆文本。 */
export const useModelRelationship = (modelPath: string | null) => {
  const [view, setView] = useState<RelationshipView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await new LlmMemoryRepository().get(modelPath ?? undefined);
        if (cancelled) return;
        setView(readRelationshipView(String(state?.coreText ?? '')));
        setError('');
      } catch (cause: unknown) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [modelPath, reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((value) => value + 1);
  }, []);

  // 记忆整理完成后主进程会广播给所有窗口，这里跟着更新，不用手动点刷新。
  useEffect(() => {
    const subscribe = window.MemoryAPI?.onUpdated;
    if (typeof subscribe !== 'function') return undefined;
    const off = subscribe((payload) => {
      if (!payload || typeof payload.coreText !== 'string') return;
      if (modelPath && payload.modelPath && payload.modelPath !== modelPath) return;
      setView(readRelationshipView(payload.coreText));
      setError('');
      setLoading(false);
    });
    return () => { if (typeof off === 'function') off(); };
  }, [modelPath]);

  return { view, loading, error, reload };
};
