export const SUBTITLE_LIMITS = Object.freeze({ minWidth: 280, minHeight: 64, maxWidth: 960, maxHeight: 160 });
export const DEFAULT_SUBTITLE_SETTINGS = Object.freeze({
  enabled: true, alwaysOnTop: true, locked: false,
  textColor: '#ffffff', outlineColor: '#202020', backgroundOpacity: 0.18,
  holdMs: 2000, positions: {},
});
const clamp = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
export function normalizeSubtitleSettings(raw = {}) {
  const positions = {};
  for (const [id, bounds] of Object.entries(raw?.positions ?? {})) {
    if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
      positions[id] = { x: Math.round(bounds.x), y: Math.round(bounds.y),
        width: Math.round(clamp(bounds.width, 480, 280, 960)), height: Math.round(clamp(bounds.height, 80, 64, 160)) };
    }
  }
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : true,
    alwaysOnTop: typeof raw?.alwaysOnTop === 'boolean' ? raw.alwaysOnTop : true,
    locked: typeof raw?.locked === 'boolean' ? raw.locked : false,
    textColor: color(raw?.textColor, '#ffffff'), outlineColor: color(raw?.outlineColor, '#202020'),
    backgroundOpacity: clamp(raw?.backgroundOpacity, 0.18, 0, 0.8),
    holdMs: clamp(raw?.holdMs, 2000, 500, 5000), positions,
  };
}
export const DEFAULT_PUSH_TO_TALK = Object.freeze({ enabled: true, key: 'Backquote' });
export function normalizePushToTalk(raw = {}) {
  return { enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : true,
    key: ['Backquote', 'ControlRight', 'F8'].includes(raw?.key) ? raw.key : 'Backquote' };
}
export function subtitleFontSize(width, height) {
  return Math.max(14, Math.min(28, 18 * Math.min(width / 480, height / 80)));
}
export function fitSubtitleBounds(bounds, workArea) {
  const width = Math.min(workArea.width, clamp(bounds.width, 480, 280, 960));
  const height = Math.min(workArea.height, clamp(bounds.height, 80, 64, 160));
  return { width: Math.round(width), height: Math.round(height),
    x: Math.round(clamp(bounds.x, workArea.x + (workArea.width - width) / 2, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(bounds.y, workArea.y + workArea.height - height - 20, workArea.y, workArea.y + workArea.height - height)),
  };
}
