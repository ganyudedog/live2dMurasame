import { expect, it } from 'vitest';
import { stickerPrompt } from './prompt';
it('offers only configured favorites, with an explicit no-sticker option', () => {
  expect(stickerPrompt(undefined)).toBe('');
  expect(stickerPrompt([{ id: 'bad', description: 'x', sendWhen: 'y' }])).toBe('');
  const prompt = stickerPrompt([{ id: '0123456789abcdef', description: '开心猫猫', sendWhen: '祝贺群友时' }]);
  expect(prompt).toContain('开心猫猫');
  expect(prompt).not.toContain('sendWhen');
  expect(prompt).toContain('没有合适的就不发送');
});
