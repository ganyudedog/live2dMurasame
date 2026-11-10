export const DEFAULT_RELATIONSHIP_STAGE: RelationshipStage;
export const RELATIONSHIP_STAGES: readonly ['疏远', '认识', '亲近', '信赖', '亲密'];
export const STAGE_LINES: Readonly<Record<'疏远' | '认识' | '亲近' | '信赖' | '亲密', string>>;

export type RelationshipStage = '疏远' | '认识' | '亲近' | '信赖' | '亲密';

export interface RelationshipExperience {
  id: string;
  summary: string;
}

export interface RelationshipProgress {
  interactionDays: string[];
  experiences: RelationshipExperience[];
}

export interface KnownExperience {
  id: string;
  excerpt: string;
}

export interface PublicRelationship {
  version: 1;
  stage: RelationshipStage | '';
  revision: number;
  stageChangedAt: number;
  needsSelection: boolean;
  legacyText: string;
  line: string;
  progress: RelationshipProgress;
  evidenceAfterCount: number;
  knownExperiences: KnownExperience[];
}

export function isKnownStage(stage: unknown): stage is RelationshipStage;
export function stageFromLine(line: string): RelationshipStage | '';
export function extractRelationship(coreText: string): { stageLine: string; memoryText: string };
export function selectionLine(legacyText?: string): string;
