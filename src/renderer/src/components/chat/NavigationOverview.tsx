import { MessageSquare, PanelLeftOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function NavigationOverview({ title, sidebarCollapsed, onExpandSidebar }: {
  title: string
  sidebarCollapsed: boolean
  onExpandSidebar: () => void
}) {
  const { t } = useTranslation('common')
  return (
    <section className="ds-chat-stage flex min-w-0 flex-1 flex-col" aria-label={title}>
      <header className="flex min-h-14 items-center gap-3 border-b border-[var(--ds-border)] px-5 py-3">
        {sidebarCollapsed ? (
          <button type="button" onClick={onExpandSidebar} aria-label={t('sidebarExpand')}
            className="ds-no-drag rounded-lg p-2 text-ds-muted hover:bg-[var(--ds-sidebar-row-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
        <h1 className="min-w-0 truncate text-sm font-medium text-ds-ink" title={title}>{title}</h1>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md text-center">
          <MessageSquare className="mx-auto mb-5 h-8 w-8 text-ds-muted" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="text-lg font-medium text-ds-ink">{t('navigationOverviewTitle')}</h2>
          <p className="mt-3 text-sm leading-relaxed text-ds-muted">{t('navigationOverviewDescription')}</p>
          {sidebarCollapsed ? (
            <button type="button" onClick={onExpandSidebar}
              className="ds-no-drag mt-6 rounded-lg border border-[var(--ds-border)] px-4 py-2 text-sm text-ds-ink hover:bg-[var(--ds-sidebar-row-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              {t('sidebarExpand')}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
