import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../i18n'
import { useChatStore } from '../store/chat-store'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

export function recoverAppErrorBoundaryToWorkbench(): void {
  useChatStore.getState().setRoute('chat')
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary] uncaught render error:', error, info.componentStack)
    if (typeof window !== 'undefined' && typeof window.sciforge?.logError === 'function') {
      void window.sciforge.logError('renderer', 'Uncaught render error', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack
      }).catch(() => undefined)
    }
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleRetry = (): void => {
    this.setState({ error: null })
  }

  private handleReturnHome = (): void => {
    recoverAppErrorBoundaryToWorkbench()
    this.setState({ error: null })
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center bg-ds-main px-6">
        <div className="w-full max-w-md rounded-[8px] border border-amber-200/80 bg-amber-50/90 p-6 text-center shadow-[0_14px_32px_rgba(15,23,42,0.08)] dark:border-amber-800/60 dark:bg-amber-950/35">
          <h2 className="text-[16px] font-semibold text-amber-900 dark:text-amber-100">
            {i18n.t('appErrorTitle')}
          </h2>
          <p className="mt-2 text-[13px] leading-5 text-amber-800/80 dark:text-amber-100/80">
            {this.state.error.message || String(this.state.error)}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="rounded-full bg-amber-900/10 px-4 py-2 text-[13px] font-medium text-amber-900 transition hover:bg-amber-900/20 dark:bg-amber-100/10 dark:text-amber-100 dark:hover:bg-amber-100/20"
            >
              {i18n.t('appErrorRetry')}
            </button>
            <button
              type="button"
              onClick={this.handleReturnHome}
              className="rounded-full bg-amber-900/10 px-4 py-2 text-[13px] font-medium text-amber-900 transition hover:bg-amber-900/20 dark:bg-amber-100/10 dark:text-amber-100 dark:hover:bg-amber-100/20"
            >
              {i18n.t('appErrorReturnHome')}
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-full bg-amber-900/10 px-4 py-2 text-[13px] font-medium text-amber-900 transition hover:bg-amber-900/20 dark:bg-amber-100/10 dark:text-amber-100 dark:hover:bg-amber-100/20"
            >
              {i18n.t('appErrorReload')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
