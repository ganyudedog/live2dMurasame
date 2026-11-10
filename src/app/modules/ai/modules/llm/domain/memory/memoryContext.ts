import { recallCoreMemory } from './memoryRetriever';
import { extractRelationship } from '../../../../../../../../shared/memory/relationship.js';

export {
  DEFAULT_RELATIONSHIP_STAGE,
  STAGE_LINES,
  RELATIONSHIP_STAGES,
  extractRelationship,
  isKnownStage,
} from '../../../../../../../../shared/memory/relationship.js';
export type { PublicRelationship, RelationshipStage } from '../../../../../../../../shared/memory/relationship.js';

export { buildRelationshipPrompt, promptLineFromMemory } from './relationshipPrompt';

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
