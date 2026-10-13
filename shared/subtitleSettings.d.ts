export interface SubtitleBounds { x: number; y: number; width: number; height: number }
export interface SubtitleSettings {
  enabled: boolean; alwaysOnTop: boolean; locked: boolean;
  textColor: string; outlineColor: string; backgroundOpacity: number; holdMs: number;
  positions: Record<string, SubtitleBounds>;
}
export interface PushToTalkSettings { enabled: boolean; key: 'Backquote' | 'ControlRight' | 'F8' }
export const SUBTITLE_LIMITS: Readonly<{ minWidth: number; minHeight: number; maxWidth: number; maxHeight: number }>;
export const DEFAULT_SUBTITLE_SETTINGS: Readonly<SubtitleSettings>;
export const DEFAULT_PUSH_TO_TALK: Readonly<PushToTalkSettings>;
export function normalizeSubtitleSettings(raw?: Partial<SubtitleSettings>): SubtitleSettings;
export function normalizePushToTalk(raw?: Partial<PushToTalkSettings>): PushToTalkSettings;
export function subtitleFontSize(width: number, height: number): number;
export function fitSubtitleBounds(bounds: Partial<SubtitleBounds>, workArea: SubtitleBounds): SubtitleBounds;
