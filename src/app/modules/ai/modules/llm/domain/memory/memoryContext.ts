import { recallCoreMemory } from './memoryRetriever';

type Persona = {
  personal: string;
  speakingStyle: string;
  relation: string;
  banned: string;
  world: string;
};

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' ? value as Record<string, unknown> : {}
);
const asText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const normalizePersona = (value: unknown): Persona => {
  const source = asRecord(value);
  const legacy = asRecord(source.profile);
  const input = Object.keys(legacy).length ? legacy : source;
  return {
    personal: asText(input.personal),
    speakingStyle: asText(input.speakingStyle),
    relation: asText(input.relation),
    banned: asText(input.banned || input.mustFollow),
    world: asText(input.world),
  };
};

const section = (title: string, content: string): string => content ? `[${title}]\n${content}` : '';

export const buildMemoryContext = (
  persona: Persona,
  memory: PetModelMemoryState | null,
  episodeRecallText = '',
  query = '',
): string => {
  const rawCore = asText(memory?.coreText);
  const coreText = recallCoreMemory(rawCore, query, 6000);
  const parts = [
    section('角色个性', persona.personal),
    section('说话风格', persona.speakingStyle),
    section('关系设定', persona.relation),
    section('禁忌', persona.banned),
    section('世界观', persona.world),
    section('相关核心记忆', coreText),
  ];
  if (episodeRecallText.trim()) parts.push(section('按日期召回的对话片段', episodeRecallText.trim()));
  return parts.filter(Boolean).join('\n\n').trim();
};
