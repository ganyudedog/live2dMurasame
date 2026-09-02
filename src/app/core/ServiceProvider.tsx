import type { PropsWithChildren } from 'react';
import type { ServiceContainer } from './di/container';
import { ServiceContext } from './serviceContext';

export const ServiceProvider = ({
  container,
  children,
}: PropsWithChildren<{ container: ServiceContainer }>) => (
  <ServiceContext.Provider value={container}>{children}</ServiceContext.Provider>
);
