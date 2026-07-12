import type { ReactElement } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentRuntimeChildStatus } from '@shared/agent-runtime-contract'

export type AgentFocusNavigationItem = {
  threadId: string
  label: string
  status?: AgentRuntimeChildStatus
}

export type AgentFocusNavigationProps = {
  lineage: readonly AgentFocusNavigationItem[]
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onUp: () => void
  onNavigateTo: (threadId: string, index: number) => void
  className?: string
}

function statusClass(status: AgentRuntimeChildStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'bg-blue-500'
    case 'queued':
      return 'bg-amber-500'
    case 'completed':
      return 'bg-emerald-500'
    case 'failed':
    case 'aborted':
      return 'bg-red-500'
    default:
      return 'bg-ds-faint'
  }
}

export function AgentFocusNavigation({
  lineage,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onUp,
  onNavigateTo,
  className = ''
}: AgentFocusNavigationProps): ReactElement {
  const { t } = useTranslation('common')
  const canGoUp = lineage.length > 1

  return (
    <nav
      className={`ds-no-drag flex min-w-0 items-center gap-1 border-b border-ds-border-muted bg-white/92 px-3 py-1.5 dark:bg-ds-card ${className}`}
      aria-label={t('agentFocusNavigation')}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label={t('agentFocusBack')}
          title={t('agentFocusBack')}
          className="ds-sidebar-toggle-button disabled:pointer-events-none disabled:opacity-35"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label={t('agentFocusForward')}
          title={t('agentFocusForward')}
          className="ds-sidebar-toggle-button disabled:pointer-events-none disabled:opacity-35"
        >
          <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onUp}
          disabled={!canGoUp}
          aria-label={t('agentFocusUp')}
          title={t('agentFocusUp')}
          className="ds-sidebar-toggle-button disabled:pointer-events-none disabled:opacity-35"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {lineage.map((item, index) => {
          const current = index === lineage.length - 1
          return (
            <span key={`${item.threadId}:${index}`} className="inline-flex min-w-0 shrink-0 items-center gap-0.5">
              {index > 0 ? (
                <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
              ) : null}
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => onNavigateTo(item.threadId, index)}
                title={item.label}
                className={`inline-flex h-7 max-w-48 items-center gap-1.5 truncate rounded-md px-2 text-[12px] font-medium transition ${
                  current
                    ? 'bg-ds-hover text-ds-ink'
                    : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
              >
                {item.status ? (
                  <span
                    aria-label={t(`sidebarChildrenStatus${item.status.charAt(0).toUpperCase()}${item.status.slice(1)}`)}
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusClass(item.status)}`}
                  />
                ) : null}
                <span className="truncate">{item.label}</span>
              </button>
            </span>
          )
        })}
      </div>
    </nav>
  )
}
