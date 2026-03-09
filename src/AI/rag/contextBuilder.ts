import type { ActionCapability } from '../types/action';
import { retrieveRelevantChunks } from './retriever';

export interface RagProfileConfig {
  personal: string;
  speakingStyle: string;
  relation: string;
  banned: string;
  world: string;
}

export interface RagRetrievalConfig {
  enabled: boolean;
  topK: number;
  threshold: number;
  knowledgeBasePath: string;
  embeddingModel: string;
  rerankerModel: string;
}

export interface RuntimeRagConfig {
  profile: RagProfileConfig;
  retrieval: RagRetrievalConfig;
}

export interface BuildRagContextOptions {
  userText: string;
  ragConfig: RuntimeRagConfig;
  capability?: ActionCapability;
  knowledgeText?: string;
}

export interface RagContextResult {
  text: string;
  chunks: Array<{ id: string; text: string; score: number }>;
}

const DEFAULT_RAG_CONFIG: RuntimeRagConfig = {
  profile: {
    personal: '',
    speakingStyle: '',
    relation: '',
    banned: '',
    world: '',
  },
  retrieval: {
    enabled: true,
    topK: 3,
    threshold: 0.6,
    knowledgeBasePath: '',
    embeddingModel: 'bge-m3',
    rerankerModel: 'bge-reranker-v2-m3',
  },
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
};

const asString = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

const asBoolean = (value: unknown, fallback: boolean): boolean => {
  return typeof value === 'boolean' ? value : fallback;
};

const asNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

export const normalizeRuntimeRagConfig = (input: unknown): RuntimeRagConfig => {
  const source = asRecord(input);
  const profileSource = source.profile && typeof source.profile === 'object' ? asRecord(source.profile) : source;
  const retrievalSource = source.retrieval && typeof source.retrieval === 'object' ? asRecord(source.retrieval) : source;

  return {
    profile: {
      personal: asString(profileSource.personal),
      speakingStyle: asString(profileSource.speakingStyle),
      relation: asString(profileSource.relation),
      banned: asString(profileSource.banned || profileSource.mustFollow),
      world: asString(profileSource.world),
    },
    retrieval: {
      enabled: asBoolean(retrievalSource.enabled, DEFAULT_RAG_CONFIG.retrieval.enabled),
      topK: Math.floor(asNumber(retrievalSource.topK, DEFAULT_RAG_CONFIG.retrieval.topK, 1, 8)),
      threshold: asNumber(retrievalSource.threshold, DEFAULT_RAG_CONFIG.retrieval.threshold, 0, 1),
      knowledgeBasePath: asString(retrievalSource.knowledgeBasePath),
      embeddingModel: asString(retrievalSource.embeddingModel) || DEFAULT_RAG_CONFIG.retrieval.embeddingModel,
      rerankerModel: asString(retrievalSource.rerankerModel) || DEFAULT_RAG_CONFIG.retrieval.rerankerModel,
    },
  };
};

const buildCapabilityText = (capability?: ActionCapability): string => {
  if (!capability) return '';
  const lines = [
    `shake_head: ${capability.canShakeHead ? 'available' : 'unavailable'}`,
    `blink: ${capability.canBlink ? 'available' : 'unavailable'}`,
    `mouth: ${capability.canMouth ? 'available' : 'unavailable'}`,
  ];
  return lines.join('\n');
};

const joinSection = (title: string, content: string): string => {
  const text = String(content ?? '').trim();
  if (!text) return '';
  return `[${title}]\n${text}`;
};

export const buildRagContext = (options: BuildRagContextOptions): RagContextResult => {
  const ragConfig = normalizeRuntimeRagConfig(options.ragConfig);
  const sections: string[] = [];

  sections.push(joinSection('角色个性', ragConfig.profile.personal));
  sections.push(joinSection('说话风格', ragConfig.profile.speakingStyle));
  sections.push(joinSection('关系设定', ragConfig.profile.relation));
  sections.push(joinSection('禁忌', ragConfig.profile.banned));
  sections.push(joinSection('世界观', ragConfig.profile.world));
  sections.push(joinSection('动作能力表', buildCapabilityText(options.capability)));

  let chunks: Array<{ id: string; text: string; score: number }> = [];
  if (ragConfig.retrieval.enabled && options.knowledgeText) {
    chunks = retrieveRelevantChunks({
      query: options.userText,
      documentText: options.knowledgeText,
      topK: ragConfig.retrieval.topK,
      threshold: ragConfig.retrieval.threshold,
    });

    if (chunks.length) {
      sections.push([
        '[知识库命中片段]',
        ...chunks.map((chunk, index) => `片段${index + 1}（score=${chunk.score}）\n${chunk.text}`),
      ].join('\n'));
    }
  }

  return {
    text: sections.filter(Boolean).join('\n\n').trim(),
    chunks,
  };
};