import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

interface AppErrorBoundaryState {
  error?: Error;
  componentStack?: string;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, componentStack: info.componentStack ?? undefined });
    console.error('[SciForge] UI render failed', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-crash-shell" role="alert">
        <section className="app-crash-panel">
          <p className="eyebrow">UI render failed</p>
          <h1>工作台渲染异常</h1>
          <p>当前页面没有丢失 workspace 数据；请刷新页面或检查最近一次运行的结果 payload。</p>
          <pre>{this.state.error.message}</pre>
          {this.state.componentStack ? (
            <details>
              <summary>组件堆栈</summary>
              <pre>{this.state.componentStack}</pre>
            </details>
          ) : null}
        </section>
      </main>
    );
  }
}
