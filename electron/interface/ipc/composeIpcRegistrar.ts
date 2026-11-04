const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const createDependencyAwareRegistrar = <TDeps extends object, TResult>(
  requiredDependencies: readonly (keyof TDeps & string)[],
  register: (dependencies: TDeps) => TResult,
) => {
  const keys = Object.freeze([...requiredDependencies]);
  const registrar = (dependencies: TDeps): TResult => {
    if (!isRecord(dependencies)) throw new TypeError('IPC registrar dependencies must be an object');
    const selected = {} as TDeps;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(dependencies, key) || dependencies[key] === undefined) {
        throw new Error(`Missing IPC dependency: ${key}`);
      }
      selected[key] = dependencies[key];
    }
    return register(selected);
  };
  registrar.requiredDependencies = keys;
  return registrar;
};
