import type { PluginDefinition } from '../../src/app/modules/plugin/types/context';

export type * from '../../src/app/modules/plugin/types/context';
export type { PluginManifest } from '../../src/app/modules/plugin/types/manifest';
export const definePlugin = (definition: PluginDefinition): PluginDefinition => definition;

export * from '../ui-kit/layout';
export * from '../ui-kit/styles';
export { Button } from '../../src/app/modules/control-panel/ui/components/common/Button';
export { Switch } from '../../src/app/modules/control-panel/ui/components/common/Switch';
export { default as Modal } from '../../src/app/modules/control-panel/ui/components/common/Modal';
export { Search, Eye, EyeOff, Info } from 'lucide-react';
