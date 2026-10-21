import { Children, isValidElement } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode, TextareaHTMLAttributes } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ChatPanel, { ChatComposer } from './common/ChatPanel';
import MotionSettingsPage from '../pages/MotionSettingsPage';
import type { ActionSettingsView } from '../../modules/action-settings/domain/view';

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

  it('shows model and reasoning in one trigger and drops it when there is no model', () => {
    const model = { label: 'Model', value: 'gpt-a', options: [{ value: 'gpt-a', label: 'gpt-a' }], onChange: vi.fn() };
    const effort = { label: 'Reasoning', value: 'low',
      options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }], onChange: vi.fn() };
    const withSlots = renderToStaticMarkup(<ChatComposer {...base} onSubmit={vi.fn()} model={model} effort={effort}
      toolbar={<button type="button">清空对话</button>} />);
    // 两者合并在同一个按钮里，菜单关闭时不渲染选项。
    expect(withSlots).toContain('aria-label="Model / Reasoning"');
    expect(withSlots).toContain('gpt-a');
    expect(withSlots).toContain('Low');
    expect(withSlots).not.toContain('Reasoning</p>');
    expect(withSlots).toContain('清空对话');
    // 模型不接受思考参数时只显示模型，不伪造一个“默认档位”。
    const withoutEffort = renderToStaticMarkup(<ChatComposer {...base} onSubmit={vi.fn()} model={model} />);
    expect(withoutEffort).toContain('aria-label="Model"');
    expect(withoutEffort).not.toContain('Low');
    // 没有模型时不渲染选择器（菜单按钮不是唯一入口）。
    const noModel = renderToStaticMarkup(<ChatComposer {...base} onSubmit={vi.fn()} />);
    expect(noModel).not.toContain('aria-haspopup="menu"');
  });

  it('renders the action name as one inline tag without the @ trigger', () => {
    const html = renderToStaticMarkup(<ChatPanel {...base} draft="@转头 再明显一点" onSubmit={vi.fn()}
      title="动作表" messages={[]} emptyMessage="空会话"
      mentions={[{ id: 'head', label: '转头', category: 'head' }]} />);
    expect(html).toContain('data-mention-overlay');
    // 标签文本就是显示名（长度按名称算）、不带 @，底色按类别着色，与 textarea 逐字对齐。
    expect(html).toContain('rounded-sm bg-primary/20">转头<');
    expect(html).toContain('>@转头 再明显一点</textarea>');
  });

  it('renders normal conversation and action details through the same chat surface', () => {
    const html = renderToStaticMarkup(<ChatPanel {...base} onSubmit={vi.fn()} title="对话" description="说明"
      messages={[{ id: 'm1', role: 'assistant', text: '回复', status: 'error', error: '连接失败' }]}
      emptyMessage="空会话" onClear={vi.fn()} beforeHeader={<div>语音状态</div>} />);
    expect(html).toContain('语音状态');
    expect(html).toContain('连接失败');
    expect(html).toContain('role="log"');
    const view: ActionSettingsView = { modelPath: 'pet', draft: '@action:head ',
      busy: false, canCancel: false, taskNotice: null, error: null, selectedId: null,
      actions: [{ id: 'head', label: '转头', category: 'head', durationMs: 1000, enterMs: 200, returnMs: 200, tracks: [] }],
      messages: [{ id: 'task', role: 'assistant', text: '检查完成', status: 'done', reasoningSummary: '已调整衔接',
        reviewNotes: [{ actionId: 'head', message: '预览转头' }] }] };
    const actions = renderToStaticMarkup(<MotionSettingsPage view={view}
      voice={{ enabled: false, state: 'off', partialText: '', error: null, loading: false, onToggle: vi.fn() }}
      llmModels={[{ id: 'gpt-a', efforts: ['low', 'high'], effortsSource: 'probe', probedAt: 1 }]}
      actionModel="gpt-a" actionReasoningEffort="high"
      onActionModelChange={vi.fn()} onActionReasoningEffortChange={vi.fn()}
      onGenerate={vi.fn(async () => {})} onCancel={vi.fn()} onSelect={vi.fn()}
      onDraftChange={vi.fn()} onPreview={vi.fn(async () => {})} onDelete={vi.fn(async () => {})}
      onUpdateMetadata={vi.fn(async () => true)} onSubmit={vi.fn(async () => {})} onClearChat={vi.fn()} />);
    expect(actions).toContain('role="log"');
    expect(actions).toContain('已调整衔接');
    expect(actions).toContain('预览转头');
    expect(actions).toContain('动作表查看');
    expect(actions).toContain('动作表微调输入');
    expect(actions).toContain('转头');
    // 动作表同样自带模型与思考强度入口，和对话互不影响；档位显示接口返回的原值。
    expect(actions).toContain('aria-label="Model / Reasoning"');
    expect(actions).toContain('>high<');
  });
});
