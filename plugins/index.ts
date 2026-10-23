/**
 * Optional business plugins live beside the application source. Vite expands
 * this directory at build time, so removing a plugin does not require a core
 * source change or leave a stale import behind.
 */
const discovered = import.meta.glob(['./*/index.ts', '!./api/**'], {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

export const rendererPlugins: readonly unknown[] = Object.values(discovered).filter(Boolean);
