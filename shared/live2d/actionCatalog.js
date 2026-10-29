export const ACTION_CATEGORIES = ['head', 'gaze', 'blink', 'emotion', 'body', 'other'];
export const ACTION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const RESERVED_ACTION_PARAMETERS = ['ParamBreath', 'ParamMouthOpenY'];

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Shared wire/disk/runtime contract. Constructs plain DTOs and rejects the entire invalid edit. */
export function parseActionCatalog(value) {
  if (!Array.isArray(value) || value.length > 64) throw new Error('动作表必须是最多 64 项的数组');
  const ids = new Set();
  return value.map((action) => {
    if (!object(action) || typeof action.id !== 'string' || !ACTION_ID_PATTERN.test(action.id)
      || ids.has(action.id) || typeof action.label !== 'string' || !action.label.trim()
      || !ACTION_CATEGORIES.includes(action.category)) throw new Error('动作 ID、名称或类别无效或重复');
    ids.add(action.id);
    if (!finite(action.durationMs) || action.durationMs <= 0 || action.durationMs > 30000
      || !finite(action.enterMs) || action.enterMs < 0 || action.enterMs > 5000
      || !finite(action.returnMs) || action.returnMs < 0 || action.returnMs > 5000) {
      throw new Error(`动作 ${action.id} 的时长无效`);
    }
    if (!Array.isArray(action.tracks) || !action.tracks.length || action.tracks.length > 64) {
      throw new Error(`动作 ${action.id} 必须包含参数轨迹，不能只引用原生动作`);
    }
    const parameters = new Set();
    const tracks = action.tracks.map((track) => {
      if (!object(track) || typeof track.parameterId !== 'string' || !track.parameterId.trim()
        || parameters.has(track.parameterId) || RESERVED_ACTION_PARAMETERS.includes(track.parameterId)
        || !Array.isArray(track.keyframes) || !track.keyframes.length || track.keyframes.length > 120) {
        throw new Error(`动作 ${action.id} 包含无效、重复或被保留的参数轨迹`);
      }
      parameters.add(track.parameterId);
      let previous = -1;
      const keyframes = track.keyframes.map((point, index) => {
        if (!object(point) || !finite(point.timeMs) || !finite(point.value)
          || point.timeMs <= previous || point.timeMs > action.durationMs || (index === 0 && point.timeMs !== 0)) {
          throw new Error(`动作 ${action.id} 的关键帧必须从 0 毫秒开始且时间严格递增`);
        }
        previous = point.timeMs;
        return { timeMs: point.timeMs, value: point.value };
      });
      return { parameterId: track.parameterId, keyframes };
    });
    return { id: action.id, label: action.label.trim(), category: action.category,
      ...(typeof action.description === 'string' && action.description.trim() ? { description: action.description.trim() } : {}),
      durationMs: action.durationMs, enterMs: action.enterMs, returnMs: action.returnMs, tracks };
  });
}

/** Disk load only: obsolete native-motion aliases cannot execute as generated parameter actions. */
export function readActionCatalog(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    try { return parseActionCatalog([item]); } catch { return []; }
  }).filter((item, index, all) => all.findIndex((entry) => entry.id === item.id) === index);
}
