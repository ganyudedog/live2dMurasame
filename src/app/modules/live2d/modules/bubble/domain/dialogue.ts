export interface DialogueMeasurementRequest {
  id: number;
  text: string;
  maxWidth: number;
  scale: number;
}

export interface DialogueMeasurement extends DialogueMeasurementRequest {
  width: number;
  height: number;
  lineCount: number;
}

export interface DialogueSentence {
  requestId: string;
  text: string;
  /** Explicit model line breaks begin a new visual page. */
  pageBreakBefore?: boolean;
}

export type DialoguePlaybackState = 'started' | 'finished' | 'cancelled' | 'error' | 'skipped';
