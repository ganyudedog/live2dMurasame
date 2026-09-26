const isObject = (value) => value && typeof value === 'object';

const selectDependencies = (source, keys) => {
  if (!isObject(source)) throw new TypeError('IPC registrar dependencies must be an object');
  const selected = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key) || source[key] === undefined) {
      throw new Error(`Missing IPC dependency: ${key}`);
    }
    selected[key] = source[key];
  }
  return selected;
};

export const createDependencyAwareRegistrar = (requiredDependencies, register) => {
  const keys = Object.freeze([...requiredDependencies]);
  const registrar = (dependencies) => register(selectDependencies(dependencies, keys));
  registrar.requiredDependencies = keys;
  return registrar;
};
