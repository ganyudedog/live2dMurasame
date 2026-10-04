import type { CommandContribution, Disposable, HostApi, UiContribution } from './types';

type Owned<T> = { ownerId: string; value: T };

export class ContributionRegistry<T extends { id: string }> {
  private readonly entries = new Map<string, Owned<T>>();

  register(ownerId: string, contribution: T): Disposable {
    if (!ownerId.trim()) throw new Error('A contribution owner is required');
    if (this.entries.has(contribution.id)) {
      throw new Error(`Duplicate contribution: ${contribution.id}`);
    }
    this.entries.set(contribution.id, { ownerId, value: contribution });
    return () => this.entries.delete(contribution.id);
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
  private readonly apis = new Map<string, HostApi>();

  register<T extends HostApi>(id: string, api: T): void {
    if (this.apis.has(id)) throw new Error(`Duplicate HostApi: ${id}`);
    this.apis.set(id, api);
  }

  get<T extends HostApi>(id: string): T | undefined {
    return this.apis.get(id) as T | undefined;
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.apis.entries());
  }
}

export class PluginRegistry {
  readonly ui = new ContributionRegistry<UiContribution>();
  readonly commands = new ContributionRegistry<CommandContribution>();
  readonly hostApis = new HostApiRegistry();
}
