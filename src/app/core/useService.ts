import { useContext } from 'react';
import type { ServiceToken } from './di/token';
import { ServiceContext } from './serviceContext';

export const useService = <T,>(token: ServiceToken<T>): T => {
  const container = useContext(ServiceContext);
  if (!container) throw new Error(`ServiceProvider is missing for ${token.name}`);
  return container.resolve(token);
};
