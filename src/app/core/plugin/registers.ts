import type { CommandContribution, Disposable, UiContribution } from './types';
import type { ContributionRegistry } from './registry';

export class UiRegister {
  private readonly ownerId: string;
  private readonly registry: ContributionRegistry<UiContribution>;

  constructor(
    ownerId: string,
    registry: ContributionRegistry<UiContribution>,
  ) {
    this.ownerId = ownerId;
    this.registry = registry;
  }

  register(contribution: UiContribution): Disposable {
    return this.registry.register(this.ownerId, contribution);
  }

  list(slot?: string): readonly UiContribution[] {
    return slot ? this.registry.listBySlot(slot) : this.registry.list();
  }

  listOwned(slot?: string): readonly { ownerId: string; contribution: UiContribution }[] {
    return this.registry.listOwned()
      .filter(({ value }) => !slot || value.slot === slot)
      .map(({ ownerId, value }) => ({ ownerId, contribution: value }));
  }
}

export class CommandRegister {
  private readonly ownerId: string;
  private readonly registry: ContributionRegistry<CommandContribution>;

  constructor(
    ownerId: string,
    registry: ContributionRegistry<CommandContribution>,
  ) {
    this.ownerId = ownerId;
    this.registry = registry;
  }

  register(contribution: CommandContribution): Disposable {
    return this.registry.register(this.ownerId, contribution);
  }

  list(): readonly CommandContribution[] { return this.registry.list(); }
}

export type Live2dRegister = UiRegister;
export type ControlPanelRegister = UiRegister;
export type AiRegister = CommandRegister;
export type ElectronRegister = CommandRegister;
