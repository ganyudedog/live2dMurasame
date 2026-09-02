import { describe, expect, it } from 'vitest';
import { solveModelLayout } from './ModelLayoutSolver';

const localBounds = { x: 0, y: 0, width: 1500, height: 3000 };

describe('solveModelLayout', () => {
  it('keeps the desktop center while a scale resize is still catching up', () => {
    const result = solveModelLayout({
      windowWidth: 484,
      windowHeight: 900,
      scale: 2,
      baselineScreen: 853,
      windowLeft: 611,
      localBounds,
      baseWindowSize: { width: 484, height: 900 },
    });

    expect(result.scaledWidth).toBeGreaterThan(484);
    expect(result.positionX).toBe(242);
    expect(windowCenter(611, result.positionX)).toBe(853);
  });

  it('still enforces margins when the model fits', () => {
    const result = solveModelLayout({
      windowWidth: 800,
      windowHeight: 900,
      scale: 1,
      baselineScreen: 620,
      windowLeft: 100,
      localBounds,
      baseWindowSize: { width: 800, height: 900 },
    });

    expect(result.positionX).toBeLessThanOrEqual(800 - 40 - result.scaledWidth / 2);
  });
});

const windowCenter = (windowLeft: number, modelLocalX: number): number => windowLeft + modelLocalX;
