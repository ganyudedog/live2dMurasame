export const clone = <T>(value: T): T => {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
};
