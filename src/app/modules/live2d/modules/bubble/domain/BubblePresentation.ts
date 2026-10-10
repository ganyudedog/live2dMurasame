import { actionBound, makeObservable, observable, observableStruct } from 'mobx';

export interface BubbleZoneMetrics {
  left: { left: number; width: number; targetWidth: number };
  right: { left: number; width: number; targetWidth: number };
  active: 'left' | 'right';
  symmetricWidth: number;
  symmetricCapacity: number;
  widthShortfall: boolean;
}

/** Numeric presentation owned by Live2dService; no React setters or DOM references. */
export class BubblePresentation {
  position: { left: number; top: number } | null = null;
  alignment: 'left' | 'right' = 'left';
  tailY: number | null = null;
  visibleFrame: { left: number; width: number } | null = null;
  baseFrame: { left: number; width: number } | null = null;
  zones: BubbleZoneMetrics | null = null;

  constructor() {
    makeObservable(this, {
      position: observableStruct, alignment: observable, tailY: observable,
      visibleFrame: observableStruct,
      baseFrame: observableStruct, zones: observableStruct,
      commitVisibleFrameMetrics: actionBound,
      commitBaseFrameMetrics: actionBound, commitBubbleZoneMetrics: actionBound,
      commitBubblePlacement: actionBound, clearBubblePresentation: actionBound,
    });
  }

  commitVisibleFrameMetrics(value: { left: number; width: number }): void { this.visibleFrame = value; }
  commitBaseFrameMetrics(value: { left: number; width: number }): void { this.baseFrame = value; }
  commitBubbleZoneMetrics(value: BubbleZoneMetrics): void { this.zones = value; }
  commitBubblePlacement(value: { side: 'left' | 'right'; position: { left: number; top: number }; tailY: number | null }): void {
    this.alignment = value.side;
    this.position = value.position;
    this.tailY = value.tailY === null ? null : Math.round(value.tailY);
  }
  clearBubblePresentation(): void { this.position = null; }
}

export type BubblePresentationSink = Pick<BubblePresentation,
  'commitVisibleFrameMetrics' | 'commitBaseFrameMetrics'
  | 'commitBubbleZoneMetrics' | 'commitBubblePlacement' | 'clearBubblePresentation'>;
