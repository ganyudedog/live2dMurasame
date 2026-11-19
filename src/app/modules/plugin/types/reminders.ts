import type { Disposable } from './common';

export interface ReminderRecord {
  readonly id: string;
  readonly dueAt: number;
  readonly sentence: string;
  readonly speakText?: string;
  readonly submittedAt?: number;
  readonly channel: { readonly kind: 'desktop' } | { readonly kind: 'channel'; readonly channelId: string; readonly source: string; readonly conversationId: string; readonly requestId?: string };
}

export interface ReminderHostApi {
  add(dueAt: number, sentence: string, channel?: { readonly kind: 'desktop' } | { readonly kind: 'channel'; readonly channelId: string; readonly source: string; readonly conversationId: string }): { id: string; dueAt: number; sentence: string };
  registerChannel(channelId: string, deliver: (record: ReminderRecord) => boolean | 'submitted' | Promise<boolean | 'submitted'>): Disposable;
  confirmDelivery(reminderId: string, delivered: boolean): void;
  retryDue(): void;
}
