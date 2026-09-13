export const PET_WINDOW_BASE_CONTENT_WIDTH: number;
export const PET_WINDOW_BASE_CONTENT_HEIGHT: number;

export interface Live2dLayoutInput {
  baseWidth: number;
  baseHeight: number;
  scale: number;
  sideWidth?: number;
}
export interface LayoutRect { x: number; y: number; width: number; height: number }
export interface ThreeRectLayout {
  width: number;
  height: number;
  centerX: number;
  bottomY: number;
  model: LayoutRect;
  left: LayoutRect;
  right: LayoutRect;
}
export function calculateLive2dLayout(input: Live2dLayoutInput): ThreeRectLayout;
export function calculateSideWidth(configuredWidth: number, scale: number): number;
