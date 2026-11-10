import { describe, expect, it } from 'vitest';
import { commitOwnerUserId, normalizeDirectory, resolveAddress, sceneKeyFor, upsertUser } from './directory';

describe('QQ directory', () => {
  const directory = normalizeDirectory({
    ownerUserId: '10001',
    users: {
      '10001': { nickname: '主人号', defaultAddress: '', relationships: { '/character': '亲密' }, sceneAddresses: { private: '家里' } },
      '10002': { nickname: '路人', defaultAddress: '小王', relationships: { '/character': '信赖', '/character:bad': '友好' }, sceneAddresses: { 'group:30003': '群友', 'group:99999': '' } },
      '10003': { nickname: '分歧', relationships: { '/one': '信赖', '/two': '亲密' } },
      '10004': { relationship: '亲近', relationships: { '/one': '亲密', '/two': '疏远' } },
      abc: { nickname: '不是 QQ' },
    },
  });

  it('keeps a partial owner draft until an explicit valid save', () => {
    expect(commitOwnerUserId('1')).toBeNull();
    expect(commitOwnerUserId('1000')).toBeNull();
    expect(commitOwnerUserId('012345')).toBeNull();
    expect(commitOwnerUserId('')).toBe('');
    expect(commitOwnerUserId('  ')).toBe('');
    expect(commitOwnerUserId(' 10002 ')).toBe('10002');
  });

  it('migrates one stored stage and keeps disagreeing stages unused', () => {
    expect(directory.ownerUserId).toBe('10001');
    expect(directory.users.abc).toBeUndefined();
    expect(directory.users['10001'].relationship).toBe('亲密');
    expect(directory.users['10001'].legacyRelationships).toBeUndefined();
    expect(directory.users['10002'].relationship).toBe('信赖');
    expect(directory.users['10002'].legacyRelationships).toBeUndefined();
    expect(directory.users['10003'].relationship).toBe('');
    expect(directory.users['10003'].legacyRelationships).toEqual({ '/one': '信赖', '/two': '亲密' });
    expect(directory.users['10004'].relationship).toBe('亲近');
    expect(directory.users['10004'].legacyRelationships).toBeUndefined();
    expect(upsertUser(directory, '不是号码')).toBe(directory);
  });

  it('resolves an address from the scene, then the person, then the nickname', () => {
    expect(sceneKeyFor('qq.group', 'episode/30003')).toBe('group:30003');
    expect(sceneKeyFor('qq.private', 'episode/user/10001')).toBe('private');
    const owner = directory.users['10001'];
    expect(resolveAddress(owner, 'private', '聊天昵称')).toBe('家里');
    expect(resolveAddress({ ...owner, sceneAddresses: {} }, 'group:30003', '聊天昵称')).toBe('主人号');
    const member = directory.users['10002'];
    expect(resolveAddress(member, 'group:30003', '聊天昵称')).toBe('群友');
    expect(resolveAddress({ ...member, sceneAddresses: {} }, 'group:30003', '聊天昵称')).toBe('小王');
    expect(resolveAddress(undefined, 'group:30003', '路人甲')).toBe('路人甲');
    expect(resolveAddress(member, 'group:30004', '聊天昵称')).toBe('小王');
  });
});

it('persists the displayed default relationship and preserves the authored description', () => {
  const directory = normalizeDirectory({ users: { '2904725137': { relationship: '', description: '至高之崔总' } } });
  expect(directory.users['2904725137'].relationship).toBe('认识');
  expect(directory.users['2904725137'].description).toBe('至高之崔总');
});
