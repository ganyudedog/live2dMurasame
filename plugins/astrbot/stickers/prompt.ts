/** Only manually described favorites are exposed; media URLs never enter the LLM prompt. */
export const stickerPrompt = (value: unknown): string => {
  if (!Array.isArray(value)) return '';
  const seen = new Set<string>();
  const choices = value.filter((item): item is { id: string; description: string } => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-f0-9]{16}$/.test(item.id)
      || seen.has(item.id) || typeof item.description !== 'string' || !item.description.trim()) return false;
    seen.add(item.id); return true;
  }).slice(0, 12).map(({ id, description }) => ({ id, description }));
  return choices.length ? '[可选 QQ 收藏表情]\n仅在适合当前语境时，选至多一个。没有合适的就不发送。不要为了发送而硬凑。'
    + '\n若选择，在 display_text 中使用 [图片描述]，例如描述为“恶心”就输出 [恶心]，不要放入 speak_text；不选择则不要添加任何标记。方括号内必须与下面的 description 完全一致，发送端会移除标记，先发正文再发图片。\n'
    + JSON.stringify(choices) : '';
};
