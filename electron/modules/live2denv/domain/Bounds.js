const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export class Bounds {
  constructor({ x, y, width, height }) {
    if (![x, y, width, height].every(isFiniteNumber) || width <= 0 || height <= 0) {
      throw new Error('Invalid window bounds');
    }
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.width = Math.round(width);
    this.height = Math.round(height);
    Object.freeze(this);
  }

  toJSON() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }
}

export const tryCreateBounds = (value) => {
  try {
    return value ? new Bounds(value) : null;
  } catch {
    return null;
  }
};
