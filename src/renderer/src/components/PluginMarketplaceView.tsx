import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Blocks,
  ChevronLeft,
  ChevronDown,
  FolderOpen,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Search
} from 'lucide-react'
import {
  joinFsPath,
  loadPreferredSkillRootId,
  savePreferredSkillRootId,
  type SkillRootId
} from '../lib/skill-root-preference'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import type {
  SkillListItem
} from '@shared/sciforge-api'
import { useChatStore } from '../store/chat-store'
import { NoticeView, type MarketplaceNotice } from './PluginMarketplaceParts'
import {
  ExtensionCatalog,
  extensionCatalogItemsFromSummaries,
  type ExtensionCatalogItem
} from './extensions/ExtensionCatalog'
import { MarketCatalog } from './extensions/MarketCatalog'

type SkillFilter = 'all' | 'recommended' | 'installed'
type ExtensionCenterTab = 'extensions' | 'skills' | 'market'

const EXTENSION_CENTER_TABS = ['extensions', 'skills', 'market'] as const
const EXTENSION_CENTER_TAB_LABELS: Readonly<Record<ExtensionCenterTab, string>> = {
  extensions: 'extensionTabExtensions',
  skills: 'extensionTabSkills',
  market: 'extensionTabMarket'
}

export type SkillCatalogItem = {
  id: string
  kind: 'skill'
  titleKey?: string
  descriptionKey?: string
  title?: string
  description?: string
  group: 'recommended' | 'personal'
  sourceLabel?: string
  skillInstructions?: string
  location?: string
}

type SkillRootOption = {
  id: SkillRootId
  label: string
  path: string
  available: boolean
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
    sourceLabel: skill.scope === 'project' ? labels.project : labels.global,
    location: skill.entryPath
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
  const [expandedSkillGroups, setExpandedSkillGroups] = useState({ recommended: false, personal: false })
  const [selectedSkill, setSelectedSkill] = useState<SkillCatalogItem | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customSkillBody, setCustomSkillBody] = useState('')
  const [skillRootId, setSkillRootId] = useState<SkillRootId>(() => loadPreferredSkillRootId())
  const [discoveredSkills, setDiscoveredSkills] = useState<SkillListItem[]>([])
  const [skillListLoading, setSkillListLoading] = useState(false)
  const [skillListError, setSkillListError] = useState('')
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

  const setExtensionEnabled = useCallback(async (
    extension: ExtensionCatalogItem,
    enabled: boolean
  ): Promise<void> => {
    setBusyExtension(extension.packageName)
    setExtensionsError('')
    try {
      await window.sciforge.extensions.setEnabled({ packageName: extension.packageName, enabled })
      await refreshExtensions()
    } catch (error) {
      setExtensionsError(extensionOperationMessage(error, t('extensionStateFailed')))
    } finally {
      setBusyExtension(null)
    }
  }, [refreshExtensions, t])

  const applyCandidate = useCallback(async (
    extension: ExtensionCatalogItem
  ): Promise<void> => {
    setBusyExtension(extension.packageName)
    setExtensionsError('')
    try {
      await window.sciforge.extensions.applyCandidate({ packageName: extension.packageName })
      await refreshExtensions()
    } catch (error) {
      setExtensionsError(extensionOperationMessage(error, t('extensionApplyFailed', { defaultValue: 'Failed to apply update.' })))
    } finally {
      setBusyExtension(null)
    }
  }, [refreshExtensions, t])

  const cancelCandidate = useCallback(async (
    extension: ExtensionCatalogItem
  ): Promise<void> => {
    setBusyExtension(extension.packageName)
    setExtensionsError('')
    try {
      await window.sciforge.extensions.cancelCandidate({ packageName: extension.packageName })
      await refreshExtensions()
    } catch (error) {
      setExtensionsError(extensionOperationMessage(error, t('extensionCancelFailed', { defaultValue: 'Failed to cancel update.' })))
    } finally {
      setBusyExtension(null)
    }
  }, [refreshExtensions, t])

  const checkCandidate = useCallback(async (
    extension: ExtensionCatalogItem
  ): Promise<void> => {
    const picked = await window.sciforge.pickWorkspaceDirectory()
    if (picked === null || picked === undefined || picked.canceled || !picked.path) return
    setBusyExtension(extension.packageName)
    setExtensionsError('')
    try {
      await window.sciforge.extensions.checkCandidate({ packageName: extension.packageName, path: picked.path })
      await refreshExtensions()
    } catch (error) {
      setExtensionsError(extensionOperationMessage(error, t('extensionCheckFailed', { defaultValue: 'Failed to check candidate version.' })))
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
            <h1 className="text-ds-6xl font-semibold text-ds-ink md:text-[36px]">
              {t('extensionCenterTitle')}
            </h1>
            {activeTab !== 'skills' ? <p className="mt-2 max-w-2xl text-ds-lg leading-6 text-ds-muted">
              {t('extensionCenterDescription')}
            </p> : null}
          </div>
          {activeTab === 'skills' ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setCustomOpen((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-3 py-2 text-ds-md font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
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
          {(EXTENSION_CENTER_TABS as readonly ExtensionCenterTab[]).map((tab) => {
            const selected = activeTab === tab
            const position = EXTENSION_CENTER_TABS.indexOf(tab as typeof EXTENSION_CENTER_TABS[number])
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
                  const last = EXTENSION_CENTER_TABS.length - 1
                  const nextTab = event.key === 'Home'
                    ? EXTENSION_CENTER_TABS[0]
                    : event.key === 'End'
                      ? EXTENSION_CENTER_TABS[last]
                      : event.key === 'ArrowLeft'
                        ? EXTENSION_CENTER_TABS[(position - 1 + EXTENSION_CENTER_TABS.length) % EXTENSION_CENTER_TABS.length]
                        : EXTENSION_CENTER_TABS[(position + 1) % EXTENSION_CENTER_TABS.length]
                  setActiveTab(nextTab)
                  requestAnimationFrame(() => {
                    document.getElementById(`extension-center-${nextTab}-tab`)?.focus()
                  })
                }}
                className={`border-b-2 px-4 py-3 text-ds-lg font-semibold transition ${
                  selected
                    ? 'border-[var(--ds-accent)] text-ds-ink'
                    : 'border-transparent text-ds-muted hover:text-ds-ink'
                }`}
              >
                {t(EXTENSION_CENTER_TAB_LABELS[tab])}
              </button>
            )
          })}
        </div>

        {activeTab === 'market' ? (
          <MarketCatalog />
        ) : activeTab === 'extensions' ? (
          <ExtensionCatalog
            extensions={extensionItems ?? undefined}
            loading={extensionsLoading}
            error={extensionsError}
            busyPackageName={busyExtension}
            onInstall={() => void installExtension()}
            onRollback={(extension) => void rollbackExtension(extension)}
            onUninstall={(extension) => void uninstallExtension(extension)}
            onSetEnabled={(extension, enabled) => void setExtensionEnabled(extension, enabled)}
            onApplyCandidate={(extension) => void applyCandidate(extension)}
            onCancelCandidate={(extension) => void cancelCandidate(extension)}
            onCheckCandidate={(extension) => void checkCandidate(extension)}
          />
        ) : (
          <section
            id="extension-center-skills-panel"
            role="tabpanel"
            aria-labelledby="extension-center-skills-tab"
          >
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
                  className="h-11 w-full rounded-2xl border border-ds-border bg-ds-card pl-11 pr-4 text-ds-xl text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
                  placeholder={t('pluginSearchSkill')}
                />
              </label>
              <label className="relative w-full md:w-[168px]">
                <span className="sr-only">{t('pluginSkillFilterLabel')}</span>
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as SkillFilter)}
                  className="h-11 w-full appearance-none rounded-2xl border border-ds-border bg-ds-card px-4 pr-9 text-ds-xl font-medium text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
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

            <details className="mt-3 text-ds-sm text-ds-muted">
              <summary className="cursor-pointer hover:text-ds-ink">{t('pluginSkillManagement')}</summary>
            <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
              <select
                value={selectedSkillRoot?.id ?? ''}
                aria-label={t('pluginSkillRootLabel')}
                onChange={(event) => setSkillRootId(event.target.value as SkillRootId)}
                className="h-10 rounded-xl border border-ds-border bg-ds-card px-3 text-ds-md text-ds-ink shadow-sm outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
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
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-ds-md font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
              >
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
                {t('pluginOpenLocation')}
              </button>
              <button
                type="button"
                onClick={() => void refreshSkillList()}
                disabled={skillListLoading}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-ds-md font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {skillListLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                )}
                {t('pluginSkillRefresh')}
              </button>
            </div>
            </details>
            {skillListError ? <p role="alert" className="mt-2 text-ds-sm text-red-700 dark:text-red-300">{skillListError}</p> : null}

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

            {selectedSkill ? (
              <article data-skill-details className="mt-6 py-4">
                <button type="button" onClick={() => setSelectedSkill(null)} className="inline-flex items-center gap-1.5 text-ds-sm text-ds-muted hover:text-ds-ink">
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />{t('pluginBackToSkills')}
                </button>
                <h3 className="mt-5 text-ds-3xl font-semibold text-ds-ink">{itemTitle(selectedSkill, t)}</h3>
                <p className="mt-3 whitespace-pre-wrap text-ds-lg leading-6 text-ds-muted">{itemDescription(selectedSkill, t)}</p>
                {selectedSkill.sourceLabel ? <p className="mt-3 text-ds-sm text-ds-faint">{selectedSkill.sourceLabel}</p> : null}
                {selectedSkill.location ? <p className="mt-3 break-all font-mono text-ds-sm text-ds-faint">{selectedSkill.location}</p> : null}
                {selectedSkill.skillInstructions ? <pre className="mt-5 whitespace-pre-wrap rounded-xl bg-ds-subtle p-4 font-mono text-ds-sm leading-6 text-ds-muted">{selectedSkill.skillInstructions}</pre> : null}
                {selectedSkill.group === 'recommended' ? (
                  <button type="button" disabled={isInstalled(selectedSkill) || busyId !== null} onClick={() => void addItem(selectedSkill)} className="mt-5 rounded-lg bg-ds-userbubble px-4 py-2 text-ds-sm font-semibold text-ds-userbubbleFg disabled:opacity-50">
                    {isInstalled(selectedSkill) ? t('pluginAdded') : t('pluginAdd')}
                  </button>
                ) : null}
              </article>
            ) : (
              <>
                {recommendedItems.length + personalItems.length === 0 ? <p className="py-8 text-ds-sm text-ds-faint">{t('pluginNoSkillResults')}</p> : null}
                <SkillSection
                  title={t('pluginSkillTemplates')}
                  expanded={expandedSkillGroups.recommended}
                  onToggleExpanded={() => setExpandedSkillGroups(current => ({ ...current, recommended: !current.recommended }))}
                  items={recommendedItems}
                  busyId={busyId}
                  isInstalled={isInstalled}
                  onOpen={setSelectedSkill}
                  onAdd={addItem}
                  t={t}
                />

                <SkillSection
                  title={t('pluginPersonalSkills')}
                  expanded={expandedSkillGroups.personal}
                  onToggleExpanded={() => setExpandedSkillGroups(current => ({ ...current, personal: !current.personal }))}
                  items={personalItems}
                  busyId={busyId}
                  isInstalled={isInstalled}
                  onOpen={setSelectedSkill}
                  onAdd={addItem}
                  t={t}
                />
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function SkillSection({
  title, items, expanded, onToggleExpanded, busyId, isInstalled, onAdd, onOpen, t
}: {
  title: string
  items: SkillCatalogItem[]
  expanded: boolean
  onToggleExpanded: () => void
  busyId: string | null
  isInstalled: (item: Pick<SkillCatalogItem, 'id'>) => boolean
  onAdd: (item: SkillCatalogItem) => Promise<void>
  onOpen: (item: SkillCatalogItem) => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement | null {
  if (items.length === 0) return null
  const shown = expanded ? items : items.slice(0, 6)
  return (
    <section className="mt-7">
      <h2 className="mb-2 flex items-center gap-2 text-ds-md font-semibold text-ds-muted">
        {title}<span className="text-ds-xs font-normal text-ds-faint">{items.length}</span>
      </h2>
      <div className="grid gap-x-4 gap-y-1 md:grid-cols-2">
        {shown.map(item => {
          const installed = isInstalled(item)
          const busy = busyId === skillItemKey(item.id)
          return (
            <article key={skillItemKey(item.id)} className="group relative flex min-h-[80px] items-center gap-3 rounded-xl border border-transparent p-3 transition-colors hover:border-ds-border-muted hover:bg-ds-hover focus-within:border-ds-border-muted focus-within:bg-ds-hover">
              <button type="button" aria-label={t('catalogOpenDetails', { name: itemTitle(item, t) })} onClick={() => onOpen(item)} className="ds-button-plain absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
              <span className="pointer-events-none relative z-20 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ds-subtle text-accent" aria-hidden="true"><Blocks className="h-5 w-5" /></span>
              <div className="pointer-events-none relative z-20 min-w-0 flex-1">
                <h3 className="truncate text-ds-xl font-semibold text-ds-ink">{itemTitle(item, t)}</h3>
                <p className="mt-1 truncate text-ds-sm text-ds-muted">{itemDescription(item, t)}</p>
              </div>
              {installed ? (
                <span className="pointer-events-none relative z-20 flex h-8 w-8 shrink-0 items-center justify-center text-ds-faint" aria-label={t('pluginAdded')}><Check className="h-4 w-4" aria-hidden="true" /></span>
              ) : (
                <button type="button" disabled={busyId !== null} aria-label={t('pluginAddNamed', { name: itemTitle(item, t) })} onClick={() => void onAdd(item)} title={t('pluginAdd')} className="ds-button-plain relative z-30 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                </button>
              )}
            </article>
          )
        })}
      </div>
      {items.length > 6 ? <button type="button" onClick={onToggleExpanded} className="ds-button-plain mt-2 rounded-lg px-3 py-2 text-ds-sm text-ds-faint hover:text-ds-ink">{expanded ? t('pluginSkillShowLess') : t('pluginSkillShowAll', { count: items.length })}</button> : null}
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
          className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-ds-lg text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomName')}
        />
        <input
          value={customDescription}
          onChange={(event) => onDescriptionChange(event.target.value)}
          aria-label={t('pluginCustomDescription')}
          className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-ds-lg text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomDescription')}
        />
      </div>
      <textarea
        value={customSkillBody}
        onChange={(event) => onSkillBodyChange(event.target.value)}
        aria-label={t('pluginCustomSkillBody')}
        className="mt-3 min-h-[140px] w-full rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-ds-md leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
        placeholder={t('pluginCustomSkillBody')}
        spellCheck={false}
      />
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-ds-md font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Plus className="h-4 w-4" strokeWidth={2} />}
          {t('pluginAddCustom')}
        </button>
      </div>
    </section>
  )
}
