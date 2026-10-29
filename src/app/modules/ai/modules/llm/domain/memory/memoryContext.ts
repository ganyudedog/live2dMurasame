import { recallCoreMemory } from './memoryRetriever';

export interface Persona {
  name: string;
  userAddress: string;
  voice: string;
  examples: string;
  boundaries: string;
  notes: string;
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : {}
);
const asText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const RELATION_HEADING = /^##\s*当前关系\s*$/;
const NEXT_HEADING = /^##\s+\S/;
export const RELATIONSHIP_STAGES = ['认识', '亲近', '信赖', '亲密', '疏远'] as const;
export const DEFAULT_RELATIONSHIP_LINE = '阶段：亲近。可以开玩笑，仍用「你」。还不会主动提起恋爱。';

export const normalizePersona = (value: unknown): Persona => {
  const input = asRecord(value);
  return {
    name: asText(input.name),
    userAddress: asText(input.userAddress),
    voice: asText(input.voice),
    examples: asText(input.examples),
    boundaries: asText(input.boundaries),
    notes: asText(input.notes),
  };
};

const section = (title: string, content: string): string => content ? `[${title}]\n${content}` : '';

export const buildPersonaPrompt = (persona: Persona): string => {
  const parts = [
    section('名字', persona.name),
    section('对用户的称呼', persona.userAddress),
    section('性格与口吻', persona.voice),
    section('示例对话', persona.examples),
    section('边界', persona.boundaries),
    section('补充设定', persona.notes),
  ].filter(Boolean);
  if (!parts.length) return '';
  return [
    '以下角色卡每次回复都要体现。示例对话只示范说话方式，不是本轮输出格式。',
    ...parts,
  ].join('\n\n');
};

export const extractRelationship = (coreText: string): { stageLine: string; memoryText: string } => {
  const lines = String(coreText ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => RELATION_HEADING.test(line.trim()));
  if (start < 0) return { stageLine: '', memoryText: String(coreText ?? '').trim() };
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (NEXT_HEADING.test(lines[index].trim()) && !RELATION_HEADING.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  const bullet = lines.slice(start + 1, end)
    .map((line) => line.match(/^\s*[-*]\s+(.+?)\s*$/u)?.[1]?.trim() ?? '')
    .find(Boolean) ?? '';
  const memoryText = [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { stageLine: bullet, memoryText };
};

export const normalizeStageLine = (bullet: string): string => {
  const text = bullet.trim();
  const name = text.match(/阶段[:：]\s*([^\s。，,]+)/u)?.[1] ?? '';
  if (!RELATIONSHIP_STAGES.includes(name as typeof RELATIONSHIP_STAGES[number])) return DEFAULT_RELATIONSHIP_LINE;
  return text;
};

export const currentRelationshipLine = (coreText: string): string => (
  normalizeStageLine(extractRelationship(coreText).stageLine || DEFAULT_RELATIONSHIP_LINE)
);

export const buildRelationshipPrompt = (stageLine: string): string => [
  '[当前关系]',
  normalizeStageLine(stageLine),
  '关系只依据这一节。不要因为本轮对话自行改变阶段。',
].join('\n');

export const ensureRelationshipSection = (coreText: string): string => {
  const { memoryText } = extractRelationship(coreText);
  const sectionText = `## 当前关系\n- ${currentRelationshipLine(coreText)}`;
  return memoryText ? `${sectionText}\n\n${memoryText}` : sectionText;
};

export const buildMemoryContext = (
  memory: PetModelMemoryState | null,
  episodeRecallText = '',
  query = '',
): string => {
  const rawCore = asText(memory?.coreText);
  const { memoryText } = extractRelationship(rawCore);
  const coreText = recallCoreMemory(memoryText, query, 6000);
  const parts = [
    section('相关核心记忆', coreText),
  ];
  if (episodeRecallText.trim()) parts.push(section('按日期召回的对话片段', episodeRecallText.trim()));
  return parts.filter(Boolean).join('\n\n').trim();
};
