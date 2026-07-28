import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  FolderOpen,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings
} from 'lucide-react'
import {
  joinFsPath,
  loadPreferredSkillRootId,
  savePreferredSkillRootId,
  type SkillRootId
} from '../lib/skill-root-preference'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import type {
  ScientificSkillsInstallRequest,
  ScientificSkillsStatusResult,
  SkillListItem
} from '@shared/sciforge-api'
import { useChatStore } from '../store/chat-store'
import { NoticeView, type MarketplaceNotice } from './PluginMarketplaceParts'
import {
  ExtensionCatalog,
  extensionCatalogItemsFromSummaries,
  type ExtensionCatalogItem
} from './extensions/ExtensionCatalog'

type SkillFilter = 'all' | 'recommended' | 'installed'
type ExtensionCenterTab = 'extensions' | 'skills'

export type SkillCatalogItem = {
  id: string
  kind: 'skill'
  titleKey?: string
  descriptionKey?: string
  title?: string
  description?: string
  group: 'recommended' | 'personal'
  sourceLabel?: string
  statusTone?: 'default' | 'success' | 'warning' | 'error'
  skillInstructions?: string
}

type SkillRootOption = {
  id: SkillRootId
  label: string
  path: string
  available: boolean
}

type ScientificSkillsStatusOk = Extract<ScientificSkillsStatusResult, { ok: true }>
type ScientificSkillsInstallBackend = NonNullable<ScientificSkillsInstallRequest['backend']>

export function scientificSkillsInstallTargetForWorkspace(workspaceRoot: string): string {
  return workspaceRoot
    ? joinFsPath(workspaceRoot, '.agents/skills/scientific-agent-skills')
    : ''
}

function normalizeSkillId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildSkillContent(id: string, title: string, description: string, instructions: string): string {
  return [
    '---',
    `name: ${id}`,
    `description: ${description}`,
    '---',
    '',
    `# ${title}`,
    '',
    instructions
  ].join('\n')
}

function skillItemKey(id: string): string {
  return `skill:${id}`
}

function itemTitle(item: SkillCatalogItem, t: (key: string) => string): string {
  return item.title ?? (item.titleKey ? t(item.titleKey) : item.id)
}

function itemDescription(item: SkillCatalogItem, t: (key: string) => string): string {
  return item.description ?? (item.descriptionKey ? t(item.descriptionKey) : '')
}

export function skillCatalogItemsFromDiscoveredSkills(
  skills: SkillListItem[],
  labels: { project: string; global: string }
): SkillCatalogItem[] {
  return skills.map((skill) => ({
    id: skill.id,
    kind: 'skill' as const,
    title: skill.name,
    description: skill.description ?? skill.root,
    group: 'personal' as const,
    sourceLabel: skill.scope === 'project' ? labels.project : labels.global
  }))
}

function skillNameLooksValid(raw: string): boolean {
  const value = raw.trim()
  return !!value && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

function extensionOperationMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const message = error.message.replace(/^Error invoking remote method '[^']+':\s*/i, '').trim()
  return message || fallback
}

export const RECOMMENDED_SKILL_ITEMS: readonly SkillCatalogItem[] = [
  {
    id: 'code-review',
    kind: 'skill',
    titleKey: 'pluginSkillReviewTitle',
    descriptionKey: 'pluginSkillReviewDesc',
    group: 'recommended',
    skillInstructions:
      'Use this skill when reviewing a code change. Prioritize correctness, regressions, security, performance, and missing tests. Lead with concrete findings and file references.'
  },
  {
    id: 'frontend-polish',
    kind: 'skill',
    titleKey: 'pluginSkillFrontendTitle',
    descriptionKey: 'pluginSkillFrontendDesc',
    group: 'recommended',
    skillInstructions:
      'Use this skill when improving UI. Preserve the product style, check responsive states, avoid generic layouts, and verify the result visually before handing it back.'
  },
  {
    id: 'bug-hunt',
    kind: 'skill',
    titleKey: 'pluginSkillBugTitle',
    descriptionKey: 'pluginSkillBugDesc',
    group: 'recommended',
    skillInstructions:
      'Use this skill when investigating bugs. Reproduce or narrow the symptom, trace the data flow, identify the smallest fix, and add focused verification where possible.'
  },
  {
    id: 'release-notes',
    kind: 'skill',
    titleKey: 'pluginSkillReleaseTitle',
    descriptionKey: 'pluginSkillReleaseDesc',
    group: 'recommended',
    skillInstructions:
      'Use this skill when preparing release notes. Group user-facing changes by outcome, call out migrations or risks, and keep wording concise and scannable.'
  }
]

export function PluginMarketplaceView(): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = normalizeWorkspaceRoot(useChatStore((s) => s.workspaceRoot))
  const [activeTab, setActiveTab] = useState<ExtensionCenterTab>('extensions')
  const [extensionItems, setExtensionItems] = useState<ExtensionCatalogItem[] | null>(null)
  const [extensionsLoading, setExtensionsLoading] = useState(false)
  const [extensionsError, setExtensionsError] = useState('')
  const [busyExtension, setBusyExtension] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<MarketplaceNotice | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customSkillBody, setCustomSkillBody] = useState('')
  const [skillRootId, setSkillRootId] = useState<SkillRootId>(() => loadPreferredSkillRootId())
  const [discoveredSkills, setDiscoveredSkills] = useState<SkillListItem[]>([])
  const [skillListLoading, setSkillListLoading] = useState(false)
  const [skillListError, setSkillListError] = useState('')
  const [scientificSkillsStatus, setScientificSkillsStatus] = useState<ScientificSkillsStatusOk | null>(null)
  const [scientificSkillsLoading, setScientificSkillsLoading] = useState(false)
  const [scientificSkillsError, setScientificSkillsError] = useState('')
  const [scientificSkillsInstallOpen, setScientificSkillsInstallOpen] = useState(false)
  const [scientificSkillsInstallBackend, setScientificSkillsInstallBackend] =
    useState<ScientificSkillsInstallBackend>('git')
  const [scientificSkillsInstalling, setScientificSkillsInstalling] = useState(false)
  const [scientificSkillsInstallError, setScientificSkillsInstallError] = useState('')

  const refreshExtensions = useCallback(async (): Promise<void> => {
    setExtensionsLoading(true)
    try {
      const summaries = await window.sciforge.extensions.list()
      setExtensionItems(extensionCatalogItemsFromSummaries(summaries))
      setExtensionsError('')
    } catch (error) {
      setExtensionsError(extensionOperationMessage(error, t('extensionListFailed')))
    } finally {
      setExtensionsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refreshExtensions()
  }, [refreshExtensions])

  const installExtension = useCallback(async (): Promise<void> => {
    const selection = await window.sciforge.pickFile({
      title: t('extensionInstallPickerTitle'),
      filters: [
        { name: 'SciForge extension', extensions: ['sciforge-plugin'] }
      ]
    })
    if (selection.canceled || !selection.path) return
    setBusyExtension('__install__')
    setExtensionsError('')
    try {
      await window.sciforge.extensions.install({ path: selection.path })
      await refreshExtensions()
    } catch (error) {
      setExtensionsError(extensionOperationMessage(error, t('extensionInstallFailed')))
    } finally {
      setBusyExtension(null)
    }
  }, [refreshExtensions, t])

  const setExtensionEnabled = useCallback(async (
    extension: ExtensionCatalogItem,
    enabled: boolean
  ): Promise<void> => {
    setBusyExtension(extension.packageName)
    setExtensionsError('')
    try {
      await window.sciforge.extensions.setEnabled({
        packageName: extension.packageName,
        enabled
      })
      await refreshExtensions()
    } catch (error) {
      setExtensionsError(extensionOperationMessage(error, t('extensionStateFailed')))
    } finally {
      setBusyExtension(null)
    }
  }, [refreshExtensions, t])

  const rollbackExtension = useCallback(async (
    extension: ExtensionCatalogItem
  ): Promise<void> => {
    setBusyExtension(extension.packageName)
    setExtensionsError('')
    try {
      await window.sciforge.extensions.rollback({ packageName: extension.packageName })
      await refreshExtensions()
    } catch (error) {
      setExtensionsError(extensionOperationMessage(error, t('extensionRollbackFailed')))
    } finally {
      setBusyExtension(null)
    }
  }, [refreshExtensions, t])

  const uninstallExtension = useCallback(async (
    extension: ExtensionCatalogItem
  ): Promise<void> => {
    if (!window.confirm(t('extensionUninstallConfirm', { name: extension.displayName }))) return
    setBusyExtension(extension.packageName)
    setExtensionsError('')
    try {
      await window.sciforge.extensions.uninstall({ packageName: extension.packageName })
      await refreshExtensions()
    } catch (error) {
      setExtensionsError(extensionOperationMessage(error, t('extensionUninstallFailed')))
    } finally {
      setBusyExtension(null)
    }
  }, [refreshExtensions, t])

  const skillRootOptions = useMemo<SkillRootOption[]>(() => {
    const hasWorkspace = !!workspaceRoot
    return [
      {
        id: 'workspace-agents',
        label: t('pluginSkillRootWorkspaceAgents'),
        path: workspaceRoot ? joinFsPath(workspaceRoot, '.agents/skills') : '',
        available: hasWorkspace
      },
      {
        id: 'workspace-skills',
        label: t('pluginSkillRootWorkspaceSkills'),
        path: workspaceRoot ? joinFsPath(workspaceRoot, 'skills') : '',
        available: hasWorkspace
      },
      {
        id: 'global-agents',
        label: t('pluginSkillRootGlobalAgents'),
        path: '~/.agents/skills',
        available: true
      },
      {
        id: 'global-sciforge',
        label: t('pluginSkillRootGlobalSciforge'),
        path: '~/.sciforge/skills',
        available: true
      }
    ]
  }, [t, workspaceRoot])

  const selectedSkillRoot =
    skillRootOptions.find((option) => option.id === skillRootId && option.available) ??
    skillRootOptions.find((option) => option.available)

  useEffect(() => {
    const selectedOption = skillRootOptions.find((option) => option.id === skillRootId && option.available)
    if (selectedOption) {
      savePreferredSkillRootId(skillRootId)
      return
    }
    const fallback = skillRootOptions.find((option) => option.available)
    if (fallback && fallback.id !== skillRootId) {
      setSkillRootId(fallback.id)
    }
  }, [skillRootId, skillRootOptions])

  const refreshScientificSkillsStatus = useCallback(async (): Promise<void> => {
    if (typeof window.sciforge?.getScientificSkillsStatus !== 'function') {
      setScientificSkillsStatus(null)
      setScientificSkillsError(t('pluginScientificSkillsUnavailable'))
      return
    }
    setScientificSkillsLoading(true)
    setScientificSkillsError('')
    try {
      const result = await window.sciforge.getScientificSkillsStatus(workspaceRoot || undefined)
      if (!result.ok) {
        setScientificSkillsStatus(null)
        setScientificSkillsError(result.message)
        return
      }
      setScientificSkillsStatus(result)
    } catch (error) {
      setScientificSkillsStatus(null)
      setScientificSkillsError(error instanceof Error ? error.message : String(error))
    } finally {
      setScientificSkillsLoading(false)
    }
  }, [t, workspaceRoot])

  useEffect(() => {
    void refreshScientificSkillsStatus()
  }, [refreshScientificSkillsStatus])

  const scientificSkillsInstallTarget = scientificSkillsInstallTargetForWorkspace(workspaceRoot)

  const installScientificSkills = useCallback(async (): Promise<void> => {
    if (!workspaceRoot) {
      setScientificSkillsInstallError(t('pluginScientificSkillsInstallWorkspaceRequired'))
      return
    }
    if (typeof window.sciforge?.installScientificSkills !== 'function') {
      setScientificSkillsInstallError(t('pluginScientificSkillsInstallUnavailable'))
      return
    }
    setScientificSkillsInstalling(true)
    setScientificSkillsInstallError('')
    try {
      const result = await window.sciforge.installScientificSkills({
        workspaceRoot,
        backend: scientificSkillsInstallBackend,
        ref: 'main'
      })
      if (!result.ok) {
        setScientificSkillsInstallError(result.message)
        return
      }
      setScientificSkillsInstallOpen(false)
      setNotice({
        tone: 'success',
        message: t(
          result.status === 'already_installed'
            ? 'pluginScientificSkillsInstallAlready'
            : 'pluginScientificSkillsInstallSuccess',
          { path: result.targetPath }
        )
      })
      await refreshScientificSkillsStatus()
    } catch (error) {
      setScientificSkillsInstallError(error instanceof Error ? error.message : String(error))
    } finally {
      setScientificSkillsInstalling(false)
    }
  }, [refreshScientificSkillsStatus, scientificSkillsInstallBackend, t, workspaceRoot])

  const refreshSkillList = useCallback(async (): Promise<void> => {
    if (typeof window.sciforge?.listSkills !== 'function') {
      setDiscoveredSkills([])
      setSkillListError(t('pluginSkillScanUnavailable'))
      return
    }
    setSkillListLoading(true)
    setSkillListError('')
    try {
      const result = await window.sciforge.listSkills(workspaceRoot || undefined)
      if (!result.ok) {
        setDiscoveredSkills([])
        setSkillListError(result.message)
        return
      }
      setDiscoveredSkills(result.skills)
      if (result.validationErrors.length > 0) {
        setSkillListError(result.validationErrors[0]?.message ?? t('pluginSkillScanPartial'))
      }
    } catch (error) {
      setDiscoveredSkills([])
      setSkillListError(error instanceof Error ? error.message : String(error))
    } finally {
      setSkillListLoading(false)
    }
  }, [t, workspaceRoot])

  useEffect(() => {
    void refreshSkillList()
  }, [refreshSkillList])

  const discoveredSkillIds = useMemo(
    () => new Set(discoveredSkills.map((skill) => skill.id)),
    [discoveredSkills]
  )
  const discoveredSkillItems = useMemo(
    () => skillCatalogItemsFromDiscoveredSkills(discoveredSkills, {
      project: t('pluginSkillSourceProject'),
      global: t('pluginSkillSourceGlobal')
    }),
    [discoveredSkills, t]
  )
  const skillItems = useMemo(
    () => [...RECOMMENDED_SKILL_ITEMS, ...discoveredSkillItems],
    [discoveredSkillItems]
  )

  const isInstalled = useCallback(
    (item: Pick<SkillCatalogItem, 'id'>): boolean => discoveredSkillIds.has(item.id),
    [discoveredSkillIds]
  )

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return skillItems.filter((item) => {
        const title = itemTitle(item, t).toLowerCase()
        const description = itemDescription(item, t).toLowerCase()
        const source = item.sourceLabel?.toLowerCase() ?? ''
        return !normalizedQuery ||
          title.includes(normalizedQuery) ||
          description.includes(normalizedQuery) ||
          source.includes(normalizedQuery) ||
          item.id.includes(normalizedQuery)
      })
      .filter((item) => {
        if (filter === 'recommended') return item.group === 'recommended'
        if (filter === 'installed') return isInstalled(item)
        return true
      })
  }, [filter, isInstalled, query, skillItems, t])

  const recommendedItems = visibleItems.filter((item) => item.group === 'recommended' && !isInstalled(item))
  const personalItems = visibleItems.filter((item) => item.group === 'personal')

  const addItem = async (item: SkillCatalogItem): Promise<void> => {
    setBusyId(skillItemKey(item.id))
    setNotice(null)
    try {
      if (!selectedSkillRoot?.path) {
        setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
        return
      }
      if (item.group === 'personal') return
      const title = itemTitle(item, t)
      const description = itemDescription(item, t)
      const content = buildSkillContent(
        item.id,
        title,
        description,
        item.skillInstructions ?? description
      )
      const result = await window.sciforge.saveSkillFile(selectedSkillRoot.path, item.id, content)
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.message })
        return
      }
      await refreshSkillList()
      setNotice({ tone: 'success', message: t('pluginSkillAdded', { path: result.path }) })
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyId(null)
    }
  }

  const addCustom = async (): Promise<void> => {
    const id = normalizeSkillId(customName)
    if (!id) {
      setNotice({ tone: 'error', message: t('pluginCustomNameRequired') })
      return
    }
    const description = customDescription.trim() || t('pluginCustomFallbackDesc')
    setBusyId('custom:skill')
    setNotice(null)
    try {
      if (!selectedSkillRoot?.path) {
        setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
        return
      }
      const body = customSkillBody.trim() || t('pluginCustomSkillFallbackBody')
      const content = buildSkillContent(id, customName.trim() || id, description, body)
      const result = await window.sciforge.saveSkillFile(selectedSkillRoot.path, id, content)
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.message })
        return
      }
      await refreshSkillList()
      setNotice({ tone: 'success', message: t('pluginSkillAdded', { path: result.path }) })
      setCustomName('')
      setCustomDescription('')
      setCustomSkillBody('')
      setCustomOpen(false)
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyId(null)
    }
  }

  const openManageTarget = async (): Promise<void> => {
    try {
      if (!selectedSkillRoot?.path) {
        setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
        return
      }
      const result = await window.sciforge.openSkillRoot(selectedSkillRoot.path)
      if (!result.ok) setNotice({ tone: 'error', message: result.message ?? t('pluginActionFailed') })
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="ds-no-drag h-full min-h-0 overflow-y-auto px-6 py-7 md:px-10 lg:px-14">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-[30px] font-semibold text-ds-ink md:text-[36px]">
              {t('extensionCenterTitle')}
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-ds-muted">
              {t('extensionCenterDescription')}
            </p>
          </div>
          {activeTab === 'skills' ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void openManageTarget()}
                className="inline-flex items-center gap-2 rounded-xl bg-ds-subtle px-3 py-2 text-[13px] font-semibold text-ds-ink transition hover:bg-ds-hover"
              >
                <Settings className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                {t('pluginManageSkills')}
              </button>
              <button
                type="button"
                onClick={() => setCustomOpen((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                {t('pluginCreateSkill')}
              </button>
            </div>
          ) : null}
        </header>

        <div
          role="tablist"
          aria-label={t('extensionCenterNavigation')}
          className="mt-7 flex gap-1 border-b border-ds-border-muted"
        >
          {(['extensions', 'skills'] as const).map((tab) => {
            const selected = activeTab === tab
            return (
              <button
                key={tab}
                id={`extension-center-${tab}-tab`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`extension-center-${tab}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                  event.preventDefault()
                  const nextTab = event.key === 'Home'
                    ? 'extensions'
                    : event.key === 'End'
                      ? 'skills'
                      : tab === 'extensions'
                        ? 'skills'
                        : 'extensions'
                  setActiveTab(nextTab)
                  requestAnimationFrame(() => {
                    document.getElementById(`extension-center-${nextTab}-tab`)?.focus()
                  })
                }}
                className={`border-b-2 px-4 py-3 text-[14px] font-semibold transition ${
                  selected
                    ? 'border-[var(--ds-accent)] text-ds-ink'
                    : 'border-transparent text-ds-muted hover:text-ds-ink'
                }`}
              >
                {t(tab === 'extensions' ? 'extensionTabExtensions' : 'extensionTabSkills')}
              </button>
            )
          })}
        </div>

        {activeTab === 'extensions' ? (
          <ExtensionCatalog
            extensions={extensionItems ?? undefined}
            loading={extensionsLoading}
            error={extensionsError}
            busyPackageName={busyExtension}
            onInstall={() => void installExtension()}
            onSetEnabled={(extension, enabled) => void setExtensionEnabled(extension, enabled)}
            onRollback={(extension) => void rollbackExtension(extension)}
            onUninstall={(extension) => void uninstallExtension(extension)}
          />
        ) : (
          <section
            id="extension-center-skills-panel"
            role="tabpanel"
            aria-labelledby="extension-center-skills-tab"
          >
            <div className="mt-7">
              <h2 className="text-[24px] font-semibold text-ds-ink">{t('pluginSkillTitle')}</h2>
              <p className="mt-1 text-[13px] leading-5 text-ds-muted">
                {t('pluginSkillPageDescription')}
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{t('pluginSearchSkill')}</span>
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-faint"
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-ds-border bg-ds-card pl-11 pr-4 text-[15px] text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
                  placeholder={t('pluginSearchSkill')}
                />
              </label>
              <label className="relative w-full md:w-[168px]">
                <span className="sr-only">{t('pluginSkillFilterLabel')}</span>
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as SkillFilter)}
                  className="h-11 w-full appearance-none rounded-2xl border border-ds-border bg-ds-card px-4 pr-9 text-[15px] font-medium text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
                >
                  <option value="all">{t('pluginFilterAll')}</option>
                  <option value="recommended">{t('pluginFilterRecommended')}</option>
                  <option value="installed">{t('pluginFilterInstalled')}</option>
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-faint"
                  aria-hidden="true"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
              <select
                value={selectedSkillRoot?.id ?? ''}
                aria-label={t('pluginSkillRootLabel')}
                onChange={(event) => setSkillRootId(event.target.value as SkillRootId)}
                className="h-10 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink shadow-sm outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
              >
                {skillRootOptions.map((option) => (
                  <option key={option.id} value={option.id} disabled={!option.available}>
                    {option.available ? option.label : `${option.label} · ${t('pluginSkillRootNeedsWorkspace')}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void openManageTarget()}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
              >
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
                {t('pluginOpenLocation')}
              </button>
              <button
                type="button"
                onClick={() => void refreshSkillList()}
                disabled={skillListLoading}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {skillListLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                )}
                {t('pluginSkillRefresh')}
              </button>
              {skillListError ? (
                <span className="text-[12px] text-red-700 dark:text-red-300">
                  {skillListError}
                </span>
              ) : (
                <span className="text-[12px] text-ds-faint">
                  {t('pluginSkillDiscoveredCount', { count: discoveredSkills.length })}
                </span>
              )}
            </div>

            <ScientificSkillsStatusPanel
              status={scientificSkillsStatus}
              loading={scientificSkillsLoading}
              error={scientificSkillsError}
              installTarget={scientificSkillsInstallTarget}
              installDisabled={!workspaceRoot || scientificSkillsInstalling}
              onRefresh={() => void refreshScientificSkillsStatus()}
              onInstall={() => {
                setScientificSkillsInstallError('')
                setScientificSkillsInstallOpen(true)
              }}
              t={t}
            />

            {customOpen ? (
              <CustomSkillPanel
                customName={customName}
                customDescription={customDescription}
                customSkillBody={customSkillBody}
                busy={busyId === 'custom:skill'}
                onNameChange={setCustomName}
                onDescriptionChange={setCustomDescription}
                onSkillBodyChange={setCustomSkillBody}
                onAdd={() => void addCustom()}
              />
            ) : null}

            {notice ? <NoticeView notice={notice} /> : null}

            {scientificSkillsInstallOpen ? (
              <ScientificSkillsInstallDialog
                backend={scientificSkillsInstallBackend}
                error={scientificSkillsInstallError}
                installing={scientificSkillsInstalling}
                targetPath={scientificSkillsInstallTarget}
                onBackendChange={setScientificSkillsInstallBackend}
                onCancel={() => {
                  if (!scientificSkillsInstalling) setScientificSkillsInstallOpen(false)
                }}
                onConfirm={() => void installScientificSkills()}
                t={t}
              />
            ) : null}

            <SkillSection
              title={t('pluginSkillTemplates')}
              emptyText={t('pluginNoSkillResults')}
              items={recommendedItems}
              busyId={busyId}
              isInstalled={isInstalled}
              onAdd={addItem}
              t={t}
            />

            <SkillSection
              title={t('pluginPersonalSkills')}
              emptyText={t('pluginPersonalSkillEmpty')}
              items={personalItems}
              busyId={busyId}
              isInstalled={isInstalled}
              onAdd={addItem}
              t={t}
            />
          </section>
        )}
      </div>
    </div>
  )
}

function ScientificSkillsStatusPanel({
  status,
  loading,
  error,
  installTarget,
  installDisabled,
  onRefresh,
  onInstall,
  t
}: {
  status: ScientificSkillsStatusOk | null
  loading: boolean
  error: string
  installTarget: string
  installDisabled: boolean
  onRefresh: () => void
  onInstall: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const installedRoots = status?.roots.filter((root) => root.exists && root.skillCount > 0) ?? []
  const visibleRoots = installedRoots.length > 0
    ? installedRoots
    : status?.roots.filter((root) => root.exists).slice(0, 3) ?? []
  const availablePack = status?.plottingPack.installed ?? 0
  const totalPack = status?.plottingPack.total ?? 0
  const statusTone = status?.installed
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
  const missingPlottingPack = (status?.plottingPack.missing ?? 0) > 0
  const showInstallCta = !status?.installed || missingPlottingPack

  return (
    <section className="mt-4 rounded-lg border border-ds-border bg-ds-card px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-ds-ink">{t('pluginScientificSkillsPanelTitle')}</span>
            <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}>
              {status?.installed ? t('pluginScientificSkillsInstalled') : t('pluginScientificSkillsMissing')}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ds-muted">
            <span>{t('pluginScientificSkillsCount', { count: status?.skillCount ?? 0 })}</span>
            <span>{t('pluginScientificSkillsPlottingPackCount', { available: availablePack, total: totalPack })}</span>
            {status?.fingerprint ? <span>{t('pluginScientificSkillsFingerprint', { fingerprint: status.fingerprint })}</span> : null}
          </div>
          {status?.plottingPack.items.length ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {status.plottingPack.items.map((item) => (
                <div
                  key={item.skillId}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-ds-border-muted bg-ds-subtle px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-ds-ink">{item.label}</div>
                    <div className="truncate font-mono text-[11px] text-ds-faint">{item.skillId}</div>
                  </div>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${
                    item.installed
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
                      : 'bg-ds-card text-ds-faint'
                  }`}>
                    {item.installed ? t('pluginScientificSkillsPackAvailable') : t('pluginScientificSkillsPackMissing')}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {visibleRoots.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {visibleRoots.map((root) => (
                <span
                  key={`${root.source}:${root.path}`}
                  className="rounded-md border border-ds-border-muted bg-ds-subtle px-2 py-0.5 font-mono text-[11px] text-ds-muted"
                  title={scientificSkillsRootSourceTitle(root.source, root.path, t)}
                >
                  {scientificSkillsRootSourceLabel(root.source, t)} · {root.skillCount}
                </span>
              ))}
            </div>
          ) : null}
          {error || status?.validationErrors.length ? (
            <div className="mt-2 truncate text-[12px] text-red-700 dark:text-red-300">
              {error || status?.validationErrors[0]?.message}
            </div>
          ) : null}
          {!status?.installed && status?.installHint ? (
            <div className="mt-2 text-[12px] leading-5 text-ds-muted">
              {status.installHint}
            </div>
          ) : null}
          {showInstallCta ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              {t('pluginScientificSkillsInstallSuggestion')}
              {installTarget ? (
                <span className="ml-1 font-mono text-[11px]">{installTarget}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-ds-border bg-ds-subtle px-3 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t('pluginScientificSkillsRefresh')}
          </button>
          {showInstallCta ? (
            <button
              type="button"
              onClick={onInstall}
              disabled={installDisabled}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--ds-accent)] px-3 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {t(status?.installed ? 'pluginScientificSkillsRepair' : 'pluginScientificSkillsInstall')}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function ScientificSkillsInstallDialog({
  backend,
  error,
  installing,
  targetPath,
  onBackendChange,
  onCancel,
  onConfirm,
  t
}: {
  backend: ScientificSkillsInstallBackend
  error: string
  installing: boolean
  targetPath: string
  onBackendChange: (backend: ScientificSkillsInstallBackend) => void
  onCancel: () => void
  onConfirm: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6">
      <section className="w-full max-w-xl rounded-lg border border-ds-border bg-ds-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-semibold text-ds-ink">{t('pluginScientificSkillsInstallTitle')}</h3>
            <p className="mt-1 text-[12px] leading-5 text-ds-muted">
              {t(
                backend === 'npx'
                  ? 'pluginScientificSkillsInstallBodyNpx'
                  : 'pluginScientificSkillsInstallBody'
              )}
            </p>
          </div>
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ds-faint" />
        </div>
        <div className="mt-4 grid gap-3 text-[12px]">
          <div className="rounded-md border border-ds-border-muted bg-ds-subtle px-3 py-2">
            <div className="font-semibold text-ds-ink">{t('pluginScientificSkillsInstallRepo')}</div>
            <div className="mt-1 break-all font-mono text-[11px] text-ds-muted">
              https://github.com/K-Dense-AI/scientific-agent-skills.git
            </div>
          </div>
          <div className="rounded-md border border-ds-border-muted bg-ds-subtle px-3 py-2">
            <div className="font-semibold text-ds-ink">
              {t(
                backend === 'npx'
                  ? 'pluginScientificSkillsInstallDiscoveryTarget'
                  : 'pluginScientificSkillsInstallTarget'
              )}
            </div>
            <div className="mt-1 break-all font-mono text-[11px] text-ds-muted">
              {targetPath || t('pluginScientificSkillsInstallWorkspaceRequired')}
            </div>
          </div>
          <label className="grid gap-1">
            <span className="font-semibold text-ds-ink">{t('pluginScientificSkillsInstallBackend')}</span>
            <select
              value={backend}
              disabled={installing}
              onChange={(event) => onBackendChange(event.target.value as ScientificSkillsInstallBackend)}
              className="h-9 rounded-lg border border-ds-border bg-ds-card px-3 text-[12px] text-ds-ink outline-none transition focus:border-[var(--ds-accent)]"
            >
              <option value="git">{t('pluginScientificSkillsInstallBackendGit')}</option>
              <option value="npx">{t('pluginScientificSkillsInstallBackendNpx')}</option>
            </select>
          </label>
          <div className="rounded-md border border-ds-border-muted bg-ds-subtle px-3 py-2 text-ds-muted">
            {t(
              backend === 'npx'
                ? 'pluginScientificSkillsInstallPolicyNpx'
                : 'pluginScientificSkillsInstallPolicy'
            )}
          </div>
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
              {error}
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={installing}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-ds-border bg-ds-card px-3 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('pluginScientificSkillsInstallCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={installing || !targetPath}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--ds-accent)] px-3 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t('pluginScientificSkillsInstallConfirm')}
          </button>
        </div>
      </section>
    </div>
  )
}

export function scientificSkillsRootSourceLabel(
  source: string,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  switch (source) {
    case 'env':
      return t('pluginScientificSkillsRootEnv')
    case 'workspace-agents':
      return t('pluginScientificSkillsRootWorkspaceAgents')
    case 'workspace-skills':
      return t('pluginScientificSkillsRootWorkspaceSkills')
    case 'global-agents':
      return t('pluginScientificSkillsRootGlobalAgents')
    default:
      return source
  }
}

export function scientificSkillsRootSourceTitle(
  source: string,
  path: string,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  return path
}

function skillSourceTone(tone: SkillCatalogItem['statusTone']): string {
  switch (tone) {
    case 'success':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
    case 'warning':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
    case 'error':
      return 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
    case 'default':
    default:
      return 'bg-ds-subtle text-ds-muted'
  }
}

function SkillSection({
  title,
  emptyText,
  items,
  busyId,
  isInstalled,
  onAdd,
  t
}: {
  title: string
  emptyText: string
  items: SkillCatalogItem[]
  busyId: string | null
  isInstalled: (item: Pick<SkillCatalogItem, 'id'>) => boolean
  onAdd: (item: SkillCatalogItem) => Promise<void>
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <section className="mt-8">
      <h2 className="border-b border-ds-border-muted pb-3 text-[20px] font-semibold text-ds-ink">
        {title}
      </h2>
      {items.length === 0 ? (
        <div className="py-8 text-[14px] text-ds-faint">{emptyText}</div>
      ) : (
        <div className="grid gap-x-14 md:grid-cols-2">
          {items.map((item) => {
            const itemKey = skillItemKey(item.id)
            const installed = isInstalled(item)
            const busy = busyId === itemKey
            return (
              <div
                key={itemKey}
                className="flex min-h-[92px] items-center gap-5 border-b border-ds-border-muted py-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[17px] font-semibold text-ds-ink">
                      {itemTitle(item, t)}
                    </span>
                    {item.sourceLabel ? (
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${skillSourceTone(item.statusTone)}`}
                      >
                        {item.sourceLabel}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[14px] leading-5 text-ds-muted">
                    {itemDescription(item, t)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={installed || busy}
                  onClick={() => void onAdd(item)}
                  title={installed ? t('pluginAdded') : t('pluginAdd')}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
                    installed
                      ? 'text-ds-faint'
                      : 'bg-ds-subtle text-ds-ink hover:bg-ds-hover disabled:opacity-60'
                  }`}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  ) : installed ? (
                    <Check className="h-4 w-4" strokeWidth={2} />
                  ) : (
                    <Plus className="h-4 w-4" strokeWidth={2} />
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function CustomSkillPanel({
  customName,
  customDescription,
  customSkillBody,
  busy,
  onNameChange,
  onDescriptionChange,
  onSkillBodyChange,
  onAdd
}: {
  customName: string
  customDescription: string
  customSkillBody: string
  busy: boolean
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onSkillBodyChange: (value: string) => void
  onAdd: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <section className="mt-6 rounded-2xl border border-ds-border bg-ds-card/95 p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <input
          value={customName}
          onChange={(event) => onNameChange(event.target.value)}
          aria-label={t('pluginCustomName')}
          className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomName')}
        />
        <input
          value={customDescription}
          onChange={(event) => onDescriptionChange(event.target.value)}
          aria-label={t('pluginCustomDescription')}
          className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomDescription')}
        />
      </div>
      <textarea
        value={customSkillBody}
        onChange={(event) => onSkillBodyChange(event.target.value)}
        aria-label={t('pluginCustomSkillBody')}
        className="mt-3 min-h-[140px] w-full rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-[13px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
        placeholder={t('pluginCustomSkillBody')}
        spellCheck={false}
      />
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Plus className="h-4 w-4" strokeWidth={2} />}
          {t('pluginAddCustom')}
        </button>
      </div>
    </section>
  )
}
