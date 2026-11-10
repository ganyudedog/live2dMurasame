export interface StickerChoice { id: string; description: string; sendWhen?: string }
/** Per-request mapping only. Unknown brackets remain ordinary text. */
export const mapStickerReply = (text: string, choices: readonly StickerChoice[]): string => {
  const labels = new Map<string, string>();
  for (const item of choices) {
    const label = item.description.trim();
    if (label && !labels.has(label)) labels.set(label, item.id);
  }
  const ids = new Set(choices.map((item) => item.id));
  let selected: string | undefined;
  const clean = text.replace(/\[\[sticker:([^\]\r\n]*)\]\]|\[([^\][\r\n]+)\]/g, (marker, id: string | undefined, label: string | undefined) => {
    const match = id !== undefined ? (ids.has(id) ? id : undefined) : labels.get(label?.trim() ?? '');
    if (!match) return id !== undefined ? '' : marker;
    selected ??= match;
    return '';
  }).trim();
  return selected ? `${clean}[[sticker:${selected}]]` : clean;
};
