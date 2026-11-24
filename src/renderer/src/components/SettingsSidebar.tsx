import type { ReactElement } from 'react'
import { Bot, ChevronLeft, Globe, Keyboard, Mic, ServerCog, Settings } from 'lucide-react'

export function SettingsSidebar({
  category,
  extensions,
  goBack,
  setCategory,
  t
}: {
  category: string
  extensions: readonly Readonly<{ id: string; label: string }>[]
  goBack: () => void
  setCategory: (category: string) => void
  t: (key: string) => string
}): ReactElement {
  const catCls = (c: string): string =>
    `ds-button-plain flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-ds-md font-medium transition ${
      category === c
        ? 'bg-[var(--ds-sidebar-row-active)] text-ds-ink'
        : 'text-ds-muted hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink'
    }`

  return (
    <aside className="ds-drag flex w-[248px] shrink-0 flex-col border-r border-ds-border bg-ds-sidebar backdrop-blur-md">
      <div className="px-3 pb-3 pt-3">
        <div aria-hidden className="ds-titlebar-safe-block" />
        <button
          type="button"
          onClick={goBack}
          className="ds-button-plain ds-no-drag flex items-center gap-2 rounded-lg px-2 py-2 text-ds-md text-ds-muted hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          {t('back')}
        </button>
      </div>
      <nav className="ds-no-drag flex flex-col gap-0.5 px-2">
        <button type="button" className={catCls('general')} onClick={() => setCategory('general')}>
          <Globe className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('general')}
        </button>
        <button type="button" className={catCls('speechToText')} onClick={() => setCategory('speechToText')}>
          <Mic className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('speechToText')}
        </button>
        <button type="button" className={catCls('agents')} onClick={() => setCategory('agents')}>
          <Bot className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('agents')}
        </button>
        <button type="button" className={catCls('shortcuts')} onClick={() => setCategory('shortcuts')}>
          <Keyboard className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('keyboardShortcuts')}
        </button>
        <button type="button" className={catCls('remoteResources')} onClick={() => setCategory('remoteResources')}>
          <ServerCog className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
          {t('remoteResources')}
        </button>
        {extensions.map(({ id, label }) => (
          <button key={id} type="button" className={catCls(id)} onClick={() => setCategory(id)}
            aria-current={category === id ? 'page' : undefined}>
            <Settings className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
            {t(label)}
          </button>
        ))}
      </nav>
      <div className="ds-no-drag mt-auto border-t border-ds-border p-3">
        <div className="flex items-center gap-2 rounded-xl px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ds-subtle text-ds-muted">
            <Settings className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 text-ds-sm text-ds-muted">
            <div className="truncate font-medium text-ds-ink">SciForge</div>
            <div className="truncate">{t('settingsFooter')}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
