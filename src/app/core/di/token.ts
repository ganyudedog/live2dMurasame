export interface ServiceToken<T> {
  readonly key: symbol;
  readonly name: string;
  readonly __type?: T;
}

export const createServiceToken = <T>(name: string): ServiceToken<T> => ({
  key: Symbol(name),
  name,
});
