// Shared relationship vocabulary, IPC data, and memory-text parsing.
export const RELATIONSHIP_STAGES = Object.freeze(['疏远', '认识', '亲近', '信赖', '亲密']);

export const DEFAULT_RELATIONSHIP_STAGE = '亲近';

export const STAGE_LINES = Object.freeze({
  疏远: '阶段：疏远。保持一点距离，先把边界说清楚。',
  认识: '阶段：认识。已经见过面，还不会把心里话都说出来。',
  亲近: '阶段：亲近。可以开玩笑。还不会主动提起恋爱。',
  信赖: '阶段：信赖。可以提起一起经历过的事，也会主动关心。',
  亲密: '阶段：亲密。可以更亲近地说话，但角色卡里的边界仍然有效，亲密不会越过那些界限。',
});

const RELATION_HEADING = /^##\s*当前关系\s*$/;

const NEXT_HEADING = /^#{1,6}\s+\S/;

const STAGE_NAME = /阶段[:：]\s*([^\s。，,、；;]+)/u;

export const isKnownStage = (stage) => RELATIONSHIP_STAGES.includes(stage);

export const stageFromLine = (line) => {
  const name = STAGE_NAME.exec(String(line ?? ''))?.[1] ?? '';
  return isKnownStage(name) ? name : '';
};

export const extractRelationship = (coreText) => {
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
  const stageLine = lines.slice(start + 1, end)
    .map((line) => line.match(/^\s*[-*]\s+(.+?)\s*$/u)?.[1]?.trim() ?? '')
    .find(Boolean) ?? '';
  const memoryText = [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { stageLine, memoryText };
};

export const selectionLine = (legacyText) => {
  const legacy = String(legacyText ?? '').trim();
  if (!legacy) return '阶段待选择。记忆里的旧说明对不上现有阶段。';
  return `阶段待选择。原先的说明仍保留，但不能当作已经确定的阶段：${legacy}`;
};
