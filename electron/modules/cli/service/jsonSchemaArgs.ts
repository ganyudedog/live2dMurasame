const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const matches = (spec: unknown, value: unknown): boolean => {
  if (!isRecord(spec) || typeof spec.type !== 'string') return true;
  if (spec.type === 'string') return typeof value === 'string';
  if (spec.type === 'boolean') return typeof value === 'boolean';
  if (spec.type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (spec.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (spec.type === 'object') return isRecord(value);
  if (spec.type === 'array') return Array.isArray(value);
  return true;
};

/** 校验外部命令声明的 object schema。只覆盖 agent loop 会提交的普通参数。 */
export const parseJsonSchemaArgs = (schema: Record<string, unknown>, value: unknown): Record<string, unknown> => {
  if (schema.type !== 'object') throw new Error('Command parameters must be an object schema');
  if (!isRecord(value)) throw new Error('Tool arguments must be an object');
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
  for (const key of required) {
    if (value[key] === undefined) throw new Error(`Missing argument: ${key}`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) throw new Error(`Unexpected argument: ${key}`);
    }
  }
  for (const [key, spec] of Object.entries(properties)) {
    if (value[key] !== undefined && !matches(spec, value[key])) throw new Error(`Invalid argument: ${key}`);
  }
  return value;
};
