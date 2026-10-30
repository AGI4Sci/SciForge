import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Download, Loader2, Power, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import type {
  DshMarketPlugin,
  DshMarketProgress,
  DshMarketView
} from '@shared/dsh-market'

/**
 * The market tab.
 *
 * What this view is careful about: it never decides anything. Approving an
 * install means showing the plugin's declared tools and effects and sending
 * exactly those back; the host re-checks them against the artifact and refuses a
 * mismatch. Progress is whatever the host reported, and a failure is shown as the
 * host's own message.
 */

const effectKey: Readonly<Record<string, string>> = {
  read: 'marketEffectRead',
  compute: 'marketEffectCompute',
  'workspace-write': 'marketEffectWorkspaceWrite',
  'external-write': 'marketEffectExternalWrite',
  destructive: 'marketEffectDestructive'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function MarketCatalog(): ReactElement {
  const { t } = useTranslation()
  const [view, setView] = useState<DshMarketView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<DshMarketProgress | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [confirming, setConfirming] = useState<DshMarketPlugin | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setView(await window.sciforge.market.list())
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Real progress only: the host reports phases, so the UI polls while an install
  // is running instead of animating an invented percentage.
  useEffect(() => {
    if (!busy) return
    let active = true
    const timer = window.setInterval(() => {
      void window.sciforge.market.progress({ packageName: busy }).then((next) => {
        if (active) setProgress(next)
      })
    }, 400)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [busy])

  const categories = useMemo(() => {
    const found = new Set<string>()
    for (const plugin of view?.plugins ?? []) for (const entry of plugin.categories) found.add(entry)
    return [...found].sort()
  }, [view])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (view?.plugins ?? []).filter((plugin) => {
      if (category !== 'all' && !plugin.categories.includes(category)) return false
      if (!needle) return true
      return `${plugin.title} ${plugin.name} ${plugin.categories.join(' ')}`.toLowerCase().includes(needle)
    })
  }, [view, query, category])

  const install = useCallback(async (plugin: DshMarketPlugin) => {
    setConfirming(null)
    setBusy(plugin.name)
    setNotice(null)
    setProgress(null)
    try {
      await window.sciforge.market.install({
        packageName: plugin.name,
        approvedToolNames: plugin.tools.map((tool) => tool.name)
      })
      setNotice({ tone: 'info', text: t('marketInstallDone', { name: plugin.title }) })
      await refresh()
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }, [refresh, t])

  const toggle = useCallback(async (plugin: DshMarketPlugin) => {
    setBusy(plugin.name)
    setNotice(null)
    try {
      await window.sciforge.market.setEnabled({ packageName: plugin.name, enabled: !plugin.enabled })
      await refresh()
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }, [refresh])

  const uninstall = useCallback(async (plugin: DshMarketPlugin) => {
    setBusy(plugin.name)
    setNotice(null)
    try {
      await window.sciforge.market.uninstall({ packageName: plugin.name })
      await refresh()
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }, [refresh])

  return (
    <div className="mt-7" id="extension-center-market-panel" role="tabpanel" aria-labelledby="extension-center-market-tab">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <label className="relative min-w-0 flex-1">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('marketSearchPlaceholder')}
            className="w-full rounded-xl border border-ds-border-muted bg-ds-subtle px-3 py-2 text-[13px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-[var(--ds-accent)]"
          />
        </label>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label={t('marketCategoryLabel')}
          className="rounded-xl border border-ds-border-muted bg-ds-subtle px-3 py-2 text-[13px] text-ds-ink"
        >
          <option value="all">{t('marketAllCategories')}</option>
          {categories.map((entry) => (
            <option key={entry} value={entry}>{entry}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-ds-subtle px-3 py-2 text-[13px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
          {t('marketRefresh')}
        </button>
      </div>

      {notice ? (
        <div
          role="status"
          className={`mt-4 rounded-xl border px-3 py-2 text-[13px] ${
            notice.tone === 'error'
              ? 'border-red-400/40 bg-red-500/10 text-red-200'
              : 'border-ds-border-muted bg-ds-subtle text-ds-muted'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {view?.error ? (
        <div className="mt-4 rounded-xl border border-ds-border-muted bg-ds-subtle px-3 py-2 text-[13px] text-ds-muted">
          <div className="font-semibold text-ds-ink">{t('marketIndexUnavailable')}</div>
          <div className="mt-1">{view.error}</div>
        </div>
      ) : null}

      {view?.source ? (
        <p className="mt-3 font-mono text-[11px] text-ds-faint">
          {t('marketIndexSource')}: {view.source.location}
          {view.dshRuntimeVersion ? ` · DSH ${view.dshRuntimeVersion}` : ''}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-3">
        {visible.length === 0 && view?.error === null ? (
          <p className="text-[13px] text-ds-muted">{t('marketEmpty')}</p>
        ) : null}
        {visible.map((plugin) => (
          <article key={plugin.name} className="rounded-2xl border border-ds-border-muted bg-ds-panel p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ds-subtle text-ds-muted">
                <Box className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[17px] font-semibold text-ds-ink">{plugin.title}</h3>
                <div className="mt-1 font-mono text-[11px] text-ds-faint">
                  {plugin.name} · {plugin.version} · {formatSize(plugin.sizeBytes)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {plugin.categories.map((entry) => (
                    <span key={entry} className="rounded-md bg-ds-subtle px-2 py-0.5 text-[11px] text-ds-muted">{entry}</span>
                  ))}
                  {plugin.publisher ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-ds-subtle px-2 py-0.5 text-[11px] text-ds-muted">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      {plugin.publisher}
                    </span>
                  ) : null}
                  {plugin.installed ? (
                    <span className="rounded-md bg-ds-userbubble px-2 py-0.5 text-[11px] font-semibold text-ds-userbubbleFg">
                      {plugin.enabled ? t('marketInstalledEnabled') : t('marketInstalledDisabled')}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {plugin.installed ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void toggle(plugin)}
                      disabled={busy === plugin.name}
                      className="inline-flex items-center gap-2 rounded-xl bg-ds-subtle px-3 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:opacity-60"
                    >
                      {busy === plugin.name ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Power className="h-3 w-3" aria-hidden="true" />}
                      {plugin.enabled ? t('marketDisable') : t('marketEnable')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void uninstall(plugin)}
                      disabled={busy === plugin.name}
                      className="inline-flex items-center gap-2 rounded-xl bg-ds-subtle px-3 py-1.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover disabled:opacity-60"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      {t('marketUninstall')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(plugin)}
                    disabled={busy === plugin.name}
                    className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:opacity-60"
                  >
                    {busy === plugin.name ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />}
                    {busy === plugin.name ? t('marketInstalling') : t('marketInstall')}
                  </button>
                )}
              </div>
            </div>

            {busy === plugin.name && progress ? (
              <p className="mt-3 text-[12px] text-ds-muted">
                {t('marketPhase')}: {t(`marketPhase_${progress.phase}`)}
                {progress.bytesTotal ? ` · ${progress.bytesReceived ?? 0}/${progress.bytesTotal} B` : ''}
              </p>
            ) : null}

            {plugin.runtimeNote ? (
              <p className="mt-3 text-[12px] text-ds-muted">{plugin.runtimeNote}</p>
            ) : null}

            {plugin.installed ? (
              <div className="mt-3 rounded-xl border border-ds-border-muted bg-ds-subtle p-3">
                <div className="text-[12px] font-semibold text-ds-ink">{t('marketHowToUse')}</div>
                <p className="mt-1 text-[12px] text-ds-muted">{t('marketHowToUseHint')}</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {plugin.capabilities.length === 0 ? (
                    <li className="text-[12px] text-ds-muted">{t('marketNoPermissions')}</li>
                  ) : plugin.capabilities.map((capability) => (
                    <li key={capability.id} className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-ds-ink">
                      <span>{capability.id}</span>
                      <span className="text-ds-muted">({t(effectKey[capability.effect] ?? 'marketEffectRead')})</span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 font-sans text-[11px] ${
                          capability.registered
                            ? 'bg-ds-userbubble text-ds-userbubbleFg'
                            : 'bg-ds-subtle text-ds-muted'
                        }`}
                      >
                        {capability.registered ? t('marketCapabilityRegistered') : t('marketCapabilityNotRegistered')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {confirming?.name === plugin.name ? (
              <div className="mt-4 rounded-xl border border-ds-border-muted bg-ds-subtle p-3">
                <div className="text-[13px] font-semibold text-ds-ink">{t('marketConfirmInstall')}</div>
                <div className="mt-2 text-[12px] text-ds-muted">{t('marketPermissions')}</div>
                <ul className="mt-1 flex flex-col gap-1">
                  {plugin.tools.length === 0 ? (
                    <li className="text-[12px] text-ds-muted">{t('marketNoPermissions')}</li>
                  ) : plugin.tools.map((tool) => (
                    <li key={tool.name} className="font-mono text-[12px] text-ds-ink">
                      {tool.id} <span className="text-ds-muted">({t(effectKey[tool.effect] ?? 'marketEffectRead')})</span>
                    </li>
                  ))}
                </ul>
                {plugin.hostDependencies.length > 0 ? (
                  <p className="mt-2 text-[12px] text-ds-muted">
                    {t('marketHostDependencies')}: <span className="font-mono">{plugin.hostDependencies.join(', ')}</span>
                  </p>
                ) : null}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-xl bg-ds-subtle px-3 py-1.5 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover"
                  >
                    {t('marketCancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void install(plugin)}
                    className="rounded-xl bg-ds-userbubble px-3 py-1.5 text-[12px] font-semibold text-ds-userbubbleFg transition hover:opacity-90"
                  >
                    {t('marketApproveAndInstall')}
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {(view?.notInstallable.length ?? 0) > 0 ? (
        <section className="mt-8">
          <h2 className="text-[17px] font-semibold text-ds-ink">{t('marketNotInstallable')}</h2>
          <p className="mt-1 text-[12px] text-ds-muted">{t('marketNotInstallableHint')}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {view?.notInstallable.map((entry) => (
              <li key={entry.name} className="rounded-xl border border-ds-border-muted bg-ds-subtle px-3 py-2">
                <div className="font-mono text-[11px] text-ds-faint">{entry.name} · {entry.version}</div>
                <div className="mt-1 text-[12px] text-ds-muted">{entry.reason}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}