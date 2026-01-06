export type ControlPanelTabKey = 'home' | 'models' | 'interaction' | 'ai';

export type ThemeMode = 'light' | 'dark';

export type ModelEntry = {
  id: string;
  name: string;
  path: string;
};

export type GlobalUiSettings = {
  scale: number;
  ignoreMouse: boolean;
  autoLaunch: boolean;
  showDragHandleOnHover: boolean;
  forcedFollow: boolean;
  debugModeEnabled: boolean;
};

export type VisualFrameConfig = {
  ratio: number;
  minPx: number;
  paddingPx: number;
  center: string;
  offsetPx: number;
  offsetRatio: number;
};

export type BubbleConfig = {
  symmetric: boolean;
  headRatio: number | null;
};

export type ModelConfig = {
  touchMap: number[];
  visualFrame: VisualFrameConfig;
  bubble: BubbleConfig;
};
