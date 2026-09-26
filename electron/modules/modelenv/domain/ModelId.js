export class ModelId {
  constructor(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Model id is required');
    this.value = value.trim();
    Object.freeze(this);
  }

  toString() {
    return this.value;
  }
}
