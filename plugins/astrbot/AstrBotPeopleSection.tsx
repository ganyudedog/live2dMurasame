import { useEffect, useMemo, useState } from 'react';
import {
  EMPTY_DIRECTORY, RELATIONSHIP_STAGE_NAMES, commitOwnerUserId, isSceneKey, normalizeDirectory, removeUser, upsertUser,
  type BridgeDirectory, type RelationshipStageName,
} from './directory';
import { sanitizeLogDetail, type PluginLogger, type PluginStorage } from './types';
import { BUTTON, GHOST_BUTTON, GHOST_BUTTON_XS, HINT, INPUT, LABEL, SELECT } from './styles';

export function AstrBotPeopleSection({ storage, logger }: { storage: PluginStorage; logger: PluginLogger }) {
  const [directory, setDirectory] = useState<BridgeDirectory>(EMPTY_DIRECTORY);
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
      void storage.get('directory', EMPTY_DIRECTORY)
        .then((value) => { if (!active) return; setDirectory(normalizeDirectory(value)); setLoaded(true); })
        .catch((error: unknown) => { logger.error('directory.load.failed', { error: sanitizeLogDetail(error) }); if (active) setLoaded(true); });
    };
    load();
    const stop = storage.subscribe((key) => { if (key === 'directory') load(); });
    return () => { active = false; stop(); };
  }, [storage, logger]);

  const save = (next: BridgeDirectory) => {
    const normalized = normalizeDirectory(next);
    setDirectory(normalized);
    void storage.set('directory', normalized).catch((error: unknown) => logger.error('directory.save.failed', { error: sanitizeLogDetail(error) }));
  };

  if (!loaded) return <p className={HINT}>正在读取 QQ 用户…</p>;
  return <PeopleEditor
    directory={directory}
    query={query}
    draftId={draftId}
    selectedId={selectedId}
    sceneKind={sceneKind}
    sceneId={sceneId}
    sceneAddress={sceneAddress}
    onOwner={(ownerUserId) => save({ ...directory, ownerUserId })}
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
  />;
}

function OwnerQQField({ ownerUserId, onOwner }: { ownerUserId: string; onOwner: (ownerUserId: string) => void }) {
  const [draft, setDraft] = useState(ownerUserId);
  const [invalid, setInvalid] = useState(false);
  const save = () => {
    const next = commitOwnerUserId(draft);
    if (next === null) { setInvalid(true); return; }
    setInvalid(false);
    if (next !== ownerUserId) onOwner(next);
  };
  return <label className={`flex max-w-sm flex-col gap-1.5 ${LABEL}`}>
    主人 QQ
    <span className="flex items-center gap-2">
      <input className={`${INPUT} w-full font-mono`} value={draft}
        inputMode="numeric" aria-label="主人 QQ" placeholder="留空表示不绑定" aria-invalid={invalid}
        onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
        onKeyDown={(event) => { if (event.key === 'Enter') save(); }} />
      <button type="button" className={BUTTON} aria-label="保存主人 QQ" onClick={save}>保存</button>
    </span>
    {invalid ? <span role="alert" className="text-[11px] font-normal text-warning">QQ 号为 5 到 20 位数字且不能以 0 开头，这次没有保存。</span> : null}
  </label>;
}

const editUser = (directory: BridgeDirectory, userId: string, patch: Partial<BridgeDirectory['users'][string]>): BridgeDirectory => {
  const current = directory.users[userId];
  if (!current) return directory;
  return { ...directory, users: { ...directory.users, [userId]: { ...current, ...patch } } };
};

export function PeopleEditor({
  directory, query, draftId, selectedId, sceneKind, sceneId, sceneAddress,
  onOwner, onQuery, onDraftId, onAdd, onSelect, onDelete, onNickname, onDefaultAddress, onRelationship,
  onSceneKind, onSceneId, onSceneAddress, onAddScene, onRemoveScene,
}: {
  directory: BridgeDirectory;
  query: string;
  draftId: string;
  selectedId: string;
  sceneKind: 'private' | 'group';
  sceneId: string;
  sceneAddress: string;
  onOwner: (ownerUserId: string) => void;
  onQuery: (value: string) => void;
  onDraftId: (value: string) => void;
  onAdd: () => void;
  onSelect: (userId: string) => void;
  onDelete: (userId: string) => void;
  onNickname: (userId: string, nickname: string) => void;
  onDefaultAddress: (userId: string, address: string) => void;
  onRelationship: (userId: string, stage: RelationshipStageName) => void;
  onSceneKind: (kind: 'private' | 'group') => void;
  onSceneId: (value: string) => void;
  onSceneAddress: (value: string) => void;
  onAddScene: (userId: string) => void;
  onRemoveScene: (userId: string, key: string) => void;
}) {
  const users = useMemo(() => Object.values(directory.users)
    .filter((user) => !query.trim() || user.userId.includes(query.trim()) || user.nickname.includes(query.trim())), [directory.users, query]);
  const selected = directory.users[selectedId];
  const legacy = selected?.legacyRelationships ? Object.keys(selected.legacyRelationships) : [];
  const relationshipUnset = legacy.length > 0 && !selected?.relationship;
  return <section className="flex flex-col gap-4 border-t border-border pt-4">
    <div>
      <h3 className="text-[13px] font-semibold">QQ 用户</h3>
      <p className={`mt-1 ${HINT}`}>
        主人 QQ 只能在这里绑定，不会从聊天记录推断。每个人的 QQ 关系（包括主人）和称呼都在本插件里单独配置，不会自动同步桌面角色的关系。没有单独设置关系时按认识。称呼顺序：这个场景的称呼、个人默认称呼、昵称。
      </p>
    </div>
    <OwnerQQField key={directory.ownerUserId} ownerUserId={directory.ownerUserId} onOwner={onOwner} />
    <div className="flex flex-wrap items-end gap-2">
      <label className={`flex min-w-40 flex-1 flex-col gap-1.5 ${LABEL}`}>
        搜索
        <input className={`${INPUT} w-full font-normal`} value={query} aria-label="搜索 QQ 用户" placeholder="QQ 号或昵称"
          onChange={(event) => onQuery(event.target.value)} />
      </label>
      <label className={`flex w-40 flex-col gap-1.5 ${LABEL}`}>
        添加 QQ
        <input className={`${INPUT} w-full font-mono font-normal`} value={draftId} inputMode="numeric" aria-label="添加 QQ"
          onChange={(event) => onDraftId(event.target.value.trim())}
          onKeyDown={(event) => { if (event.key === 'Enter') onAdd(); }} />
      </label>
      <button type="button" className={BUTTON} onClick={onAdd}>添加</button>
    </div>
    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-1">
      {users.length === 0 ? <p className={`px-2 py-3 text-center ${HINT}`}>还没有手动添加的用户。</p> : users.map((user) => (
        <button key={user.userId} type="button"
          className={`flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-xs transition-colors ${user.userId === selectedId
            ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/80 hover:bg-muted'}`}
          onClick={() => onSelect(user.userId)}>
          {user.userId}{user.nickname ? ` · ${user.nickname}` : ''}{user.userId === directory.ownerUserId ? ' · 主人' : ''}
        </button>
      ))}
    </div>
    {selected ? <div className="grid grid-cols-1 gap-4 rounded-lg bg-muted/50 p-3 sm:grid-cols-2">
      <label className={`flex flex-col gap-1.5 ${LABEL}`}>
        昵称
        <input className={`${INPUT} w-full font-normal`} value={selected.nickname} aria-label="昵称"
          onChange={(event) => onNickname(selected.userId, event.target.value)} />
      </label>
      <label className={`flex flex-col gap-1.5 ${LABEL}`}>
        默认称呼
        <input className={`${INPUT} w-full font-normal`} value={selected.defaultAddress} aria-label="默认称呼"
          onChange={(event) => onDefaultAddress(selected.userId, event.target.value)} />
      </label>
      <label className={`flex flex-col gap-1.5 ${LABEL}`}>
        QQ 关系
        <select className={`${SELECT} w-full font-normal`} aria-label="关系阶段"
          value={relationshipUnset ? '' : (selected.relationship || '认识')}
          onChange={(event) => {
            const stage = event.target.value;
            if (!(RELATIONSHIP_STAGE_NAMES as readonly string[]).includes(stage)) return;
            onRelationship(selected.userId, stage as RelationshipStageName);
          }}>
          {relationshipUnset ? <option value="">未选择</option> : null}
          {RELATIONSHIP_STAGE_NAMES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
        </select>
        <span className={`font-normal ${HINT}`}>在本插件单独配置，不会跟随桌面角色。</span>
        {legacy.length > 0 ? <span role="status" className="text-[11px] font-normal text-warning">旧的按角色关系阶段不一致，已保留但不会自动选用，也不会同步桌面。</span> : null}
      </label>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <span className={LABEL}>场景称呼</span>
        {Object.entries(selected.sceneAddresses).map(([key, address]) => (
          <div key={key} className="flex items-center gap-2 rounded-md bg-card px-2.5 py-1.5 text-xs shadow-card">
            <span className="font-mono text-muted-foreground">{key}</span>
            <span>{address}</span>
            <button type="button" className={`ml-auto ${GHOST_BUTTON_XS} hover:text-danger`} onClick={() => onRemoveScene(selected.userId, key)}>删除</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <select className={SELECT} aria-label="场景类型" value={sceneKind} onChange={(event) => onSceneKind(event.target.value as 'private' | 'group')}>
            <option value="group">群</option>
            <option value="private">私聊</option>
          </select>
          {sceneKind === 'group' ? <input className={`${INPUT} w-32 font-mono`} aria-label="群号" placeholder="群号" value={sceneId} onChange={(event) => onSceneId(event.target.value)} /> : null}
          <input className={`${INPUT} w-40`} aria-label="场景称呼" placeholder="场景称呼" value={sceneAddress} onChange={(event) => onSceneAddress(event.target.value)} />
          <button type="button" className={BUTTON} onClick={() => onAddScene(selected.userId)}>添加场景</button>
        </div>
      </div>
      <button type="button" className={`${GHOST_BUTTON} justify-self-start text-danger hover:text-danger`} onClick={() => onDelete(selected.userId)}>删除这个用户</button>
    </div> : null}
  </section>;
}
