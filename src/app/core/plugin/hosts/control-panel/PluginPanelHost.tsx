import { observer } from 'mobx-react-lite';
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { useService } from '../../../useService';
import { TOKENS } from '../../../serviceTokens';
import type { UiRenderContext } from '../../types';

export const PluginPanelHost = observer(({ slot, tabId }: { slot?: string; tabId?: string }) => {
  const runtime = useService(TOKENS.plugin);
  const revision = runtime.revision;
  void revision;
  const page = tabId ? runtime.getControlPanelPages().find((item) => item.tabId === tabId) : null;
  const contributions = page
    ? [{ ownerId: page.ownerId, contribution: page.contribution }]
    : slot ? runtime.getUiContributions(slot) : [];
  return (
    <div className="space-y-4">
      {contributions.map(({ ownerId, contribution }) => {
        const Render = contribution.render as ComponentType<UiRenderContext>;
        const content: ReactNode = (
          <PluginErrorBoundary title={contribution.title}>
            <Render {...runtime.createUiContext(ownerId)} />
          </PluginErrorBoundary>
        );
        // 独立页面由插件自己分卡排版，宿主不再套一层卡片；插槽里的贡献仍统一包成带标题的卡片。
        if (page) return <div key={`${ownerId}/${contribution.id}`}>{content}</div>;
        return (
          <section key={`${ownerId}/${contribution.id}`} className="rounded-xl bg-card p-4 shadow-card">
            <h2 className="mb-3 text-[13px] font-semibold">{contribution.title}</h2>
            {content}
          </section>
        );
      })}
    </div>
  );
});

class PluginErrorBoundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[plugin-ui] ${this.props.title} failed`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2.5 text-xs text-danger">
          {this.props.title} 加载失败：{this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
