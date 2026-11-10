import { describe, expect, it } from 'vitest';
import { normalizeDirectory } from './directory';
import { composeQqTurn } from './turn';

const directory = normalizeDirectory({
  ownerUserId: '2904725137',
  users: {
    '2904725137': {
      nickname: '冰霓',
      defaultAddress: '小霓',
      sceneAddresses: { 'group:30003': '阿霓' },
      relationship: '信赖',
    },
    '2655314552': { nickname: '南柯一梦', defaultAddress: '', relationship: '' },
  },
});

describe('QQ turn composition', () => {
  it('keeps the mention target id and address distinct from the sender', () => {
    const turn = composeQqTurn({
      scenePrompt: '群聊场景',
      ownerRelationship: '阶段：亲近。与桌面共用。',
      directory,
      sceneKey: 'group:30003',
      text: '他是谁',
      sender: { id: '2655314552', displayName: '南柯一梦' },
      mentions: [{ id: '2904725137', name: '冰霓' }],
      quote: { speaker: { id: '10086', displayName: '前人' }, text: '原话', available: true },
    });
    expect(turn.text).toContain('他是谁');
    expect(turn.systemPrompt).toContain('2904725137');
    expect(turn.systemPrompt).toContain('冰霓');
    expect(turn.systemPrompt).toContain('阿霓');
    expect(turn.text).toContain('10086');
    expect(turn.text).toContain('原话');
    expect(turn.text).toContain('不是当前发言人');
    expect(turn.systemPrompt).toContain('群聊场景');
    expect(turn.systemPrompt).toContain('阶段：认识');
    expect(turn.systemPrompt).toContain('[对当前发言人的称呼]\n南柯一梦');
    expect(turn.systemPrompt).toContain('2904725137');
    expect(turn.systemPrompt).toContain('阿霓');
    expect(turn.systemPrompt).not.toContain('原话');
    expect(turn.systemPrompt).toContain('阶段：亲近');
    expect(turn.systemPrompt).not.toContain('阶段：信赖');
  });

  it('uses the shared desktop relationship for the owner, ignoring the manual QQ stage', () => {
    const turn = composeQqTurn({
      scenePrompt: '群聊场景',
      ownerRelationship: '阶段：亲近。与桌面共用。',
      directory,
      sceneKey: 'group:30003',
      text: '我在',
      sender: { id: '2904725137', displayName: '聊天昵称' },
    });
    expect(turn.systemPrompt).toContain('阶段：亲近');
    expect(turn.systemPrompt).toContain('[对当前发言人的称呼]\n阿霓');
    expect(turn.systemPrompt).toContain('与桌面共用');
    expect(turn.systemPrompt).not.toContain('阶段：信赖');
    expect(turn.systemPrompt).not.toContain('主人');
    expect(turn.text).toBe('我在');
  });

  it('leaves an unresolved quote out of the text and out of the instructions', () => {
    const turn = composeQqTurn({
      scenePrompt: '群聊场景',
      ownerRelationship: '阶段：亲近。与桌面共用。',
      directory,
      sceneKey: 'group:30003',
      text: '再看',
      sender: { id: '2655314552' },
      quote: { text: '秘密原文', available: false },
    });
    expect(turn.text).toContain('未能取得');
    expect(turn.text).not.toContain('秘密原文');
    expect(turn.systemPrompt).not.toContain('秘密原文');
    expect(turn.systemPrompt).not.toContain('[引用的先前发言]');
  });
});

it('recalls all three people by id without mixing sender and mentions', () => {
  const users = {
    '281423846': { description: '发起玩笑的群友' },
    '3648487307': { nickname: 'kiri', description: '喜欢音乐' },
    '3584400841': { nickname: '灘間鉄 半拍', description: '喜欢画画' },
    '999999': { description: '不相关的人物' },
  };
  const turn = composeQqTurn({ scenePrompt: '', directory: normalizeDirectory({ users }), sceneKey: 'group:1077396110',
    sender: { id: '281423846' }, text: '@kiri(user_id=3648487307)@灘間鉄 半拍(user_id=3584400841)在一起吧',
    mentions: [{ id: '3648487307' }, { id: '3584400841' }] });
  for (const text of ['281423846', '3648487307', '3584400841', '发起玩笑的群友', '喜欢音乐', '喜欢画画']) expect(turn.systemPrompt).toContain(text);
  expect(turn.systemPrompt).not.toContain('不相关的人物');
  expect(turn.systemPrompt.match(/"id":"3648487307"/g)).toHaveLength(1);
});

// Only the bound user inherits the persona address, regardless of their role in the message.
it.each(['sender', 'mention', 'inline', 'quote'] as const)('uses the persona address for the bound user as %s', (role) => {
  const owner = '2655314552';
  const input = {
    scenePrompt: '', sceneKey: 'group:1077396110', ownerAddress: '主人',
    directory: normalizeDirectory({ ownerUserId: owner, users: {
      [owner]: { nickname: '南柯一梦', defaultAddress: '旧称呼', sceneAddresses: { 'group:1077396110': '旧群称呼' } },
      '2904725137': { nickname: '冰霓', defaultAddress: '崔总' },
    } }),
    sender: { id: role === 'sender' ? owner : '2904725137' },
    text: role === 'sender' ? '我是谁' : role === 'inline' ? '你认识@南柯一梦(user_id=2655314552)吗' : '你认识他吗',
    ...(role === 'mention' ? { mentions: [{ id: owner, name: '南柯一梦' }] } : {}),
    ...(role === 'quote' ? { quote: { speaker: { id: owner }, text: '我是谁', available: true } } : {}),
  };
  const turn = composeQqTurn(input);
  const line = turn.systemPrompt.split('\n').find((text) => text.startsWith('[{"id":'))!;
  const people = JSON.parse(line) as Array<{ id: string; address: string; nickname: string }>;
  expect(people.find((person) => person.id === owner)).toMatchObject({ address: '主人', nickname: '南柯一梦' });
  expect(turn.systemPrompt).toContain(`[对当前发言人的称呼]\n${role === 'sender' ? '主人' : '崔总'}`);
  expect(turn.systemPrompt).toContain('本人问“我是谁”');
  expect(turn.systemPrompt).toContain('别人 @ 此人');
  expect(turn.systemPrompt).not.toContain('"address":"旧称呼"');
  expect(turn.systemPrompt).not.toContain('旧群称呼');
});
