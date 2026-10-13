import { actionBound, computed, makeObservable, observable } from 'mobx';
import type { StateBusService } from '@app/shared/state-bus/StateBusService';

export class FloatingComposerService {
  enabled = true;
  hovered = false;
  focused = false;
  dismissed = false;
  private readonly stateBus: StateBusService;
  constructor(stateBus: StateBusService) {
    this.stateBus = stateBus;
    makeObservable(this, { enabled: observable, hovered: observable, focused: observable, dismissed: observable,
      visible: computed, configure: actionBound, setHovered: actionBound, setFocused: actionBound, dismiss: actionBound, submit: actionBound });
  }
  get visible() { return this.enabled && !this.dismissed && (this.hovered || this.focused); }
  get draft() { return this.stateBus.composerDraft; }
  configure(enabled: boolean) { this.enabled = enabled; this.dismissed = false; if (!enabled) this.focused = false; }
  setHovered(hovered: boolean) { this.hovered = hovered; if (!hovered && !this.focused) this.dismissed = false; }
  setFocused(focused: boolean) { this.focused = focused; }
  setDraft(text: string) { this.stateBus.publishComposerDraft(text); }
  dismiss() { this.focused = false; this.dismissed = true; }
  submit() {
    const text = this.draft.trim();
    if (!text) return;
    this.stateBus.publishChatRequest({ id: `text_${crypto.randomUUID()}`, text, source: 'text', status: 'pending', createdAt: Date.now() });
    this.setDraft(''); this.dismiss();
  }
}
