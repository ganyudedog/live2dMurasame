import {
  DEFAULT_RELATIONSHIP_STAGE, RELATIONSHIP_STAGES, STAGE_LINES,
  extractRelationship, isKnownStage, stageFromLine, selectionLine,
  type PublicRelationship, type RelationshipStage, type RelationshipProgress, type KnownExperience,
} from '../../../../shared/memory/relationship.js';

export type StoredRelationship = PublicRelationship;
export interface GrowthThreshold {
  minInteractionDays: number;
  minExperiences: number;
  minStageAgeDays: number;
}
interface RelationshipEvidenceTurn {
  conversationCount: number;
  userText: string;
}
interface RelationshipEvidence {
  priorMemory?: string;
  priorTurns?: RelationshipEvidenceTurn[];
  candidateTurns?: RelationshipEvidenceTurn[];
}
interface ManualAdjustment {
  expectedRevision?: number;
  stage?: string;
  conversationCount?: number;
}
const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

// Desktop relationship authority. Episode dates use the same Asia/Shanghai calendar;
// growth days follow that clock so a conversation and its counted day stay together.
const MEMORY_TIME_ZONE = 'Asia/Shanghai';

/** Central thresholds. A stage moves only when all three are met, and only one step. */
const RELATIONSHIP_GROWTH_THRESHOLDS: Readonly<Record<RelationshipStage, GrowthThreshold | null>> = Object.freeze({
  疏远: Object.freeze({ minInteractionDays: 1, minExperiences: 1, minStageAgeDays: 1 }),
  认识: Object.freeze({ minInteractionDays: 3, minExperiences: 2, minStageAgeDays: 2 }),
  亲近: Object.freeze({ minInteractionDays: 5, minExperiences: 3, minStageAgeDays: 3 }),
  信赖: Object.freeze({ minInteractionDays: 7, minExperiences: 4, minStageAgeDays: 4 }),
  亲密: null,
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;
const EXPERIENCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,40})$/;

const GREETING = /^(?:你好|您好|嗨|hi|hello|hey|在吗|早安|晚安|早上好|晚上好|早|嗯+|哦+|啊+|好|好的?|ok|okay)[!！.。~～?？\s]*$/iu;

const MAX_DAYS = 60;
const MAX_EXPERIENCES = 32;
const MAX_PROPOSALS = 8;

class RelationshipRevisionConflict extends Error {
  constructor() {
    super('Relationship revision conflict');
    this.name = 'RelationshipRevisionConflict';
  }
}

const finite = (value: unknown, fallback = Date.now()) => (
  typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
);

const nonNegativeInteger = (value: unknown): number => (
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0
);

const nextStage = (stage: RelationshipStage) => {
  const index = RELATIONSHIP_STAGES.indexOf(stage);
  if (index < 0 || index >= RELATIONSHIP_STAGES.length - 1) return '';
  return RELATIONSHIP_STAGES[index + 1];
};

const memoryCalendarDay = (value: number, timeZone = MEMORY_TIME_ZONE) => {
  const date = new Date(finite(value));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const day = `${read('year')}-${read('month')}-${read('day')}`;
  return DATE.test(day) ? day : '';
};

const dayNumber = (day: string) => {
  const match = DATE_PARTS.exec(String(day ?? ''));
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000;
};

const stageAgeDays = (stageChangedAt: number, now: number) => {
  if (!stageChangedAt) return 0;
  const age = dayNumber(memoryCalendarDay(now)) - dayNumber(memoryCalendarDay(stageChangedAt));
  return Number.isFinite(age) ? Math.max(0, age) : 0;
};

const emptyProgress = (): RelationshipProgress => ({ interactionDays: [], experiences: [] });

const shapeProgress = (value: unknown): RelationshipProgress => {
  const source = asRecord(value);
  const days: string[] = [];
  for (const day of Array.isArray(source.interactionDays) ? source.interactionDays : []) {
    if (typeof day === 'string' && DATE.test(day) && !days.includes(day)) days.push(day);
    if (days.length >= MAX_DAYS) break;
  }
  const experiences: RelationshipProgress['experiences'] = [];
  const seen = new Set();
  for (const item of Array.isArray(source.experiences) ? source.experiences : []) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id : '';
    const summary = typeof item.summary === 'string' ? item.summary.trim().slice(0, 80) : '';
    if (!EXPERIENCE_ID.test(id) || summary.length < 4 || seen.has(id)) continue;
    seen.add(id);
    experiences.push({ id, summary });
    if (experiences.length >= MAX_EXPERIENCES) break;
  }
  return { interactionDays: days, experiences };
};

const shapeKnownExperiences = (value: unknown): KnownExperience[] => {
  const items: KnownExperience[] = [];
  const seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id : '';
    const excerpt = typeof item.excerpt === 'string' ? item.excerpt.trim().slice(0, 80) : '';
    if (!EXPERIENCE_ID.test(id) || excerpt.length < 4 || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, excerpt });
    if (items.length >= MAX_EXPERIENCES) break;
  }
  return items;
};

const shapeRelationship = ({
  stage, revision, stageChangedAt, needsSelection, legacyText, line, progress,
  evidenceAfterCount, knownExperiences,
}: Omit<StoredRelationship, 'version'>): StoredRelationship => ({
  version: 1,
  stage,
  revision,
  stageChangedAt,
  needsSelection,
  legacyText,
  line,
  progress,
  evidenceAfterCount: nonNegativeInteger(evidenceAfterCount),
  knownExperiences: shapeKnownExperiences(knownExperiences),
});

const cloneProgress = (progress: RelationshipProgress) => shapeProgress(progress);

const cloneRelationship = (relationship: StoredRelationship) => shapeRelationship({
  ...relationship,
  progress: cloneProgress(relationship.progress),
  knownExperiences: shapeKnownExperiences(relationship.knownExperiences),
});

export const normalizeStoredRelationship = (input: unknown): StoredRelationship | null => {
  const value = asRecord(input);
  if (value.version !== 1) return null;
  if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 1) return null;
  const needsSelection = Boolean(value.needsSelection);
  const stage = needsSelection ? '' : (isKnownStage(value.stage) ? value.stage : null);
  if (stage === null) return null;
  return shapeRelationship({
    stage,
    revision: value.revision,
    stageChangedAt: Math.max(0, finite(value.stageChangedAt, 0)),
    needsSelection,
    legacyText: typeof value.legacyText === 'string' ? value.legacyText.slice(0, 500) : '',
    line: typeof value.line === 'string' && value.line.trim()
      ? value.line.trim().slice(0, 300)
      : (isKnownStage(stage) ? STAGE_LINES[stage] : ''),
    progress: shapeProgress(value.progress),
    evidenceAfterCount: nonNegativeInteger(value.evidenceAfterCount),
    // Keep only the dedup evidence from old audit records; discard the audit log.
    knownExperiences: shapeKnownExperiences([
      ...(Array.isArray(value.knownExperiences) ? value.knownExperiences : []),
      ...(Array.isArray(value.events) ? value.events : [])
        .filter((event) => event?.kind === 'shared-experience')
        .map((event) => ({ id: event.experienceId, excerpt: event.excerpt })),
    ]),
  });
};

export const migrateRelationship = (coreText: string, now = Date.now()): StoredRelationship => {
  const at = finite(now);
  const { stageLine } = extractRelationship(coreText);
  const base = {
    revision: 1,
    progress: emptyProgress(),
    evidenceAfterCount: 0,
    knownExperiences: [],
  };
  if (!stageLine) {
    return shapeRelationship({
      ...base,
      stage: DEFAULT_RELATIONSHIP_STAGE,
      stageChangedAt: at,
      needsSelection: false,
      legacyText: '',
      line: STAGE_LINES[DEFAULT_RELATIONSHIP_STAGE],
    });
  }
  const stage = stageFromLine(stageLine);
  if (!stage) {
    const legacyText = stageLine.slice(0, 500);
    return shapeRelationship({
      ...base,
      stage: '',
      stageChangedAt: 0,
      needsSelection: true,
      legacyText,
      line: '',
    });
  }
  return shapeRelationship({
    ...base,
    stage,
    stageChangedAt: at,
    needsSelection: false,
    legacyText: '',
    line: stageLine.slice(0, 300),
  });
};

const relationshipSectionText = (relationship: StoredRelationship) => {
  if (!relationship || relationship.needsSelection) {
    return `## 当前关系\n- ${selectionLine(relationship?.legacyText ?? '')}`;
  }
  const line = relationship.line?.trim() || (isKnownStage(relationship.stage) ? STAGE_LINES[relationship.stage] : STAGE_LINES[DEFAULT_RELATIONSHIP_STAGE]);
  return `## 当前关系\n- ${line}`;
};

export const composeRelationshipCore = (coreText: string, relationship: StoredRelationship) => {
  const body = extractRelationship(coreText).memoryText.trim();
  const section = relationshipSectionText(relationship);
  return body ? `${section}\n\n${body}\n` : `${section}\n`;
};

export const isMeaningfulDesktopExchange = (userText: unknown, assistantText: unknown) => {
  const user = String(userText ?? '').trim();
  const assistant = String(assistantText ?? '').trim();
  if (assistant.length < 1 || user.length < 4) return false;
  return !GREETING.test(user);
};

export const toPublicRelationship = (value: unknown): PublicRelationship | null => {
  const relationship = normalizeStoredRelationship(value);
  if (!relationship) return null;
  return {
    version: 1,
    stage: relationship.stage,
    revision: relationship.revision,
    stageChangedAt: relationship.stageChangedAt,
    needsSelection: relationship.needsSelection,
    legacyText: relationship.legacyText,
    line: relationship.line,
    progress: cloneProgress(relationship.progress),
    evidenceAfterCount: relationship.evidenceAfterCount,
    knownExperiences: shapeKnownExperiences(relationship.knownExperiences),
  };
};

export const recordInteractionDay = (relationship: StoredRelationship, at: number): StoredRelationship => {
  if (!relationship || relationship.needsSelection || !isKnownStage(relationship.stage)) return relationship;
  const day = memoryCalendarDay(at);
  if (!day || relationship.progress.interactionDays.includes(day)) return relationship;
  const next = cloneRelationship(relationship);
  next.progress.interactionDays = [...next.progress.interactionDays, day].slice(-MAX_DAYS);
  next.revision += 1;
  return next;
};

const cleanEvidenceLine = (line: string) => String(line ?? '').trim().replace(/^[-*]\s+/, '').trim();

const evidenceLines = (text: string) => String(text ?? '').split(/\r?\n/).map(cleanEvidenceLine).filter((line) => line.length >= 4);

const boundedExcerpt = (line: string, summary: string) => {
  if (line.length <= 80) return line;
  const index = Math.max(0, line.indexOf(summary));
  const start = Math.max(0, Math.min(index, line.length - 80));
  return line.slice(start, start + 80);
};

const stableExperienceId = (excerpt: string) => {
  let hash = 2166136261;
  for (const char of excerpt) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return `e${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const sharesSpan = (left: string, right: string) => {
  const a = cleanEvidenceLine(left);
  const b = cleanEvidenceLine(right);
  if (a.length < 4 || b.length < 4) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  for (let size = shorter.length; size >= 4; size -= 1) {
    for (let index = 0; index + size <= shorter.length; index += 1) {
      if (longer.includes(shorter.slice(index, index + size))) return true;
    }
  }
  return false;
};

const asEvidenceTurn = (input: unknown): RelationshipEvidenceTurn | null => {
  const value = asRecord(input);
  const conversationCount = typeof value.conversationCount === 'number' && Number.isInteger(value.conversationCount) && value.conversationCount > 0 ? value.conversationCount : 0;
  const userText = typeof value.userText === 'string' ? value.userText.trim() : '';
  if (!conversationCount || userText.length < 4) return null;
  return {
    conversationCount,
    userText,
  };
};

const recordedExperiences = (relationship: StoredRelationship) => [
  ...(relationship.knownExperiences ?? []),
  ...relationship.progress.experiences.map((item) => ({ id: item.id, excerpt: item.summary })),
];

const locateExperience = (relationship: StoredRelationship, summary: string, evidence: RelationshipEvidence) => {
  const priorMemory = extractRelationship(String(evidence?.priorMemory ?? '')).memoryText;
  const priorTurns = (Array.isArray(evidence?.priorTurns) ? evidence.priorTurns : []).map(asEvidenceTurn).filter((turn): turn is RelationshipEvidenceTurn => turn !== null);
  const floor = relationship.evidenceAfterCount || 0;
  const supplied = (Array.isArray(evidence?.candidateTurns) ? evidence.candidateTurns : []).map(asEvidenceTurn).filter((turn): turn is RelationshipEvidenceTurn => turn !== null);
  const candidates = supplied.filter((turn) => turn.conversationCount > floor)
    .sort((left, right) => left.conversationCount - right.conversationCount);
  for (const turn of candidates) {
    if (!turn.userText.includes(summary)) continue;
    const prior = [
      priorMemory,
      ...priorTurns.filter((item) => item.conversationCount < turn.conversationCount).map((item) => item.userText),
    ].filter(Boolean).join('\n');
    const line = evidenceLines(prior).find((item) => item.includes(summary));
    if (!line) {
      continue;
    }
    const excerpt = boundedExcerpt(line, summary);
    if (recordedExperiences(relationship).some((item) => sharesSpan(item.excerpt, summary) || sharesSpan(item.excerpt, excerpt))) {
      return null;
    }
    return {
      id: stableExperienceId(excerpt),
      excerpt,
    };
  }
  return null;
};

export const acceptRelationshipProposals = (relationship: StoredRelationship, proposals: unknown, evidence: RelationshipEvidence = {}): StoredRelationship => {
  if (!relationship || relationship.needsSelection || !isKnownStage(relationship.stage)) return relationship;
  let next = relationship;
  for (const proposal of Array.isArray(proposals) ? proposals.slice(0, MAX_PROPOSALS) : []) {
    if (!proposal || proposal.kind !== 'shared-experience' || 'stage' in proposal || 'mode' in proposal) continue;
    const summary = typeof proposal.summary === 'string' ? proposal.summary.trim() : '';
    if (summary.length < 4 || summary.length > 80) continue;
    const located = locateExperience(next, summary, evidence);
    if (!located) continue;
    next = cloneRelationship(next);
    next.progress.experiences = [...next.progress.experiences, { id: located.id, summary }].slice(-MAX_EXPERIENCES);
    next.knownExperiences = shapeKnownExperiences([...next.knownExperiences, located]);
    next.revision += 1;
  }
  return next;
};

export const evaluateRelationshipGrowth = (relationship: StoredRelationship, now = Date.now(), thresholds: Readonly<Record<string, GrowthThreshold | null>> = RELATIONSHIP_GROWTH_THRESHOLDS, evidenceCursor?: number): StoredRelationship => {
  if (!relationship || relationship.needsSelection || !isKnownStage(relationship.stage)) {
    return relationship;
  }
  const rule = thresholds?.[relationship.stage];
  if (!rule) return relationship;
  const age = stageAgeDays(relationship.stageChangedAt, now);
  if (relationship.progress.interactionDays.length < rule.minInteractionDays) return relationship;
  if (relationship.progress.experiences.length < rule.minExperiences) return relationship;
  if (age < rule.minStageAgeDays) return relationship;
  const stage = nextStage(relationship.stage);
  if (!stage) return relationship;
  const next = cloneRelationship(relationship);
  const cursor = typeof evidenceCursor === 'number' && Number.isInteger(evidenceCursor) && evidenceCursor >= 0 ? evidenceCursor : relationship.evidenceAfterCount;
  next.stage = stage;
  next.line = STAGE_LINES[stage];
  next.stageChangedAt = finite(now);
  next.progress = emptyProgress();
  next.evidenceAfterCount = Math.max(relationship.evidenceAfterCount, cursor);
  next.revision += 1;
  return next;
};

export const applyManualAdjustment = (relationship: StoredRelationship, input: ManualAdjustment, now = Date.now()): { relationship: StoredRelationship; changed: boolean } => {
  const source = input && typeof input === 'object' ? input : {};
  if (!relationship || !Number.isInteger(source.expectedRevision) || source.expectedRevision !== relationship.revision) {
    throw new RelationshipRevisionConflict();
  }
  if (!isKnownStage(source.stage)) throw new Error('Unknown relationship stage');
  if (relationship.stage === source.stage && !relationship.needsSelection) {
    return { relationship, changed: false };
  }
  const next = cloneRelationship(relationship);
  const cursor = typeof source.conversationCount === 'number' && Number.isInteger(source.conversationCount) && source.conversationCount >= 0
    ? source.conversationCount
    : relationship.evidenceAfterCount;
  next.stage = source.stage;
  next.needsSelection = false;
  next.legacyText = '';
  next.line = STAGE_LINES[source.stage];
  next.stageChangedAt = finite(now);
  next.progress = emptyProgress();
  next.evidenceAfterCount = Math.max(relationship.evidenceAfterCount, cursor);
  next.revision += 1;
  return { relationship: next, changed: true };
};
