import { STAGE_LINES } from '../../../src/app/core/plugin';
import { resolveAddress } from '../directory';
import type { QqTurnInput } from '../turn';

/** Resolve explicit QQ identities, never names or unstructured numbers. */
export const recallProfiles = (input: QqTurnInput): string => {
  const people = new Map<string, { name?: string; roles: Set<string> }>();
  const add = (id: string | undefined, role: string, name?: string) => {
    if (!id) return;
    const person = people.get(id) ?? { name, roles: new Set<string>() };
    person.roles.add(role);
    people.set(id, person);
  };
  add(input.sender?.id, '当前发言人', input.sender?.displayName);
  input.mentions?.forEach((person) => add(person.id, '当前消息被 @ 的人', person.name));
  // Bridge-produced mention tokens also survive archived/quoted text.
  for (const match of input.text.matchAll(/user_id=([1-9][0-9]{4,19})\)/g)) add(match[1], '当前消息提及的人');
  add(input.quote?.speaker?.id, '引用消息的发言人', input.quote?.speaker?.displayName);
  if (input.quote?.available) {
    for (const match of input.quote.text.matchAll(/user_id=([1-9][0-9]{4,19})\)/g)) add(match[1], '引用消息提及的人');
  }
  const profiles = [...people].map(([id, person]) => {
    const record = input.directory.users[id];
    return { id, roles: [...person.roles], nickname: record?.nickname || person.name || '',
      address: resolveAddress(record, input.sceneKey, person.name),
      relationship: id === input.directory.ownerUserId ? (input.ownerRelationship || '与桌面共用，当前阶段不可用') : STAGE_LINES[record?.relationship || '认识'], description: record?.description || '未填写，勿推测' };
  });
  return profiles.length ? '[本轮相关人物档案]\n按 id 区分人物；关系是角色与该人的关系，不代表群友之间的关系。描述为已知的手工人物资料，优先于历史回复中的猜测或“不认识”；根据档案和关系自然回应，不把已认识的人说成陌生人。\n'
    + JSON.stringify(profiles) : '';
};
