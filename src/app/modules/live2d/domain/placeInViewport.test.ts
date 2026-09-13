import { expect, it } from 'vitest';
import { calculateLive2dLayout } from '../../../../../shared/live2dLayout.js';
import { placeInViewport } from './placeInViewport';

it('keeps guide, model and side zones at the anchor even in a narrow viewport', () => {
  const target = calculateLive2dLayout({ baseWidth: 400, baseHeight: 800, scale: 0.5 });
  const actual = placeInViewport(target, 500, 900, -100);
  expect(actual.centerX).toBe(-100);
  expect(actual.model.x + actual.model.width / 2).toBe(actual.centerX);
  expect(actual.left.x + actual.left.width).toBe(actual.model.x);
  expect(actual.right.x).toBe(actual.model.x + actual.model.width);
  expect(actual.model.y + actual.model.height).toBe(860);
});
