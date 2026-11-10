import { RELATIONSHIP_STAGES } from '../../src/app/core/plugin';
/** QQ user ids stay strings. Binding is explicit; chat text never creates one. */
export const isQqUserId = (value: string): boolean => /^[1-9][0-9]{4,19}$/.test(value);

/** Empty clears the binding. A partial number stays uncommitted so typing is not wiped. */
export const commitOwnerUserId = (draft: string): string | null => {
  const ownerUserId = draft.trim();
  if (ownerUserId === '') return '';
  return isQqUserId(ownerUserId) ? ownerUserId : null;
};

export const RELATIONSHIP_STAGE_NAMES = RELATIONSHIP_STAGES;
export type RelationshipStageName = typeof RELATIONSHIP_STAGE_NAMES[number];

export interface BridgeUserRecord {
  userId: string;
  nickname: string;
  /** User-authored facts; never inferred from chat. */
  description?: string;
  defaultAddress: string;
  /** `private` or `group:<id>`. */
  sceneAddresses: Record<string, string>;
  /** QQ relationship configured in this plugin. Empty means unset. */
  relationship: RelationshipStageName | '';
  /** Old per-character stages kept only when they disagree. Prompts do not read this map. */
  legacyRelationships?: Record<string, RelationshipStageName>;
}

export interface BridgeDirectory {
  ownerUserId: string;
  users: Record<string, BridgeUserRecord>;
}

export const EMPTY_DIRECTORY: BridgeDirectory = { ownerUserId: '', users: {} };

const MAX_USERS = 200;
const MAX_SCENES = 32;
const MAX_CHARACTERS = 32;
const MAX_TEXT = 80;

export const sceneKeyFor = (source: string, memoryArchive: string): string => {
  if (source === 'qq.private' || memoryArchive.startsWith('episode/user/')) return 'private';
  const id = memoryArchive.split('/').at(-1)?.trim() ?? '';
  return isQqUserId(id) ? `group:${id}` : 'group';
};

export const isSceneKey = (value: string): boolean => value === 'private' || /^group:[1-9][0-9]{4,19}$/.test(value);

export const normalizeDirectory = (value: unknown): BridgeDirectory => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const ownerUserId = typeof raw.ownerUserId === 'string' && isQqUserId(raw.ownerUserId.trim()) ? raw.ownerUserId.trim() : '';
  const usersRaw = raw.users && typeof raw.users === 'object' ? raw.users as Record<string, unknown> : {};
  const users: Record<string, BridgeUserRecord> = {};
  for (const [key, entry] of Object.entries(usersRaw)) {
    if (!isQqUserId(key) || Object.keys(users).length >= MAX_USERS) continue;
    users[key] = normalizeUser(key, entry);
  }
  return { ownerUserId, users };
};

export const upsertUser = (directory: BridgeDirectory, userId: string): BridgeDirectory => {
  const id = userId.trim();
  if (!isQqUserId(id) || directory.users[id]) return directory;
  return normalizeDirectory({
    ...directory,
    users: { ...directory.users, [id]: emptyUser(id) },
  });
};

export const removeUser = (directory: BridgeDirectory, userId: string): BridgeDirectory => {
  if (!directory.users[userId]) return directory;
  const users = { ...directory.users };
  delete users[userId];
  return { ...directory, users };
};

/** All participant roles resolve the same id-to-address mapping for this turn. */
export const resolveAddress = (
  context: { directory: BridgeDirectory; sceneKey: string; ownerAddress?: string },
  userId: string,
  displayName?: string,
): string => {
  const { directory, sceneKey } = context;
  const ownerAddress = context.ownerAddress?.trim();
  if (userId && userId === directory.ownerUserId && ownerAddress) return ownerAddress;
  const record = directory.users[userId];
  const scene = record && isSceneKey(sceneKey) ? record.sceneAddresses[sceneKey]?.trim() ?? '' : '';
  if (scene) return scene;
  const fallback = record?.defaultAddress.trim() ?? '';
  if (fallback) return fallback;
  return record?.nickname.trim() || displayName?.trim() || '';
};

const normalizeUser = (userId: string, value: unknown): BridgeUserRecord => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const settled = settleRelationship(raw);
  return {
    userId,
    nickname: clip(raw.nickname),
    description: typeof raw.description === "string" ? raw.description.slice(0, 2000) : "",
    defaultAddress: clip(raw.defaultAddress),
    sceneAddresses: normalizeScenes(raw.sceneAddresses),
    relationship: settled.relationship,
    ...(settled.legacyRelationships ? { legacyRelationships: settled.legacyRelationships } : {}),
  };
};

const emptyUser = (userId: string): BridgeUserRecord => ({
  userId, nickname: '', defaultAddress: '', sceneAddresses: {}, relationship: '认识',
});

/** One shared stage becomes the plugin relationship. Disagreeing stages stay stored and unused. */
const settleRelationship = (
  raw: Record<string, unknown>,
): { relationship: RelationshipStageName | ''; legacyRelationships?: Record<string, RelationshipStageName> } => {
  const explicit = readStage(raw.relationship);
  const legacy = {
    ...readStageMap(raw.relationships),
    ...readStageMap(raw.legacyRelationships),
  };
  if (explicit) return { relationship: explicit };
  const stages = [...new Set(Object.values(legacy))];
  if (stages.length === 1) return { relationship: stages[0] };
  if (stages.length > 1) return { relationship: '', legacyRelationships: legacy };
  return { relationship: '认识' };
};

const readStage = (value: unknown): RelationshipStageName | '' => {
  const stage = typeof value === 'string' ? value.trim() : '';
  return (RELATIONSHIP_STAGE_NAMES as readonly string[]).includes(stage) ? stage as RelationshipStageName : '';
};

const clip = (value: unknown): string => typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';

const normalizeScenes = (value: unknown): Record<string, string> => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const scenes: Record<string, string> = {};
  for (const [key, entry] of Object.entries(raw)) {
    const address = clip(entry);
    if (!isSceneKey(key) || !address || Object.keys(scenes).length >= MAX_SCENES) continue;
    scenes[key] = address;
  }
  return scenes;
};

const readStageMap = (value: unknown): Record<string, RelationshipStageName> => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const relationships: Record<string, RelationshipStageName> = {};
  for (const [key, entry] of Object.entries(raw)) {
    const characterId = key.trim();
    const stage = readStage(entry);
    if (!characterId || characterId.length > 512 || characterId === '__proto__' || !stage || Object.keys(relationships).length >= MAX_CHARACTERS) continue;
    relationships[characterId] = stage;
  }
  return relationships;
};
