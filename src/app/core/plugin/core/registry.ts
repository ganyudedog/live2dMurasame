import type { CommandContribution, UiContribution } from '../types';

type Owned<T> = { ownerId: string; value: T };

export class ContributionRegistry<T extends { id: string }> {
  private readonly entries = new Map<string, Owned<T>>();

  register(ownerId: string, contribution: T): () => boolean {
    if (!ownerId.trim()) throw new Error('A contribution owner is required');
    const key = `${ownerId}/${contribution.id}`;
    if (this.entries.has(key)) throw new Error(`Duplicate contribution: ${key}`);
    this.entries.set(key, { ownerId, value: contribution });
    return () => this.entries.delete(key);
  }

  removeOwner(ownerId: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.ownerId === ownerId) this.entries.delete(id);
    }
  }

  list(): readonly T[] {
    return [...this.entries.values()]
      .map((entry) => entry.value)
      .sort((left, right) => (
        ((left as T & { order?: number }).order ?? 0)
        - ((right as T & { order?: number }).order ?? 0)
        || left.id.localeCompare(right.id)
      ));
  }

  listOwned(): readonly Owned<T>[] {
    return [...this.entries.values()].sort((left, right) => (
      ((left.value as T & { order?: number }).order ?? 0)
      - ((right.value as T & { order?: number }).order ?? 0)
      || left.value.id.localeCompare(right.value.id)
    ));
  }

  listBySlot(slot: string): readonly T[] {
    return this.list().filter((entry) => 'slot' in entry && (entry as unknown as UiContribution).slot === slot);
  }
}

export class HostApiRegistry {
  private readonly apis = new Map<string, { api: object; permission: string }>();

  register(id: string, api: object, permission: string): void {
    if (this.apis.has(id)) throw new Error(`Duplicate HostApi: ${id}`);
    this.apis.set(id, { api, permission });
  }

  snapshot(permissions?: readonly string[]): Record<string, unknown> {
    const allowed = permissions ? new Set(permissions) : null;
    return Object.fromEntries([...this.apis.entries()]
      .filter(([, value]) => !allowed || allowed.has(value.permission))
      .map(([id, value]) => [id, value.api]));
  }
}

export class PluginRegistry {
  readonly ui = new ContributionRegistry<UiContribution>();
  readonly commands = new ContributionRegistry<CommandContribution>();
  readonly hostApis = new HostApiRegistry();
}
