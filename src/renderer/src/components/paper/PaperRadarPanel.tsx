import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Clipboard,
  Database,
  ExternalLink,
  FileText,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperRadarProfile, PaperRadarRecord, PaperRadarStatus, PaperRadarSyncResult } from '@shared/paper-radar'

type Props = {
  className?: string
  onCollapse?: () => void
}

type ResultMode = 'digest' | 'search'
type Relevance = NonNullable<PaperRadarRecord['relevance']>

const DEFAULT_KEYWORDS = 'protein design, single-cell, foundation model'
const DEFAULT_ARXIV_CATEGORIES = 'q-bio, cs.LG, stat.ML'
const DEFAULT_BIORXIV_SUBJECTS = 'bioinformatics, genomics, systems biology'
const DEFAULT_DAYS = 7
const DEFAULT_TOP_K = 12

export function PaperRadarPanel({ className = '', onCollapse }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<PaperRadarStatus | null>(null)
  const [query, setQuery] = useState('single-cell foundation model')
  const [profiles, setProfiles] = useState<PaperRadarProfile[]>([])
  const [profileName, setProfileName] = useState('lab_default')
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS)
  const [excludeKeywords, setExcludeKeywords] = useState('')
  const [arxivCategories, setArxivCategories] = useState(DEFAULT_ARXIV_CATEGORIES)
  const [biorxivSubjects, setBiorxivSubjects] = useState(DEFAULT_BIORXIV_SUBJECTS)
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [papers, setPapers] = useState<PaperRadarRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [activeMode, setActiveMode] = useState<ResultMode>('digest')
  const [lastDigestAt, setLastDigestAt] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<PaperRadarSyncResult[] | null>(null)

  const keywordList = useMemo(() => parseList(keywords), [keywords])
  const excludeKeywordList = useMemo(() => parseList(excludeKeywords), [excludeKeywords])
  const arxivCategoryList = useMemo(() => parseList(arxivCategories), [arxivCategories])
  const biorxivSubjectList = useMemo(() => parseList(biorxivSubjects), [biorxivSubjects])

  const groupedPapers = useMemo(() => groupPapers(papers), [papers])
  const resultCounts = useMemo(() => ({
    high: groupedPapers.high.length,
    medium: groupedPapers.medium.length,
    low: groupedPapers.low.length
  }), [groupedPapers])

  const refreshStatus = async (): Promise<void> => {
    if (typeof window.dsGui?.paperRadar?.status !== 'function') return
    const next = await window.dsGui.paperRadar.status()
    setStatus(next)
    if (!next.ok && next.message) setMessage(friendlyPaperRadarError(next.message, t))
  }

  useEffect(() => {
    void refreshStatus()
    void loadProfiles()
  }, [])

  const loadProfiles = async (): Promise<void> => {
    if (typeof window.dsGui?.paperRadar?.listProfiles !== 'function') return
    const result = await window.dsGui.paperRadar.listProfiles()
    if (!result.ok) {
      setMessage(friendlyPaperRadarError(result.message, t))
      return
    }
    setProfiles(result.data.profiles)
    const initial = result.data.profiles.find((item) => item.name === profileName) ?? result.data.profiles[0]
    if (initial) applyProfile(initial)
  }

  const applyProfile = (profile: PaperRadarProfile): void => {
    setProfileName(profile.name)
    setKeywords(profile.keywords.join(', '))
    setExcludeKeywords(profile.excludeKeywords.join(', '))
    setArxivCategories(profile.arxivCategories.join(', '))
    setBiorxivSubjects(profile.biorxivSubjects.join(', '))
  }

  const currentProfile = (): PaperRadarProfile => ({
    name: profileName || 'lab_default',
    keywords: keywordList,
    excludeKeywords: excludeKeywordList,
    arxivCategories: arxivCategoryList,
    biorxivSubjects: biorxivSubjectList
  })

  const saveCurrentProfile = async (): Promise<PaperRadarProfile> => {
    if (!window.dsGui?.paperRadar?.saveProfile) return currentProfile()
    const result = await window.dsGui.paperRadar.saveProfile(currentProfile())
    if (!result.ok) throw new Error(friendlyPaperRadarError(result.message, t))
    await loadProfiles()
    return result.data.profile
  }

  const runProfileSync = async (): Promise<PaperRadarSyncResult[]> => {
    const today = new Date()
    const fromDate = new Date(today)
    fromDate.setDate(today.getDate() - Math.max(1, days))
    const from = fromDate.toISOString().slice(0, 10)
    const to = today.toISOString().slice(0, 10)
    const profile = await saveCurrentProfile()
    const sync = await window.dsGui.paperRadar.syncProfile({
      profile: profile.name,
      from,
      to,
      maxRecords: 200
    })
    if (!sync.ok) throw new Error(friendlyPaperRadarError(sync.message, t))
    setLastSync(sync.data.results)
    return sync.data.results
  }

  const runSync = async (): Promise<void> => {
    if (!window.dsGui?.paperRadar) return
    setBusy(true)
    setMessage(null)
    try {
      const results = await runProfileSync()
      setMessage(syncMessage(results, t))
      await refreshStatus()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const runDailyRadar = async (): Promise<void> => {
    if (!window.dsGui?.paperRadar) return
    setBusy(true)
    setMessage(null)
    try {
      const profile = await saveCurrentProfile()
      const results = await runProfileSync()
      const digest = await window.dsGui.paperRadar.digest({
        profile: profile.name,
        keywords: keywordList,
        excludeKeywords: excludeKeywordList,
        days,
        topK: DEFAULT_TOP_K
      })
      if (!digest.ok) throw new Error(friendlyPaperRadarError(digest.message, t))
      setActiveMode('digest')
      setPapers(digest.data.papers)
      setLastDigestAt(digest.data.generatedAt)
      setMessage(`${syncMessage(results, t)} ${t('paperRadarDigestDone', { count: digest.data.count })}`)
      await refreshStatus()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const runSearch = async (): Promise<void> => {
    if (!window.dsGui?.paperRadar) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.dsGui.paperRadar.search({ query, topK: DEFAULT_TOP_K })
      if (!result.ok) throw new Error(friendlyPaperRadarError(result.message, t))
      setActiveMode('search')
      setPapers(result.data.papers)
      setLastDigestAt(null)
      setMessage(t('paperRadarFound', { count: result.data.count }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const runDigest = async (): Promise<void> => {
    if (!window.dsGui?.paperRadar) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.dsGui.paperRadar.digest({
        profile: (await saveCurrentProfile()).name,
        keywords: keywordList,
        excludeKeywords: excludeKeywordList,
        days,
        topK: DEFAULT_TOP_K
      })
      if (!result.ok) throw new Error(friendlyPaperRadarError(result.message, t))
      setActiveMode('digest')
      setPapers(result.data.papers)
      setLastDigestAt(result.data.generatedAt)
      setMessage(t('paperRadarDigestDone', { count: result.data.count }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const copyDigest = async (): Promise<void> => {
    const text = buildDigestMarkdown({
      profileName,
      days,
      generatedAt: lastDigestAt,
      papers,
      counts: resultCounts,
      t
    })
    try {
      await navigator.clipboard.writeText(text)
      setMessage(t('paperRadarCopied'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const openExternal = (url: string | undefined): void => {
    if (!url || typeof window.dsGui?.openExternal !== 'function') return
    void window.dsGui.openExternal(url)
  }

  const renderPaperGroups = (): ReactElement => {
    if (!papers.length) {
      return (
        <div className="rounded-md border border-dashed border-ds-border px-3 py-8 text-center text-[13px] text-ds-faint">
          {t('paperRadarEmpty')}
        </div>
      )
    }
    if (activeMode === 'search') {
      return (
        <div className="grid gap-2">
          {papers.map((paper) => renderPaperCard(paper, openExternal, t))}
        </div>
      )
    }
    return (
      <div className="grid gap-3">
        {(['high', 'medium', 'low'] as Relevance[]).map((level) => {
          const items = groupedPapers[level]
          if (!items.length) return null
          return (
            <section key={level} className="grid gap-2">
              <div className="flex items-center justify-between text-[12px] font-semibold text-ds-muted">
                <span>{t(`paperRadarRelevance${capitalize(level)}`)}</span>
                <span>{items.length}</span>
              </div>
              {items.map((paper) => renderPaperCard(paper, openExternal, t))}
            </section>
          )
        })}
      </div>
    )
  }

  return (
    <section
      className={`ds-no-drag flex min-h-0 flex-col overflow-hidden bg-ds-sidebar ${className}`}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-ds-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-ds-ink">{t('paperRadarTitle')}</h2>
          <p className="mt-0.5 text-[12px] text-ds-faint">
            {status?.ok
              ? t('paperRadarStatusReady', {
                  total: status.stats?.papers ?? 0,
                  arxiv: status.stats?.arxiv ?? 0,
                  biorxiv: status.stats?.biorxiv ?? 0
                })
              : t('paperRadarStatusStarting')}
          </p>
        </div>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-md p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
      </header>

      <div className="ds-no-drag flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-gutter:stable]">
        <section className="grid gap-3 rounded-md border border-ds-border bg-ds-panel p-3">
          <div className="grid grid-cols-3 gap-2">
            <Metric label={t('paperRadarMetricTotal')} value={status?.stats?.papers ?? 0} />
            <Metric label="arXiv" value={status?.stats?.arxiv ?? 0} />
            <Metric label="bioRxiv" value={status?.stats?.biorxiv ?? 0} />
          </div>
          <button
            type="button"
            onClick={() => void runDailyRadar()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Sparkles className={`h-4 w-4 ${busy ? 'animate-pulse' : ''}`} strokeWidth={1.9} />
            {t('paperRadarUpdateDaily')}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void runSync()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-ds-border bg-ds-sidebar px-3 py-2 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} strokeWidth={1.8} />
              {t('paperRadarSyncOnly')}
            </button>
            <button
              type="button"
              onClick={() => void runDigest()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-ds-border bg-ds-sidebar px-3 py-2 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
            >
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
              {t('paperRadarDigestOnly')}
            </button>
          </div>
          {lastSync ? (
            <div className="flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
              {lastSync.map((item) => (
                <span key={item.source} className="rounded bg-ds-hover px-1.5 py-0.5">
                  {item.source}: +{item.upserted}/{item.fetched}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <section className="grid gap-3 rounded-md border border-ds-border bg-ds-panel p-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-ds-muted">
            <Settings2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('paperRadarProfile')}
          </div>
          <div className="flex gap-2">
            <select
              value={profileName}
              onChange={(event) => {
                const next = profiles.find((item) => item.name === event.target.value)
                if (next) applyProfile(next)
                else setProfileName(event.target.value)
              }}
              className="min-w-0 flex-1 rounded-md border border-ds-border bg-ds-sidebar px-3 py-2 text-[13px] font-normal text-ds-ink outline-none transition focus:border-accent"
            >
              {profiles.map((profile) => (
                <option key={profile.name} value={profile.name}>{profile.name}</option>
              ))}
              {profiles.every((profile) => profile.name !== profileName) ? (
                <option value={profileName}>{profileName}</option>
              ) : null}
            </select>
            <button
              type="button"
              onClick={() => void saveCurrentProfile().then(() => setMessage(t('paperRadarProfileSaved'))).catch((error) => setMessage(error instanceof Error ? error.message : String(error)))}
              disabled={busy}
              className="rounded-md border border-ds-border bg-ds-sidebar px-3 py-2 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
            >
              {t('paperRadarSaveProfile')}
            </button>
          </div>
          <input
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
            className="rounded-md border border-ds-border bg-ds-sidebar px-3 py-2 text-[13px] font-normal text-ds-ink outline-none transition focus:border-accent"
          />
          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
            {t('paperRadarKeywords')}
            <textarea
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              rows={3}
              className="resize-none rounded-md border border-ds-border bg-ds-sidebar px-3 py-2 text-[13px] font-normal text-ds-ink outline-none transition focus:border-accent"
            />
          </label>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
              {t('paperRadarDays')}
              <input
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(event) => setDays(clampNumber(Number(event.target.value), 1, 90, DEFAULT_DAYS))}
                className="rounded-md border border-ds-border bg-ds-sidebar px-3 py-2 text-[13px] font-normal text-ds-ink outline-none transition focus:border-accent"
              />
            </label>
            <Database className="mb-2.5 h-4 w-4 text-ds-faint" strokeWidth={1.8} />
          </div>
          <details className="group rounded-md border border-ds-border bg-ds-sidebar">
            <summary className="cursor-pointer list-none px-3 py-2 text-[12px] font-semibold text-ds-muted transition hover:text-ds-ink">
              {t('paperRadarAdvanced')}
            </summary>
            <div className="grid gap-3 border-t border-ds-border p-3">
              <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                {t('paperRadarExcludeKeywords')}
                <textarea
                  value={excludeKeywords}
                  onChange={(event) => setExcludeKeywords(event.target.value)}
                  rows={2}
                  className="resize-none rounded-md border border-ds-border bg-ds-panel px-3 py-2 text-[13px] font-normal text-ds-ink outline-none transition focus:border-accent"
                />
              </label>
              <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                {t('paperRadarArxivCategories')}
                <input
                  value={arxivCategories}
                  onChange={(event) => setArxivCategories(event.target.value)}
                  className="rounded-md border border-ds-border bg-ds-panel px-3 py-2 text-[13px] font-normal text-ds-ink outline-none transition focus:border-accent"
                />
              </label>
              <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                {t('paperRadarBiorxivSubjects')}
                <input
                  value={biorxivSubjects}
                  onChange={(event) => setBiorxivSubjects(event.target.value)}
                  className="rounded-md border border-ds-border bg-ds-panel px-3 py-2 text-[13px] font-normal text-ds-ink outline-none transition focus:border-accent"
                />
              </label>
            </div>
          </details>
        </section>

        <section className="grid gap-2 rounded-md border border-ds-border bg-ds-panel p-3">
          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
            {t('paperRadarSearch')}
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-ds-border bg-ds-sidebar px-3 py-2 text-[13px] font-normal text-ds-ink outline-none transition focus:border-accent"
              />
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={busy}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-ds-border bg-ds-sidebar text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
                aria-label={t('paperRadarSearch')}
                title={t('paperRadarSearch')}
              >
                <Search className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
          </label>
        </section>

        {message ? (
          <div className="rounded-md border border-ds-border bg-ds-panel px-3 py-2 text-[12px] text-ds-muted">
            {message}
          </div>
        ) : null}

        <section className="grid gap-3 pb-4">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-ds-muted">
                {activeMode === 'digest' ? t('paperRadarDigestResults') : t('paperRadarSearchResults')}
              </div>
              <div className="mt-0.5 text-[11px] text-ds-faint">
                {activeMode === 'digest'
                  ? t('paperRadarDigestStats', { high: resultCounts.high, medium: resultCounts.medium, low: resultCounts.low })
                  : t('paperRadarFound', { count: papers.length })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void copyDigest()}
              disabled={!papers.length}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-ds-border bg-ds-panel text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={t('paperRadarCopyDigest')}
              title={t('paperRadarCopyDigest')}
            >
              <Clipboard className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </div>
          {renderPaperGroups()}
        </section>
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="rounded-md bg-ds-sidebar px-2 py-2">
      <div className="text-[11px] font-semibold text-ds-faint">{label}</div>
      <div className="mt-1 text-[15px] font-semibold text-ds-ink">{value}</div>
    </div>
  )
}

function renderPaperCard(
  paper: PaperRadarRecord,
  openExternal: (url: string | undefined) => void,
  t: (key: string, options?: Record<string, unknown>) => string
): ReactElement {
  return (
    <article key={paper.id} className="rounded-md border border-ds-border bg-ds-panel p-3">
      <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ds-faint">
        <span>{paper.source}</span>
        <span>{paper.publishedAt}</span>
        {paper.relevance ? (
          <span className={relevanceClassName(paper.relevance)}>
            {t(`paperRadarRelevance${capitalize(paper.relevance)}`)}
          </span>
        ) : null}
        {typeof paper.score === 'number' ? <span>{Math.round(paper.score)}</span> : null}
      </div>
      <button
        type="button"
        onClick={() => openExternal(paper.absUrl)}
        className="mt-1 flex w-full items-start gap-2 text-left text-[13px] font-semibold leading-snug text-ds-ink transition hover:text-accent"
        title={paper.absUrl}
      >
        <span className="min-w-0 flex-1">{paper.title}</span>
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-65" strokeWidth={1.9} />
      </button>
      <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-ds-muted">{paper.abstract}</p>
      {paper.reason ? (
        <p className="mt-2 rounded-md bg-ds-hover px-2 py-1.5 text-[12px] leading-5 text-ds-ink">{paper.reason}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {[...paper.categories, ...paper.subjects].slice(0, 4).map((category) => (
          <span key={category} className="rounded bg-ds-hover px-1.5 py-0.5 text-[11px] text-ds-muted">
            {category}
          </span>
        ))}
        {paper.pdfUrl ? (
          <button
            type="button"
            onClick={() => openExternal(paper.pdfUrl)}
            className="ml-auto inline-flex items-center gap-1 rounded bg-ds-hover px-1.5 py-0.5 text-[11px] font-semibold text-ds-muted transition hover:text-accent"
            title={paper.pdfUrl}
          >
            <FileText className="h-3 w-3" strokeWidth={1.9} />
            PDF
          </button>
        ) : null}
      </div>
    </article>
  )
}

function parseList(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
}

function groupPapers(papers: PaperRadarRecord[]): Record<Relevance, PaperRadarRecord[]> {
  return {
    high: papers.filter((paper) => paper.relevance === 'high'),
    medium: papers.filter((paper) => paper.relevance === 'medium'),
    low: papers.filter((paper) => paper.relevance !== 'high' && paper.relevance !== 'medium')
  }
}

function syncMessage(results: PaperRadarSyncResult[], t: (key: string, options?: Record<string, unknown>) => string): string {
  const arxiv = results.find((item) => item.source === 'arxiv')
  const biorxiv = results.find((item) => item.source === 'biorxiv')
  return t('paperRadarSyncDone', {
    arxiv: arxiv?.upserted ?? 0,
    biorxiv: biorxiv?.upserted ?? 0
  })
}

function buildDigestMarkdown({
  profileName,
  days,
  generatedAt,
  papers,
  counts,
  t
}: {
  profileName: string
  days: number
  generatedAt: string | null
  papers: PaperRadarRecord[]
  counts: { high: number; medium: number; low: number }
  t: (key: string, options?: Record<string, unknown>) => string
}): string {
  const lines = [
    `# ${t('paperRadarDigestReportTitle')}`,
    '',
    `- ${t('paperRadarProfile')}: ${profileName}`,
    `- ${t('paperRadarDays')}: ${days}`,
    `- ${t('paperRadarGeneratedAt')}: ${generatedAt ?? new Date().toISOString()}`,
    `- ${t('paperRadarDigestStats', { high: counts.high, medium: counts.medium, low: counts.low })}`,
    ''
  ]
  for (const paper of papers) {
    lines.push(`## ${paper.title}`)
    lines.push('')
    lines.push(`- ${paper.source} ${paper.publishedAt}`)
    if (paper.relevance) lines.push(`- ${t('paperRadarRelevance')}: ${t(`paperRadarRelevance${capitalize(paper.relevance)}`)}`)
    if (paper.reason) lines.push(`- ${t('paperRadarReason')}: ${paper.reason}`)
    lines.push(`- ${paper.absUrl}`)
    if (paper.pdfUrl) lines.push(`- PDF: ${paper.pdfUrl}`)
    lines.push('')
  }
  return lines.join('\n')
}

function relevanceClassName(relevance: Relevance): string {
  if (relevance === 'high') return 'rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600'
  if (relevance === 'medium') return 'rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600'
  return 'rounded bg-ds-hover px-1.5 py-0.5 text-ds-muted'
}

function friendlyPaperRadarError(message: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (/No route for .*\/profiles|404|Not Found/i.test(message)) return t('paperRadarStaleService')
  if (/aborted|timed out|timeout/i.test(message)) return t('paperRadarTimeout')
  return message
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
