import { createContext } from 'react';
import type { ServiceContainer } from './di/container';

export const ServiceContext = createContext<ServiceContainer | null>(null);
