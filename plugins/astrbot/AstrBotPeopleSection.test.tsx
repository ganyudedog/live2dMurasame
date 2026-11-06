import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { PeopleEditor } from './AstrBotPeopleSection';
import type { BridgeDirectory } from './directory';

const directory: BridgeDirectory = {
  ownerUserId: '10001',
  users: {
    '10001': { userId: '10001', nickname: '主人号', defaultAddress: '', sceneAddresses: {}, relationship: '亲密' },
    '10002': { userId: '10002', nickname: '路人', defaultAddress: '小王', sceneAddresses: { 'group:30003': '群友' }, relationship: '' },
    '10003': {
      userId: '10003', nickname: '分歧', defaultAddress: '', sceneAddresses: {}, relationship: '',
      legacyRelationships: { '/one': '信赖', '/two': '亲密' },
    },
  },
};

const render = (selectedId: string) => renderToStaticMarkup(
  <PeopleEditor
    directory={directory}
    query="" draftId="" selectedId={selectedId} sceneKind="group" sceneId="" sceneAddress=""
    onOwner={vi.fn()} onQuery={vi.fn()} onDraftId={vi.fn()} onAdd={vi.fn()} onSelect={vi.fn()} onDelete={vi.fn()}
    onNickname={vi.fn()} onDefaultAddress={vi.fn()} onRelationship={vi.fn()} onSceneKind={vi.fn()} onSceneId={vi.fn()}
    onSceneAddress={vi.fn()} onAddScene={vi.fn()} onRemoveScene={vi.fn()}
  />,
).replaceAll('<!-- -->', '');

it('shows the owner binding and an independent QQ relationship', () => {
  const html = render('10001');
  expect(html).toContain('主人 QQ');
  expect(html).toContain('value="10001"');
  expect(html).toContain('aria-label="保存主人 QQ"');
  expect(html).toContain('不会自动同步桌面角色的关系');
  expect(html).toContain('aria-label="关系阶段"');
  expect(html).toContain('亲密');
  expect(html).toContain('不会跟随桌面角色');
  expect(html).not.toContain('跟随桌面记忆');
  expect(html).not.toContain('/character');
});

it('lets another person edit a QQ relationship and a scene address', () => {
  const html = render('10002');
  expect(html).toContain('aria-label="关系阶段"');
  expect(html).toContain('认识');
  expect(html).toContain('群友');
  expect(html).not.toContain('跟随桌面记忆');
});

it('keeps disagreeing legacy stages out of the relationship control', () => {
  const html = render('10003');
  expect(html).toContain('已保留但不会自动选用');
  expect(html).toContain('未选择');
  expect(html).not.toContain('/one');
  expect(html).not.toContain('/two');
});
