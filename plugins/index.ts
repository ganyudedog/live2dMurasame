/**
 * Optional business plugins live beside the application source. Vite expands
 * this directory at build time. The default export is typed as unknown because
 * the glob cannot see each module's type; bootstrap parses it into a plugin definition.
 */
const discovered = import.meta.glob(['./*/index.ts', '!./api/**'], {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

export const rendererPlugins: readonly unknown[] = Object.values(discovered).filter(Boolean);
