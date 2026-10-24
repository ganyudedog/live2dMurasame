import { observer } from 'mobx-react-lite';
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { useService } from '../useService';
import { TOKENS } from '../serviceTokens';
import type { UiRenderContext } from './types';

export const PluginPanelHost = observer(({ slot, tabId }: { slot?: string; tabId?: string }) => {
  const runtime = useService(TOKENS.plugin);
  const revision = runtime.revision;
  void revision;
  const page = tabId ? runtime.getControlPanelPage(tabId) : null;
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
        return (
          <section key={`${ownerId}/${contribution.id}`} className="rounded-box border border-base-300 bg-base-100 p-4">
            <h2 className="mb-3 text-lg font-semibold">{contribution.title}</h2>
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
        <div className="alert alert-error">
          <span>{this.props.title} 加载失败：{this.state.error.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
