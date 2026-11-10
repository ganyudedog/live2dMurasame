import { useEffect, useRef, useState } from 'react';
import {
  EMPTY_DIRECTORY, isSceneKey, normalizeDirectory, removeUser, upsertUser,
  type BridgeDirectory,
} from './directory';
import { sanitizeLogDetail, type PluginLogger, type PluginStorage } from './types';
import { ERROR_NOTICE } from './styles';
import { LoadingCard } from './ui/layout';
import { PeopleEditor } from './ui/PeopleEditor';
export { PeopleEditor } from './ui/PeopleEditor';

export function AstrBotPeopleSection({ storage, logger }: { storage: PluginStorage; logger: PluginLogger }) {
  const [directory, setDirectory] = useState<BridgeDirectory>(EMPTY_DIRECTORY);
  const revision = useRef(0);
  const queue = useRef(Promise.resolve());
  const [saveError, setSaveError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [draftId, setDraftId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [sceneKind, setSceneKind] = useState<'private' | 'group'>('group');
  const [sceneId, setSceneId] = useState('');
  const [sceneAddress, setSceneAddress] = useState('');

  useEffect(() => {
    let active = true;
    const load = () => {
      const version = revision.current;
      void storage.get('directory', EMPTY_DIRECTORY)
        .then((value) => { if (!active || version !== revision.current) return; const normalized = normalizeDirectory(value); setDirectory(normalized); setLoaded(true); if (JSON.stringify(value) !== JSON.stringify(normalized)) void storage.set('directory', normalized).catch((error) => setSaveError(String(error))); })
        .catch((error: unknown) => { logger.error('directory.load.failed', { error: sanitizeLogDetail(error) }); if (active) setLoaded(true); });
    };
    load();
    const stop = storage.subscribe((key) => { if (key === 'directory') load(); });
    return () => { active = false; stop(); };
  }, [storage, logger]);

  const save = (next: BridgeDirectory) => {
    const normalized = normalizeDirectory(next);
    revision.current += 1;
    setDirectory(normalized);
    queue.current = queue.current.then(() => storage.set('directory', normalized)).then(() => setSaveError('')).catch((error: unknown) => { setSaveError(String(error)); logger.error('directory.save.failed', { error: sanitizeLogDetail(error) }); });
  };

  if (!loaded) return <LoadingCard>正在读取 QQ 用户…</LoadingCard>;
  return <div className="space-y-4">{saveError && <p role="alert" className={ERROR_NOTICE}>{saveError}</p>}<PeopleEditor
    directory={directory}
    query={query}
    draftId={draftId}
    selectedId={selectedId}
    sceneKind={sceneKind}
    sceneId={sceneId}
    sceneAddress={sceneAddress}
    onOwner={(ownerUserId) => save({ ...directory, ownerUserId })}
    onPrivateUsers={(allowedPrivateUsers) => save({ ...directory, allowedPrivateUsers })}
    onQuery={setQuery}
    onDraftId={setDraftId}
    onAdd={() => {
      const next = upsertUser(directory, draftId);
      if (next === directory && !directory.users[draftId.trim()]) return;
      save(next);
      setSelectedId(draftId.trim());
      setDraftId('');
    }}
    onSelect={setSelectedId}
    onDelete={(userId) => { save(removeUser(directory, userId)); if (selectedId === userId) setSelectedId(''); }}
    onDescription={(userId, description) => save(editUser(directory, userId, { description }))}
    onNickname={(userId, nickname) => save(editUser(directory, userId, { nickname }))}
    onDefaultAddress={(userId, defaultAddress) => save(editUser(directory, userId, { defaultAddress }))}
    onRelationship={(userId, stage) => {
      const current = directory.users[userId];
      if (!current) return;
      const next = { ...current, relationship: stage };
      delete next.legacyRelationships;
      save({ ...directory, users: { ...directory.users, [userId]: next } });
    }}
    onSceneKind={setSceneKind}
    onSceneId={setSceneId}
    onSceneAddress={setSceneAddress}
    onAddScene={(userId) => {
      const key = sceneKind === 'private' ? 'private' : `group:${sceneId.trim()}`;
      if (!isSceneKey(key) || !sceneAddress.trim()) return;
      const current = directory.users[userId];
      if (!current) return;
      save(editUser(directory, userId, { sceneAddresses: { ...current.sceneAddresses, [key]: sceneAddress.trim() } }));
      setSceneAddress('');
    }}
    onRemoveScene={(userId, key) => {
      const current = directory.users[userId];
      if (!current) return;
      const sceneAddresses = { ...current.sceneAddresses };
      delete sceneAddresses[key];
      save(editUser(directory, userId, { sceneAddresses }));
    }}
  /></div>;
}

const editUser = (directory: BridgeDirectory, userId: string, patch: Partial<BridgeDirectory['users'][string]>): BridgeDirectory => {
  const current = directory.users[userId];
  if (!current) return directory;
  return { ...directory, users: { ...directory.users, [userId]: { ...current, ...patch } } };
};
