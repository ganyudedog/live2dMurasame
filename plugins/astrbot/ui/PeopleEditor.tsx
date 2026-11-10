import { useMemo, useState } from 'react';
import { Crown, Plus, Search, Trash, UserRound, Users, X } from 'lucide-react';
import { RELATIONSHIP_STAGE_NAMES, commitOwnerUserId, type BridgeDirectory, type RelationshipStageName } from '../directory';
import { BUTTON, GHOST_BUTTON, GHOST_BUTTON_XS, HINT, INPUT, LABEL, PRIMARY_BUTTON, SELECT, TEXTAREA } from '../styles';
import { Section } from './layout';

const sceneLabel = (key: string) => key === 'private' ? '私聊' : key.startsWith('group:') ? `群 ${key.slice('group:'.length)}` : key;

const initialOf = (text: string) => Array.from(text.trim())[0] ?? '#';

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
      <input className={`${INPUT} w-full font-mono font-normal`} value={draft}
        inputMode="numeric" aria-label="主人 QQ" placeholder="留空表示不绑定" aria-invalid={invalid}
        onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
        onKeyDown={(event) => { if (event.key === 'Enter') save(); }} />
      <button type="button" className={BUTTON} aria-label="保存主人 QQ" onClick={save}>保存</button>
    </span>
    {invalid ? <span role="alert" className="text-[11px] font-normal text-warning">QQ 号为 5 到 20 位数字且不能以 0 开头，这次没有保存。</span> : null}
  </label>;
}

export function PeopleEditor({
  directory, query, draftId, selectedId, sceneKind, sceneId, sceneAddress,
  onOwner, onQuery, onDraftId, onAdd, onSelect, onDelete, onNickname, onDescription, onDefaultAddress, onRelationship,
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
  onDescription?: (userId: string, description: string) => void;
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
  const hasUsers = Object.keys(directory.users).length > 0;
  return <>
    <Section icon={<Crown />} title="主人" description="主人 QQ 只能在这里绑定，不会从聊天记录推断。">
      <OwnerQQField key={directory.ownerUserId} ownerUserId={directory.ownerUserId} onOwner={onOwner} />
    </Section>

    <Section icon={<Users />} title="QQ 用户"
      description="主人 QQ 与桌面共用关系成长；其他人的关系仅在这里手动配置，未设置时按认识。称呼顺序：这个场景的称呼、个人默认称呼、昵称。">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="relative block">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input className={`${INPUT} w-full pl-8`} value={query} aria-label="搜索 QQ 用户" placeholder="搜索 QQ 号或昵称"
              onChange={(event) => onQuery(event.target.value)} />
          </span>
          <div className="ui-scroll flex max-h-80 min-h-24 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border p-1">
            {users.length === 0
              ? <p className={`px-2 py-6 text-center ${HINT}`}>{hasUsers ? '没有匹配的用户。' : '还没有手动添加的用户。'}</p>
              : users.map((user) => {
                const active = user.userId === selectedId;
                const owner = user.userId === directory.ownerUserId;
                return <button key={user.userId} type="button" aria-current={active ? 'true' : undefined}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${active
                    ? 'bg-primary/10' : 'hover:bg-muted'}`}
                  onClick={() => onSelect(user.userId)}>
                  <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${active
                    ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                    {initialOf(user.nickname || user.userId)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-xs ${active ? 'font-medium text-primary' : 'text-foreground'}`}>
                      {user.nickname || user.userId}
                    </span>
                    {user.nickname ? <span className="block truncate font-mono text-[10px] text-muted-foreground">{user.userId}</span> : null}
                  </span>
                  {owner ? <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-px text-[10px] text-warning">
                    <Crown aria-hidden="true" className="size-2.5" />主人
                  </span> : null}
                </button>;
              })}
          </div>
          <div className="flex items-center gap-2">
            <input className={`${INPUT} w-full font-mono`} value={draftId} inputMode="numeric" aria-label="添加 QQ" placeholder="输入 QQ 号添加"
              onChange={(event) => onDraftId(event.target.value.trim())}
              onKeyDown={(event) => { if (event.key === 'Enter') onAdd(); }} />
            <button type="button" className={PRIMARY_BUTTON} onClick={onAdd}><Plus aria-hidden="true" />添加</button>
          </div>
        </div>

        {selected ? <div className="min-w-0 space-y-4 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/12 text-sm
              font-semibold text-primary">
              {initialOf(selected.nickname || selected.userId)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{selected.nickname || '未填写昵称'}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">QQ {selected.userId}</p>
            </div>
            <button type="button" className={`${GHOST_BUTTON} text-danger hover:bg-danger/10 hover:text-danger`}
              onClick={() => onDelete(selected.userId)}>
              <Trash aria-hidden="true" />删除这个用户
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <label className={`flex flex-col gap-1.5 sm:col-span-2 ${LABEL}`}>
              QQ 关系
              {selected.userId === directory.ownerUserId ? <p className={`font-normal ${HINT}`}>与桌面共用关系和成长，请在角色关系页查看或调整。</p> : <>
              <select className={`${SELECT} w-full font-normal sm:max-w-[calc(50%-0.5rem)]`} aria-label="关系阶段"
                value={relationshipUnset ? '' : (selected.relationship || '认识')}
                onChange={(event) => {
                  const stage = event.target.value;
                  if (!(RELATIONSHIP_STAGE_NAMES as readonly string[]).includes(stage)) return;
                  onRelationship(selected.userId, stage as RelationshipStageName);
                }}>
                {relationshipUnset ? <option value="">未选择</option> : null}
                {RELATIONSHIP_STAGE_NAMES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
              </select>
              <span className={`font-normal ${HINT}`}>仅手动配置，不参与自动成长。</span></>}
              {legacy.length > 0 ? <span role="status" className="text-[11px] font-normal text-warning">旧的按角色关系阶段不一致，已保留但不会自动选用，也不会同步桌面。</span> : null}
            </label>
            <label className={`flex flex-col gap-1.5 sm:col-span-2 ${LABEL}`}>
              人物描述
              <textarea className={`${TEXTAREA} min-h-24 w-full font-normal`} value={selected.description ?? ''}
                maxLength={2000} aria-label="人物描述" placeholder="手动填写性格、爱好、身份及与其他群友的关系；按 QQ 号召回。"
                onChange={(event) => onDescription?.(selected.userId, event.target.value)} />
            </label>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <span className={LABEL}>场景称呼</span>
            {Object.keys(selected.sceneAddresses).length ? <div className="flex flex-wrap gap-1.5">
              {Object.entries(selected.sceneAddresses).map(([key, address]) => (
                <span key={key} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-0.5 pl-2.5 text-xs">
                  <span className="text-[11px] text-muted-foreground">{sceneLabel(key)}</span>
                  <span className="text-foreground">{address}</span>
                  <button type="button" className={`${GHOST_BUTTON_XS} size-5 rounded-full px-0 hover:text-danger`}
                    aria-label={`删除${sceneLabel(key)}的称呼`} title="删除" onClick={() => onRemoveScene(selected.userId, key)}>
                    <X aria-hidden="true" className="size-3" />
                  </button>
                </span>
              ))}
            </div> : <p className={HINT}>还没有按场景设置的称呼。</p>}
            <div className="flex flex-wrap items-center gap-2">
              <select className={SELECT} aria-label="场景类型" value={sceneKind} onChange={(event) => onSceneKind(event.target.value as 'private' | 'group')}>
                <option value="group">群</option>
                <option value="private">私聊</option>
              </select>
              {sceneKind === 'group' ? <input className={`${INPUT} w-32 font-mono`} aria-label="群号" placeholder="群号" value={sceneId} onChange={(event) => onSceneId(event.target.value)} /> : null}
              <input className={`${INPUT} w-40`} aria-label="场景称呼" placeholder="场景称呼" value={sceneAddress} onChange={(event) => onSceneAddress(event.target.value)} />
              <button type="button" className={BUTTON} onClick={() => onAddScene(selected.userId)}><Plus aria-hidden="true" />添加场景</button>
            </div>
          </div>
        </div> : <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed
          border-border px-4 text-center">
          <UserRound aria-hidden="true" className="size-5 text-muted-foreground/60" />
          <p className={HINT}>选择左侧的用户，编辑昵称、称呼和关系。</p>
        </div>}
      </div>
    </Section>
  </>;
}
