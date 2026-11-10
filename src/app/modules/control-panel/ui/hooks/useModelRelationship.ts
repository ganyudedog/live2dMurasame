import { useCallback, useEffect, useState } from 'react';
import { LlmMemoryRepository } from '@app/modules/ai/modules/llm/infrastructure/LlmMemoryRepository';
import {
  promptLineFromMemory,
  extractRelationship,
  isKnownStage,
  type PublicRelationship,
} from '@app/modules/ai/modules/llm/domain/memory/memoryContext';
import { DEFAULT_RELATIONSHIP_STAGE, STAGE_LINES } from '../../../../../../shared/memory/relationship.js';

const STAGE_NAME = /阶段[:：]\s*([^\s。，,、；;]+)/u;

export interface RelationshipView {
  stage: string;
  line: string;
  needsSelection: boolean;
  revision: number;
}

interface RelationshipAdjustment {
  stage: string;
}

const blankView = (): RelationshipView => ({
  stage: DEFAULT_RELATIONSHIP_STAGE,
  line: STAGE_LINES[DEFAULT_RELATIONSHIP_STAGE],
  needsSelection: false,
  revision: 0,
});

const viewFromRelationship = (relationship: PublicRelationship): RelationshipView => {
  return {
    stage: relationship.needsSelection ? '' : relationship.stage,
    line: promptLineFromMemory({ relationship })!,
    needsSelection: relationship.needsSelection,
    revision: relationship.revision,
  };
};

/** 从权威关系状态读取；只有旧文本时才退回那一行，未知阶段标成待选择。 */
export const readRelationshipView = (
  input: string | { coreText?: string; relationship?: PublicRelationship | null } | null | undefined,
): RelationshipView => {
  if (typeof input !== 'string' && input?.relationship) {
    return viewFromRelationship(input.relationship);
  }
  const text = typeof input === 'string' ? input : String(input?.coreText ?? '');
  const { stageLine } = extractRelationship(text);
  if (!stageLine) return blankView();
  const name = STAGE_NAME.exec(stageLine)?.[1] ?? '';
  if (!isKnownStage(name)) {
    return {
      ...blankView(),
      stage: '',
      line: promptLineFromMemory({ relationship: { needsSelection: true, legacyText: stageLine } })!,
      needsSelection: true,
    };
  }
  return {
    ...blankView(),
    stage: name,
    line: stageLine,
  };
};

const relationshipErrorText = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('revision conflict') || message.includes('revision is required')) {
    return '关系刚刚在另一处更新了，请再看一眼现在的阶段，然后重新调整。';
  }
  if (message.includes('Unknown relationship stage')) return '请先选择一个关系阶段。';
  return message || '没有写进记忆。';
};

interface RelationshipScreen {
  path: string | null;
  view: RelationshipView | null;
}

/** 旧模型的版本号、以及比当前画面更旧的读取结果，都不能写进现在这个模型。 */
export const acceptRelationshipSnapshot = (
  current: { modelPath: string | null; revision: number } | null,
  targetPath: string | null,
  snapshot: { modelPath?: string | null; relationship?: { revision?: number } | null } | null | undefined,
): boolean => {
  if (!targetPath || !snapshot || snapshot.modelPath !== targetPath) return false;
  const revision = snapshot.relationship?.revision;
  if (!Number.isInteger(revision) || (revision ?? 0) < 1) return false;
  if (current?.modelPath === targetPath && (revision ?? 0) < current.revision) return false;
  return true;
};

export const canSubmitRelationshipAdjustment = (
  view: { modelPath: string | null; revision: number } | null,
  targetPath: string | null,
): boolean => Boolean(targetPath && view?.modelPath === targetPath && Number.isInteger(view.revision));

const commitRelationshipSnapshot = (
  current: RelationshipScreen,
  targetPath: string | null,
  snapshot: PetModelMemoryState | null | undefined,
): RelationshipScreen => {
  if (current.path !== targetPath) return current;
  const held = current.view ? { modelPath: current.path, revision: current.view.revision } : null;
  if (!acceptRelationshipSnapshot(held, targetPath, snapshot)) return current;
  return { path: targetPath, view: readRelationshipView(snapshot) };
};

/** 读取当前模型的关系，并用预期版本号提交手动调整，避免旧界面盖住新状态。 */
export const useModelRelationship = (modelPath: string | null) => {
  const [screen, setScreen] = useState<RelationshipScreen>({ path: modelPath, view: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  if (screen.path !== modelPath) {
    setScreen({ path: modelPath, view: null });
    setLoading(true);
    setError('');
    setActionError('');
  }
  const view = screen.path === modelPath ? screen.view : null;

  useEffect(() => {
    let cancelled = false;
    const requested = modelPath;
    void (async () => {
      try {
        const state = await new LlmMemoryRepository().get(requested ?? undefined);
        if (cancelled) return;
        setScreen((current) => commitRelationshipSnapshot(current, requested, state));
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

  useEffect(() => {
    const subscribe = window.MemoryAPI?.onUpdated;
    if (typeof subscribe !== 'function') return undefined;
    const off = subscribe((payload) => {
      if (!payload || payload.modelPath !== modelPath) return;
      setScreen((current) => commitRelationshipSnapshot(current, modelPath, payload));
      setError('');
      setLoading(false);
    });
    return () => { if (typeof off === 'function') off(); };
  }, [modelPath]);

  const adjust = useCallback(async (input: RelationshipAdjustment) => {
    const current = screen.path === modelPath ? screen.view : null;
    if (!canSubmitRelationshipAdjustment(current ? { modelPath, revision: current.revision } : null, modelPath)) {
      setActionError('关系还没对上当前模型，请先看一眼再调整。');
      return false;
    }
    setBusy(true);
    setActionError('');
    try {
      const saved = await new LlmMemoryRepository().adjustRelationship({
        modelPath: modelPath ?? undefined,
        expectedRevision: current?.revision ?? 0,
        stage: input.stage,
      });
      if (!saved) {
        setActionError('没有写进记忆。');
        return false;
      }
      setScreen((latest) => commitRelationshipSnapshot(latest, modelPath, saved));
      return true;
    } catch (cause: unknown) {
      setActionError(relationshipErrorText(cause));
      return false;
    } finally { setBusy(false); }
  }, [modelPath, screen]);

  return { view, loading, busy, error, actionError, reload, adjust };
};
