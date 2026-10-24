import type { Stage2LLMRequest } from '../types';

export const speakerText = (text: string, sender?: PetMemoryTurn['sender']): string =>
  sender ? `[发送者 ${JSON.stringify(sender)}]\n${text}` : text;

/** One shared budget for desktop and plugins; drop oldest complete turns, never reorder by similarity. */
export const buildRecentConversation = (input: PetMemoryTurn[], maxChars = 24000) => {
  const turns: PetMemoryTurn[] = [];
  let chars = 0;
  for (const turn of input.slice(-10).reverse()) {
    const size = speakerText(turn.userText, turn.sender).length + turn.assistantText.length;
    if (chars + size > maxChars) break;
    turns.unshift(turn);
    chars += size;
  }
  const historyMessages: NonNullable<Stage2LLMRequest['historyMessages']> = turns.flatMap((turn) => [
    { role: 'user' as const, content: speakerText(turn.userText, turn.sender) },
    { role: 'assistant' as const, content: turn.assistantText },
  ]);
  return { turns, historyMessages, omittedTurns: input.length - turns.length };
};

/** Both callers pass turns from the same archive, so date/count identifies duplicated hits. */
export const distinctRecallText = (
  recall: { text: string; matches?: Array<Pick<PetMemoryTurn, 'date' | 'time' | 'conversationCount' | 'userText' | 'assistantText'>> } | undefined,
  recent: PetMemoryTurn[],
): string => {
  if (!recall?.matches) return recall?.text ?? '';
  return recall.matches.filter((hit) => !recent.some((turn) => turn.date === hit.date && turn.conversationCount === hit.conversationCount))
    .map((hit) => `【${hit.date} ${hit.time}】\n用户：${hit.userText}\n角色：${hit.assistantText}`).join('\n\n');
};
