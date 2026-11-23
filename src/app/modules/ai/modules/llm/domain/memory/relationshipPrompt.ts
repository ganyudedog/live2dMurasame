import {
  DEFAULT_RELATIONSHIP_STAGE, STAGE_LINES, extractRelationship, stageFromLine, selectionLine,
} from '../../../../../../../../shared/memory/relationship.js';

interface RelationshipBranchLine {
  title?: string;
  text?: string;
}

interface RelationshipMemory {
  coreText?: string;
  relationship?: {
    needsSelection?: boolean;
    legacyText?: string;
    line?: string;
    branches?: RelationshipBranchLine[];
  } | null;
}

const currentRelationshipLine = (coreText: string) => {
  const { stageLine } = extractRelationship(coreText);
  if (!stageLine) return STAGE_LINES[DEFAULT_RELATIONSHIP_STAGE];
  if (!stageFromLine(stageLine)) return selectionLine(stageLine);
  return stageLine;
};

export const promptLineFromMemory = (memory: RelationshipMemory | null | undefined) => {
  const relationship = memory && typeof memory === 'object' ? memory.relationship : null;
  if (relationship && typeof relationship === 'object') {
    if (relationship.needsSelection) return selectionLine(relationship.legacyText || '');
    if (typeof relationship.line === 'string' && relationship.line.trim()) return relationship.line.trim();
  }
  const coreText = memory && typeof memory === 'object' && typeof memory.coreText === 'string' ? memory.coreText : '';
  return currentRelationshipLine(coreText);
};

export const relationshipPromptBody = (memory: RelationshipMemory | null | undefined) => {
  const line = promptLineFromMemory(memory);
  const branches = (memory?.relationship?.branches ?? [])
    .map((branch) => ({
      title: String(branch?.title ?? '').trim(),
      text: String(branch?.text ?? '').trim(),
    }))
    .filter((branch) => branch.title && branch.text);
  if (!branches.length) return line;
  return [
    line,
    '同时成立：',
    ...branches.map((branch) => `- ${branch.title}：${branch.text}`),
    '这些分支不改变上面的阶段。',
  ].join('\n');
};

export const buildRelationshipPrompt = (stageLine?: string) => {
  const line = String(stageLine ?? '').trim() || STAGE_LINES[DEFAULT_RELATIONSHIP_STAGE];
  return [
    '[当前关系]',
    line,
    '关系只依据这一节。不要因为本轮对话自行改变阶段。',
    '再亲密也要遵守角色卡里的边界，不能用亲密代替那些限制。',
  ].join('\n');
};
