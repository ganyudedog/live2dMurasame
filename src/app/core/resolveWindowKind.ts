import type { WindowKind } from './di/module';

export const resolveWindowKind = (search: string): WindowKind => {
  const view = new URLSearchParams(search).get('window');
  if (view === 'control-panel') return view;
  return 'pet';
};
