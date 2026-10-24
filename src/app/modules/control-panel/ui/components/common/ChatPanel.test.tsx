import { Children, isValidElement } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode, TextareaHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './ChatPanel';

function inputIn(node: ReactNode): ReactElement<TextareaHTMLAttributes<HTMLTextAreaElement>> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === 'textarea') return child as ReactElement<TextareaHTMLAttributes<HTMLTextAreaElement>>;
    const found = inputIn(child.props.children);
    if (found) return found;
  }
}

function enter(options: { shiftKey?: boolean; composing?: boolean } = {}) {
  const event = { key: 'Enter', shiftKey: options.shiftKey ?? false, nativeEvent: { isComposing: options.composing ?? false },
    defaultPrevented: false, preventDefault: () => { event.defaultPrevented = true; },
  };
  return event as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

const base = { draft: '你好', busy: false, inputLabel: '输入', placeholder: '输入内容', onDraftChange: vi.fn() };

describe('shared chat composition', () => {
  it('does not send while confirming Chinese input or inserting a newline', () => {
    const onSubmit = vi.fn();
    const input = inputIn(ChatComposer({ ...base, onSubmit }))!;
    input.props.onKeyDown!(enter({ composing: true }));
    input.props.onKeyDown!(enter({ shiftKey: true }));
    expect(onSubmit).not.toHaveBeenCalled();
    input.props.onKeyDown!(enter());
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('lets action completion consume Enter without sending the draft', () => {
    const onSubmit = vi.fn();
    const completeMention = vi.fn((event: KeyboardEvent<HTMLTextAreaElement>) => event.preventDefault());
    const input = inputIn(ChatComposer({ ...base, onSubmit, inputProps: { onKeyDown: completeMention } }))!;
    input.props.onKeyDown!(enter());
    expect(completeMention).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([{ draft: '  ', busy: false }, { draft: '你好', busy: true }])('blocks empty or busy sends (%j)', (state) => {
    const onSubmit = vi.fn();
    inputIn(ChatComposer({ ...base, ...state, onSubmit }))!.props.onKeyDown!(enter());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
