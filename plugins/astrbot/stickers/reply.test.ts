import { expect, it } from 'vitest';
import { mapStickerReply } from './reply';
const choices = [{ id: '0123456789abcdef', description: '恶心' }];
it('removes a matching word from the body and moves its image selection to the end', () => {
  expect(mapStickerReply('给你看看[恶心]。别多想。', choices)).toBe('给你看看。别多想。[[sticker:0123456789abcdef]]');
});
it('keeps unknown words and sends duplicate selections only once', () => {
  expect(mapStickerReply('[开心]', choices)).toBe('[开心]');
  expect(mapStickerReply('[恶心][恶心]', choices)).toBe('[[sticker:0123456789abcdef]]');
  expect(mapStickerReply('[恶心]', [])).toBe('[恶心]');
});
