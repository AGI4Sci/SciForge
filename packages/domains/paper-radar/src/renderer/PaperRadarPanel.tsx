import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Clipboard,
  Database,
  ExternalLink,
  FileText,
  Search,
  Settings2,
  Sparkles,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  PaperRadarProfile,
  PaperRadarRecord,
  PaperRadarReviewInput,
  PaperRadarReviewResult,
  PaperRadarStatus,
  PaperRadarSyncResult
} from '../contract'
import type {
  PaperRadarCapabilityClient,
  PaperRadarMutationConfirmation
} from './paper-radar-capability-client'

export type PaperRadarOpenExternal = (url: string) => void | Promise<void>

export type PaperRadarPanelProps = {
  capabilityClient: PaperRadarCapabilityClient
  openExternal: PaperRadarOpenExternal
  className?: string
  onCollapse?: () => void
}

type Relevance = NonNullable<PaperRadarRecord['relevance']>

const DEFAULT_PROFILE_NAME = 'default'
const DEFAULT_KEYWORDS = ''
const DEFAULT_ARXIV_CATEGORIES = ''
const DEFAULT_BIORXIV_SUBJECTS = ''
const DEFAULT_DAYS = 7
const DEFAULT_TOP_K = 12
const REVIEW_TIMEOUT_MS = 35_000
const USER_CONFIRMED_MUTATION = Object.freeze({
  approval: Object.freeze({ mode: 'confirmation' as const })
}) satisfies PaperRadarMutationConfirmation

export function PaperRadarPanel({
  capabilityClient,
  openExternal,
  className = '',
  onCollapse
}: PaperRadarPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<PaperRadarStatus | null>(null)
  const [query, setQuery] = useState('')
  const [profiles, setProfiles] = useState<PaperRadarProfile[]>([])
  const [profileName, setProfileName] = useState(DEFAULT_PROFILE_NAME)
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS)
  const [excludeKeywords, setExcludeKeywords] = useState('')
  const [arxivCategories, setArxivCategories] = useState(DEFAULT_ARXIV_CATEGORIES)
  const [biorxivSubjects, setBiorxivSubjects] = useState(DEFAULT_BIORXIV_SUBJECTS)
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [papers, setPapers] = useState<PaperRadarRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [lastDigestAt, setLastDigestAt] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<PaperRadarSyncResult[] | null>(null)

  const keywordList = useMemo(() => parseList(keywords), [keywords])
  const excludeKeywordList = useMemo(() => parseList(excludeKeywords), [excludeKeywords])
  const arxivCategoryList = useMemo(() => parseList(arxivCategories), [arxivCategories])
  const biorxivSubjectList = useMemo(() => parseList(biorxivSubjects), [biorxivSubjects])

  const visiblePapers = useMemo(() => filterPapersByQuery(papers, query), [papers, query])
  const groupedPapers = useMemo(() => groupPapers(visiblePapers), [visiblePapers])
  const profileOptions = useMemo(() => dedupeProfileOptions(profiles), [profiles])
  const resultCounts = useMemo(() => ({
    high: groupedPapers.high.length,
    medium: groupedPapers.medium.length,
    low: groupedPapers.low.length
  }), [groupedPapers])

  const applyProfile = useCallback((profile: PaperRadarProfile): void => {
    setProfileName(publicProfileName(profile.name))
    setKeywords(profile.keywords.join(', '))
    setExcludeKeywords(profile.excludeKeywords.join(', '))
    setArxivCategories(profile.arxivCategories.join(', '))
    setBiorxivSubjects(profile.biorxivSubjects.join(', '))
  }, [])

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      const next = await capabilityClient.status()
      setStatus(next)
      if (!next.ok && next.message) setMessage(friendlyPaperRadarError(next.message, t))
    } catch (error) {
      setMessage(friendlyPaperRadarError(error instanceof Error ? error.message : String(error), t))
    }
  }, [capabilityClient, t])

  const loadProfiles = useCallback(async (selectedProfileName = DEFAULT_PROFILE_NAME): Promise<void> => {
    const result = await capabilityClient.listProfiles()
    if (!result.ok) {
      setMessage(friendlyPaperRadarError(result.message, t))
      return
    }
    setProfiles(result.data.profiles)
    const initial =
      result.data.profiles.find((item) => publicProfileName(item.name) === selectedProfileName) ??
      result.data.profiles[0]
    if (initial) applyProfile(initial)
  }, [applyProfile, capabilityClient, t])

  useEffect(() => {
    void refreshStatus()
    void loadProfiles().catch((error) => {
      setMessage(friendlyPaperRadarError(error instanceof Error ? error.message : String(error), t))
    })
  }, [loadProfiles, refreshStatus, t])

  const currentProfile = (): PaperRadarProfile => ({
    name: profileName || DEFAULT_PROFILE_NAME,
    keywords: keywordList,
    excludeKeywords: excludeKeywordList,
    arxivCategories: arxivCategoryList,
    biorxivSubjects: biorxivSubjectList
  })

  const saveCurrentProfile = async (): Promise<PaperRadarProfile> => {
    const result = await capabilityClient.saveProfile(currentProfile(), USER_CONFIRMED_MUTATION)
    if (!result.ok) throw new Error(friendlyPaperRadarError(result.message, t))
    await loadProfiles(profileName || DEFAULT_PROFILE_NAME)
    return result.data.profile
  }

  const reviewResults = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const outcome = await reviewPaperRadarWithFallback(capabilityClient, {
        profile: currentProfile(),
        days,
        topK: DEFAULT_TOP_K,
        maxRecords: 200
      }, USER_CONFIRMED_MUTATION, REVIEW_TIMEOUT_MS, (localData) => {
        setPapers(localData.papers)
        setLastDigestAt(localData.generatedAt)
        setLastSync(null)
        setMessage(`${t('paperRadarLocalWhileSyncing', { total: status?.stats?.papers ?? 0 })} ${t('paperRadarDigestDone', { count: localData.count })}`)
      })
      setPapers(outcome.data.papers)
      setLastDigestAt(outcome.data.generatedAt)
      setLastSync(outcome.usedLocalFallback ? null : outcome.data.syncResults)
      setMessage(outcome.usedLocalFallback
        ? `${t('paperRadarLocalFallback', { total: status?.stats?.papers ?? 0 })} ${t('paperRadarDigestDone', { count: outcome.data.count })}`
        : `${syncMessage(outcome.data.syncResults, t)} ${t('paperRadarDigestDone', { count: outcome.data.count })}`)
      await loadProfiles(profileName || DEFAULT_PROFILE_NAME)
      await refreshStatus()
    } catch (error) {
      setMessage(friendlyPaperRadarError(error instanceof Error ? error.message : String(error), t))
    } finally {
      setBusy(false)
    }
  }

  const copyDigest = async (): Promise<void> => {
    const text = buildDigestMarkdown({
      profileName,
      days,
      generatedAt: lastDigestAt,
      papers: visiblePapers,
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

  const handleOpenExternal = useCallback((url: string | undefined): void => {
    if (!url) return
    void Promise.resolve(openExternal(url)).catch(() => undefined)
  }, [openExternal])

  const renderPaperGroups = (): ReactElement => {
    if (!visiblePapers.length) {
      return (
        <div className="rounded-md border border-dashed border-ds-border px-3 py-8 text-center text-[13px] text-ds-faint">
          {papers.length ? t('paperRadarFilterEmpty') : t('paperRadarEmpty')}
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
              {items.map((paper) => renderPaperCard(paper, handleOpenExternal, t))}
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
            onClick={() => void reviewResults()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Sparkles className={`h-4 w-4 ${busy ? 'animate-pulse' : ''}`} strokeWidth={1.9} />
            {busy ? t('paperRadarReviewBusy') : t('paperRadarReviewResults')}
          </button>
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
                const next = profiles.find((item) => publicProfileName(item.name) === event.target.value)
                if (next) applyProfile(next)
                else setProfileName(event.target.value)
              }}
              className="min-w-0 flex-1 rounded-md border border-ds-border bg-ds-sidebar px-3 py-2 text-[13px] font-normal text-ds-ink outline-none transition focus:border-accent"
            >
              {profileOptions.map((profile) => (
                <option key={profile.name} value={profile.name}>{profile.name}</option>
              ))}
              {profileOptions.every((profile) => profile.name !== profileName) ? (
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
            {t('paperRadarFilterResults')}
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-ds-border bg-ds-sidebar px-3 py-2 text-[13px] font-normal text-ds-ink outline-none transition focus:border-accent"
              />
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-ds-border bg-ds-sidebar text-ds-muted">
                <Search className="h-4 w-4" strokeWidth={1.9} />
              </div>
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
                {t('paperRadarDigestResults')}
              </div>
              <div className="mt-0.5 text-[11px] text-ds-faint">
                {query.trim()
                  ? t('paperRadarVisibleCount', { visible: visiblePapers.length, total: papers.length })
                  : t('paperRadarDigestStats', { high: resultCounts.high, medium: resultCounts.medium, low: resultCounts.low })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void copyDigest()}
              disabled={!visiblePapers.length}
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

function publicProfileName(name: string): string {
  return name === 'lab_default' ? DEFAULT_PROFILE_NAME : name
}

function dedupeProfileOptions(profiles: PaperRadarProfile[]): Array<{ name: string }> {
  const seen = new Set<string>()
  const options: Array<{ name: string }> = []
  for (const profile of profiles) {
    const name = publicProfileName(profile.name)
    if (seen.has(name)) continue
    seen.add(name)
    options.push({ name })
  }
  return options
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

export function filterPapersByQuery(papers: PaperRadarRecord[], query: string): PaperRadarRecord[] {
  const terms = parseList(query.toLowerCase())
  if (!terms.length) return papers
  return papers.filter((paper) => {
    const haystack = [
      paper.title,
      paper.abstract,
      paper.source,
      paper.externalId,
      paper.publishedAt,
      paper.reason ?? '',
      ...paper.authors,
      ...paper.categories,
      ...paper.subjects
    ].join('\n').toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

export async function withPaperRadarTimeout<T>(
  operation: Promise<T>,
  timeoutMs = REVIEW_TIMEOUT_MS
): Promise<T> {
  const normalizedTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.floor(timeoutMs))
    : REVIEW_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Paper Radar review timed out after ${normalizedTimeoutMs} ms.`))
        }, normalizedTimeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type PaperRadarReviewClient = Pick<PaperRadarCapabilityClient, 'review' | 'saveProfile' | 'digest'>

export type PaperRadarReviewOutcome = Readonly<{
  data: PaperRadarReviewResult
  usedLocalFallback: boolean
}>

export async function reviewPaperRadarWithFallback(
  capabilityClient: PaperRadarReviewClient,
  input: PaperRadarReviewInput,
  confirmation: PaperRadarMutationConfirmation,
  timeoutMs = REVIEW_TIMEOUT_MS,
  onLocalResults?: (data: PaperRadarReviewResult) => void
): Promise<PaperRadarReviewOutcome> {
  let localData: PaperRadarReviewResult | undefined
  try {
    const saved = await capabilityClient.saveProfile(input.profile, confirmation)
    if (!saved.ok) throw new Error(saved.message)
    const digest = await capabilityClient.digest({
      profile: saved.data.profile.name,
      keywords: input.profile.keywords,
      excludeKeywords: input.profile.excludeKeywords,
      days: input.days,
      topK: input.topK
    })
    if (!digest.ok) throw new Error(digest.message)
    localData = { ...digest.data, syncResults: [] }
    onLocalResults?.(localData)
  } catch {
    // A failed local preview should not prevent the canonical review from succeeding.
  }

  try {
    const result = await withPaperRadarTimeout(
      capabilityClient.review(input, confirmation),
      timeoutMs
    )
    if (!result.ok) throw new Error(result.message)
    return { data: result.data, usedLocalFallback: false }
  } catch (syncError) {
    if (localData) {
      return {
        data: localData,
        usedLocalFallback: true
      }
    }
    throw syncError
  }
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
