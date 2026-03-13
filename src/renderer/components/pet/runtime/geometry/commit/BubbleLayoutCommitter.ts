import { useCallback, type RefObject } from 'react';

export interface BubbleZoneMetricsCommitInput {
  left: { left: number; width: number; targetWidth: number };
  right: { left: number; width: number; targetWidth: number };
  active: 'left' | 'right';
  symmetricWidth: number;
  symmetricCapacity: number;
  widthShortfall: boolean;
  awaitingResize: boolean;
  requiredWindowWidth: number;
}

export interface BubblePositionCommitInput {
  side: 'left' | 'right';
  position: { left: number; top: number };
  tailY: number | null;
}

export interface UseBubbleLayoutCommitterParams {
  redLineLeftRef: RefObject<number | null>;
  visibleFrameMetricsRef: RefObject<{ left: number; width: number } | null>;
  baseFrameMetricsRef: RefObject<{ left: number; width: number } | null>;
  bubbleZoneMetricsRef: RefObject<BubbleZoneMetricsCommitInput | null>;
  bubbleAlignmentRef: RefObject<'left' | 'right' | null>;
  bubblePositionRef: RefObject<{ left: number; top: number } | null>;
  setRedLineLeft: (value: number) => void;
  setVisibleFrameMetrics: (value: { left: number; width: number }) => void;
  setBaseFrameMetrics: (value: { left: number; width: number }) => void;
  setBubbleZoneMetrics: (value: BubbleZoneMetricsCommitInput) => void;
  setBubblePosition: (value: { left: number; top: number } | null) => void;
  setBubbleAlignment: (value: 'left' | 'right') => void;
  setBubbleTailY: (value: number | null) => void;
  commitBubbleReady: (next: boolean) => void;
}

export interface BubbleLayoutCommitter {
  commitRedLine: (nextRedLeft: number) => void;
  commitVisibleFrameMetrics: (next: { left: number; width: number }) => void;
  commitBaseFrameMetrics: (next: { left: number; width: number }) => void;
  commitBubbleZoneMetrics: (next: BubbleZoneMetricsCommitInput) => void;
  commitBubblePlacement: (next: BubblePositionCommitInput) => void;
  clearBubblePresentation: () => void;
}

export const useBubbleLayoutCommitter = ({
  redLineLeftRef,
  visibleFrameMetricsRef,
  baseFrameMetricsRef,
  bubbleZoneMetricsRef,
  bubbleAlignmentRef,
  bubblePositionRef,
  setRedLineLeft,
  setVisibleFrameMetrics,
  setBaseFrameMetrics,
  setBubbleZoneMetrics,
  setBubblePosition,
  setBubbleAlignment,
  setBubbleTailY,
  commitBubbleReady,
}: UseBubbleLayoutCommitterParams): BubbleLayoutCommitter => {
  const commitRedLine = useCallback((nextRedLeft: number) => {
    const prevRed = redLineLeftRef.current;
    if (prevRed == null || Math.abs(prevRed - nextRedLeft) > 0.5) {
      redLineLeftRef.current = nextRedLeft;
      setRedLineLeft(nextRedLeft);
    }
  }, [redLineLeftRef, setRedLineLeft]);

  const commitVisibleFrameMetrics = useCallback((next: { left: number; width: number }) => {
    const prev = visibleFrameMetricsRef.current;
    if (!prev || Math.abs(prev.left - next.left) > 0.5 || Math.abs(prev.width - next.width) > 0.5) {
      visibleFrameMetricsRef.current = next;
      setVisibleFrameMetrics(next);
    }
  }, [visibleFrameMetricsRef, setVisibleFrameMetrics]);

  const commitBaseFrameMetrics = useCallback((next: { left: number; width: number }) => {
    const prev = baseFrameMetricsRef.current;
    if (!prev || Math.abs(prev.left - next.left) > 0.5 || Math.abs(prev.width - next.width) > 0.5) {
      baseFrameMetricsRef.current = next;
      setBaseFrameMetrics(next);
    }
  }, [baseFrameMetricsRef, setBaseFrameMetrics]);

  const commitBubbleZoneMetrics = useCallback((next: BubbleZoneMetricsCommitInput) => {
    const prev = bubbleZoneMetricsRef.current;
    if (
      !prev
      || Math.abs(prev.left.left - next.left.left) > 0.5
      || Math.abs(prev.left.width - next.left.width) > 0.5
      || Math.abs(prev.left.targetWidth - next.left.targetWidth) > 0.5
      || Math.abs(prev.right.left - next.right.left) > 0.5
      || Math.abs(prev.right.width - next.right.width) > 0.5
      || Math.abs(prev.right.targetWidth - next.right.targetWidth) > 0.5
      || prev.active !== next.active
      || Math.abs(prev.symmetricWidth - next.symmetricWidth) > 0.5
      || Math.abs(prev.symmetricCapacity - next.symmetricCapacity) > 0.5
      || prev.widthShortfall !== next.widthShortfall
      || prev.awaitingResize !== next.awaitingResize
      || Math.abs(prev.requiredWindowWidth - next.requiredWindowWidth) > 0.5
    ) {
      bubbleZoneMetricsRef.current = next;
      setBubbleZoneMetrics(next);
    }
  }, [bubbleZoneMetricsRef, setBubbleZoneMetrics]);

  const commitBubblePlacement = useCallback((next: BubblePositionCommitInput) => {
    if (next.tailY !== null) {
      setBubbleTailY(Math.round(next.tailY));
    }

    if (bubbleAlignmentRef.current !== next.side) {
      bubbleAlignmentRef.current = next.side;
      setBubbleAlignment(next.side);
    }

    const prev = bubblePositionRef.current;
    if (!prev || Math.abs(prev.left - next.position.left) > 0.5 || Math.abs(prev.top - next.position.top) > 0.5) {
      bubblePositionRef.current = next.position;
      setBubblePosition(next.position);
    }

    commitBubbleReady(true);
  }, [bubbleAlignmentRef, bubblePositionRef, setBubbleTailY, setBubbleAlignment, setBubblePosition, commitBubbleReady]);

  const clearBubblePresentation = useCallback(() => {
    bubblePositionRef.current = null;
    setBubblePosition(null);
    bubbleAlignmentRef.current = null;
    commitBubbleReady(false);
  }, [bubbleAlignmentRef, bubblePositionRef, setBubblePosition, commitBubbleReady]);

  return {
    commitRedLine,
    commitVisibleFrameMetrics,
    commitBaseFrameMetrics,
    commitBubbleZoneMetrics,
    commitBubblePlacement,
    clearBubblePresentation,
  };
};
