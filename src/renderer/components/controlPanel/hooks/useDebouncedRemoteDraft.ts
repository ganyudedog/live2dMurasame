import { useEffect, useReducer, useRef } from 'react';

type EqualityFn<T> = (left: T, right: T) => boolean;

type State<T> = {
  draft: T;
  desired: T;
  pending: boolean;
  pendingRequestId: number | null;
};

type Action<T> =
  | { type: 'commit'; next: T; requestId: number }
  | { type: 'ack' }
  | { type: 'rollback'; rollback: T; requestId: number };

const defaultEquality = <T,>(left: T, right: T): boolean => Object.is(left, right);

const createReducer = <T,>() => {
  return (state: State<T>, action: Action<T>): State<T> => {
    if (action.type === 'commit') {
      return {
        draft: action.next,
        desired: action.next,
        pending: true,
        pendingRequestId: action.requestId,
      };
    }
    if (action.type === 'ack') {
      return {
        ...state,
        pending: false,
        pendingRequestId: null,
      };
    }
    if (action.type === 'rollback') {
      if (state.pendingRequestId !== action.requestId) return state;
      return {
        draft: action.rollback,
        desired: action.rollback,
        pending: false,
        pendingRequestId: null,
      };
    }
    return state;
  };
};

export const useDebouncedRemoteDraft = <T,>(options: {
  remoteValue: T;
  onCommit: (next: T) => Promise<void>;
  debounceMs?: number;
  isEqual?: EqualityFn<T>;
}) => {
  const {
    remoteValue,
    onCommit,
    debounceMs = 280,
    isEqual = defaultEquality,
  } = options;

  const reducer = createReducer<T>();
  const [state, dispatch] = useReducer(reducer, remoteValue, (initial) => ({
    draft: initial,
    desired: initial,
    pending: false,
    pendingRequestId: null,
  }));

  const remoteRef = useRef(remoteValue);
  const requestIdRef = useRef(0);
  const commitTimerRef = useRef<number | null>(null);
  const latestCommitRef = useRef<{ next: T; requestId: number } | null>(null);

  useEffect(() => {
    remoteRef.current = remoteValue;
  }, [remoteValue]);

  useEffect(() => {
    return () => {
      if (commitTimerRef.current == null) return;

      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      const latest = latestCommitRef.current;
      if (!latest) return;
      latestCommitRef.current = null;
      onCommit(latest.next).catch(() => {
        // ignore
      });
    };
  }, [onCommit]);

  useEffect(() => {
    if (!state.pending) return;
    if (!isEqual(remoteValue, state.desired)) return;
    queueMicrotask(() => dispatch({ type: 'ack' }));
  }, [isEqual, remoteValue, state.desired, state.pending]);

  const commit = (next: T) => {
    const requestId = ++requestIdRef.current;
    dispatch({ type: 'commit', next, requestId });

    latestCommitRef.current = { next, requestId };
    if (commitTimerRef.current != null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }

    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      const latest = latestCommitRef.current;
      if (!latest) return;
      latestCommitRef.current = null;
      onCommit(latest.next).catch(() => {
        if (requestIdRef.current !== latest.requestId) return;
        const rollback = remoteRef.current;
        dispatch({ type: 'rollback', rollback, requestId: latest.requestId });
      });
    }, debounceMs);
  };

  const draft = state.pending ? state.draft : remoteValue;
  return { draft, commit, pending: state.pending };
};