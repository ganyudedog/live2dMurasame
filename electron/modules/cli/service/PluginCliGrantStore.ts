/** Persistence port for the plugin sources allowed to invoke CLI commands. */
export interface PluginCliGrantStore {
  read(): string[];
  write(sources: string[]): void;
}
