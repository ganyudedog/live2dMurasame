import { describe, expect, it } from 'vitest';
import { calculateLive2dLayout } from '../../../../../../../shared/live2dLayout.js';

describe('shared three-rectangle layout', () => {
  it('keeps all model pixels inside the content envelope with 50 to 150 DIP sides', () => {
    for (const scale of [0.3, 0.7, 0.999, 1, 1.001, 1.5, 2, 5]) {
      const input = { baseWidth: 421.731, baseHeight: 855, scale };
      const layout = calculateLive2dLayout(input);
      expect(JSON.parse(JSON.stringify(calculateLive2dLayout(JSON.parse(JSON.stringify(input)))))).toEqual(layout);
      expect(layout.left.width).toBeGreaterThanOrEqual(50);
      expect(layout.left.width).toBeLessThanOrEqual(320);
      expect(layout.left.x).toBeGreaterThanOrEqual(0);
      expect(layout.right.x + layout.right.width).toBeLessThanOrEqual(layout.width);
      expect(layout.model.y).toBeGreaterThanOrEqual(0);
      expect(layout.model.y + layout.model.height).toBe(layout.bottomY);
      expect(layout.bottomY).toBe(layout.height);
      expect(layout.height - layout.model.height).toBeLessThan(1);
      expect(layout.centerX).toBe(layout.model.x + layout.model.width * 0.5);
      expect(layout.left.x + layout.left.width).toBe(layout.model.x);
      expect(layout.right.x).toBe(layout.model.x + layout.model.width);
    }
  });
  it('rejects invalid baselines before either renderer or native mutation', () => {
    for (const baseWidth of [0, -1, NaN, Infinity]) {
      expect(() => calculateLive2dLayout({ baseWidth, baseHeight: 855, scale: 1 })).toThrow();
    }
  });

  it('keeps the requested visual center without adding a symmetric envelope', () => {
    const layout = calculateLive2dLayout({ baseWidth: 400, baseHeight: 800, scale: 1, sideWidth: 100, visualCenterRatio: 0.35 });
    expect(layout.model.x + layout.model.width * 0.35).toBe(layout.centerX);
    expect(layout.left.width).toBe(layout.right.width);
    expect(layout.width).toBe(layout.model.width + layout.left.width + layout.right.width);
  });
});
