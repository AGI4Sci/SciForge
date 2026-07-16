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
import {
  loadInstalledPluginKeys,
  PAPER_RADAR_EXTENSION_ID,
  pluginStorageKey,
  saveInstalledPluginKeys,
  type PluginInstallKind
} from '../lib/plugin-install-state'
import { getProvider } from '../agent/registry'
import type {
  ScientificSkillsInstallRequest,
  ScientificSkillsStatusResult,
  SkillListItem
} from '@shared/sciforge-api'
import type {
  LocalRuntimeInfoJson,
  LocalRuntimeToolDiagnosticsJson
} from '../agent/local-runtime-contract'
import { useChatStore } from '../store/chat-store'
import { NoticeView, TabButton, type MarketplaceNotice } from './PluginMarketplaceParts'
import {
  buildMcpMarketplaceOverlay,
  type McpMarketplaceOverlay,
  type McpMarketplaceOverlayStatus
} from './plugin-marketplace-runtime'
import {
  buildMcpConfig,
  customMcpConfigFragment,
  isJsonRecord,
  mcpConfigHasServer,
  mcpServersFromConfig,
  mergeMcpJsonConfig,
  parseMcpJsonConfig,
  type JsonRecord
} from '../lib/mcp-config'

type PluginKind = PluginInstallKind
type PluginFilter = 'all' | 'recommended' | 'installed'
type NoticeTone = 'success' | 'error' | 'info'

type Notice = MarketplaceNotice

type MarketplaceItem = {
  id: string
  kind: PluginKind
  titleKey?: string
  descriptionKey?: string
  title?: string
  description?: string
  group: 'recommended' | 'personal'
  sourceLabel?: string
  statusTone?: 'default' | 'success' | 'warning' | 'error'
  systemManaged?: boolean
  mcpConfig?: (workspaceRoot: string) => JsonRecord | Promise<JsonRecord>
  skillInstructions?: string
}

type SkillRootOption = {
  id: SkillRootId
  label: string
  path: string
  available: boolean
}

const GUI_SCHEDULE_MCP_SERVER_ID = 'gui_schedule'
type ScientificSkillsStatusOk = Extract<ScientificSkillsStatusResult, { ok: true }>
type ScientificSkillsInstallBackend = NonNullable<ScientificSkillsInstallRequest['backend']>

export function scientificSkillsInstallTargetForWorkspace(workspaceRoot: string): string {
  return workspaceRoot
    ? joinFsPath(workspaceRoot, '.agents/skills/scientific-agent-skills')
    : ''
}

function normalizePluginId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function mcpServerDescription(server: JsonRecord | undefined, fallback: string): string {
  if (!server) return fallback
  const transport = typeof server.transport === 'string' ? server.transport : ''
  const command = typeof server.command === 'string' ? server.command : ''
  const url = typeof server.url === 'string' ? server.url : ''
  const status = typeof server.status === 'string' ? server.status : ''
  const lastError = typeof server.lastError === 'string' ? server.lastError : ''
  const toolCount = typeof server.toolCount === 'number' && Number.isFinite(server.toolCount)
    ? server.toolCount
    : undefined
  const parts = [
    status ? `status: ${status}` : '',
    transport,
    command || url,
    toolCount != null ? `${toolCount} tools` : '',
    lastError ? `error: ${lastError}` : ''
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : fallback
}

function mcpServerStatus(diagnostic: JsonRecord | undefined, config: JsonRecord | undefined): string {
  const diagnosticStatus = typeof diagnostic?.status === 'string' ? diagnostic.status : ''
  if (diagnosticStatus) return diagnosticStatus
  if (config?.enabled === false || config?.disabled === true) return 'disabled'
  return ''
}

function mcpStatusTone(status: string): MarketplaceItem['statusTone'] {
  if (status === 'connected' || status === 'available') return 'success'
  if (status === 'error' || status === 'unavailable') return 'error'
  if (status === 'disabled') return 'warning'
  return 'default'
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

function itemTitle(item: MarketplaceItem, t: (key: string) => string): string {
  const catalogItem = item.group === 'personal'
    ? RECOMMENDED_ITEMS.find((candidate) => candidate.kind === item.kind && candidate.id === item.id)
    : undefined
  const displayItem = catalogItem ?? item
  return displayItem.title ?? (displayItem.titleKey ? t(displayItem.titleKey) : displayItem.id)
}

function itemDescription(item: MarketplaceItem, t: (key: string) => string): string {
  const catalogItem = item.group === 'personal'
    ? RECOMMENDED_ITEMS.find((candidate) => candidate.kind === item.kind && candidate.id === item.id)
    : undefined
  const displayItem = catalogItem ?? item
  return displayItem.description ?? (displayItem.descriptionKey ? t(displayItem.descriptionKey) : '')
}

export function skillMarketplaceItemsFromDiscoveredSkills(
  skills: SkillListItem[],
  labels: { project: string; global: string }
): MarketplaceItem[] {
  return skills.map((skill) => ({
    id: skill.id,
    kind: 'skill' as const,
    title: skill.name,
    description: skill.description ?? skill.root,
    group: 'personal' as const,
    sourceLabel: skill.scope === 'project' ? labels.project : labels.global
  }))
}

export function mcpMarketplaceItemsFromConfigAndDiagnostics(
  configText: string,
  diagnostics: LocalRuntimeToolDiagnosticsJson | null,
  labels: {
    configured: string
    connected: string
    error: string
    disabled: string
  }
): MarketplaceItem[] {
  const servers = new Map<string, {
    id: string
    config?: JsonRecord
    diagnostic?: JsonRecord
  }>()
  try {
    const configServers = mcpServersFromConfig(parseMcpJsonConfig(configText))
    for (const [id, value] of Object.entries(configServers)) {
      if (!id.trim()) continue
      servers.set(id, {
        id,
        config: isJsonRecord(value) ? value : {}
      })
    }
  } catch {
    /* Invalid config is surfaced elsewhere; keep the marketplace render resilient. */
  }
  for (const diagnostic of diagnostics?.mcpServers ?? []) {
    const id = typeof diagnostic.id === 'string' ? diagnostic.id.trim() : ''
    if (!id) continue
    const existing = servers.get(id)
    servers.set(id, {
      id,
      config: existing?.config,
      diagnostic
    })
  }
  return [...servers.values()].map(({ id, config, diagnostic }) => {
    const status = mcpServerStatus(diagnostic, config)
    const details = { ...(config ?? {}), ...(diagnostic ?? {}) }
    const sourceLabel =
      status === 'connected' || status === 'available' ? labels.connected :
      status === 'error' || status === 'unavailable' ? labels.error :
      status === 'disabled' ? labels.disabled :
      labels.configured
    return {
      id,
      kind: 'mcp' as const,
      title: id,
      description: mcpServerDescription(details, labels.configured),
      group: 'personal' as const,
      sourceLabel,
      statusTone: mcpStatusTone(status)
    }
  }).sort((left, right) => left.title.localeCompare(right.title))
}

function skillNameLooksValid(raw: string): boolean {
  const value = raw.trim()
  return !!value && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

const RECOMMENDED_ITEMS: MarketplaceItem[] = [
  {
    id: GUI_SCHEDULE_MCP_SERVER_ID,
    kind: 'mcp',
    titleKey: 'pluginMcpGuiScheduleTitle',
    descriptionKey: 'pluginMcpGuiScheduleDesc',
    group: 'recommended',
    systemManaged: true
  },
  {
    id: 'filesystem',
    kind: 'mcp',
    titleKey: 'pluginMcpFilesystemTitle',
    descriptionKey: 'pluginMcpFilesystemDesc',
    group: 'recommended',
    mcpConfig: (workspaceRoot) =>
      buildMcpConfig(
        'filesystem',
        'npx',
        ['-y', '@modelcontextprotocol/server-filesystem', workspaceRoot || '/path/to/project'],
        {
          trustScope: 'workspace',
          trustedWorkspaceRoots: [workspaceRoot || '/path/to/project']
        }
      )
  },
  {
    id: 'dataset_api',
    kind: 'mcp',
    titleKey: 'pluginMcpDatasetApiTitle',
    descriptionKey: 'pluginMcpDatasetApiDesc',
    group: 'recommended',
    mcpConfig: async (workspaceRoot) => {
      if (typeof window.sciforge?.buildDatasetApiMcpConfig !== 'function') {
        throw new Error('Dataset API MCP config is unavailable in this build.')
      }
      const result = await window.sciforge.buildDatasetApiMcpConfig(workspaceRoot || undefined)
      if (!result.ok) throw new Error(result.message)
      return result.config
    }
  },
  {
    id: 'playwright',
    kind: 'mcp',
    titleKey: 'pluginMcpPlaywrightTitle',
    descriptionKey: 'pluginMcpPlaywrightDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'playwright',
        'npx',
        ['-y', '@playwright/mcp@latest']
      )
  },
  {
    id: 'github',
    kind: 'mcp',
    titleKey: 'pluginMcpGithubTitle',
    descriptionKey: 'pluginMcpGithubDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'github',
        'npx',
        ['-y', '@modelcontextprotocol/server-github']
      )
  },
  {
    id: 'context7',
    kind: 'mcp',
    titleKey: 'pluginMcpContext7Title',
    descriptionKey: 'pluginMcpContext7Desc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'context7',
        'npx',
        ['-y', '@upstash/context7-mcp@latest']
      )
  },
  {
    id: 'scientific_skills',
    kind: 'mcp',
    titleKey: 'pluginMcpScientificSkillsTitle',
    descriptionKey: 'pluginMcpScientificSkillsDesc',
    group: 'recommended',
    mcpConfig: async (workspaceRoot) => {
      if (typeof window.sciforge?.buildScientificSkillsMcpConfig !== 'function') {
        throw new Error('Scientific skills MCP config is unavailable in this build.')
      }
      const result = await window.sciforge.buildScientificSkillsMcpConfig(workspaceRoot || undefined)
      if (!result.ok) throw new Error(result.message)
      return result.config
    }
  },
  {
    id: 'scientific_plotting',
    kind: 'mcp',
    titleKey: 'pluginMcpScientificPlottingTitle',
    descriptionKey: 'pluginMcpScientificPlottingDesc',
    group: 'recommended',
    mcpConfig: async (workspaceRoot) => {
      if (typeof window.sciforge?.buildScientificPlottingMcpConfig !== 'function') {
        throw new Error('Scientific plotting MCP config is unavailable in this build.')
      }
      const result = await window.sciforge.buildScientificPlottingMcpConfig(workspaceRoot || undefined)
      if (!result.ok) throw new Error(result.message)
      return result.config
    }
  },
  {
    id: 'bgc_discovery',
    kind: 'mcp',
    titleKey: 'pluginMcpBgcDiscoveryTitle',
    descriptionKey: 'pluginMcpBgcDiscoveryDesc',
    group: 'recommended',
    mcpConfig: async (workspaceRoot) => {
      if (typeof window.sciforge?.buildBgcDiscoveryMcpConfig !== 'function') {
        throw new Error('BGC Discovery MCP config is unavailable in this build.')
      }
      const result = await window.sciforge.buildBgcDiscoveryMcpConfig(workspaceRoot || undefined)
      if (!result.ok) throw new Error(result.message)
      return result.config
    }
  },
  {
    id: 'image_generation',
    kind: 'mcp',
    titleKey: 'pluginMcpImageGenerationTitle',
    descriptionKey: 'pluginMcpImageGenerationDesc',
    group: 'recommended',
    mcpConfig: async (workspaceRoot) => {
      if (typeof window.sciforge?.buildImageGenerationMcpConfig !== 'function') {
        throw new Error('Image generation MCP config is unavailable in this build.')
      }
      const result = await window.sciforge.buildImageGenerationMcpConfig(workspaceRoot || undefined)
      if (!result.ok) throw new Error(result.message)
      return result.config
    }
  },
  {
    id: 'ppt_master',
    kind: 'mcp',
    titleKey: 'pluginMcpPptMasterTitle',
    descriptionKey: 'pluginMcpPptMasterDesc',
    group: 'recommended',
    mcpConfig: async (workspaceRoot) => {
      if (typeof window.sciforge?.buildPptMasterMcpConfig !== 'function') {
        throw new Error('ppt-master MCP config is unavailable in this build.')
      }
      const result = await window.sciforge.buildPptMasterMcpConfig(workspaceRoot || undefined)
      if (!result.ok) throw new Error(result.message)
      return result.config
    }
  },
  {
    id: PAPER_RADAR_EXTENSION_ID,
    kind: 'extension',
    titleKey: 'pluginExtensionPaperRadarTitle',
    descriptionKey: 'pluginExtensionPaperRadarDesc',
    group: 'recommended'
  },
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
  const [activeKind, setActiveKind] = useState<PluginKind>('mcp')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PluginFilter>('all')
  const [installed, setInstalled] = useState<string[]>(() => loadInstalledPluginKeys())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customCommand, setCustomCommand] = useState('')
  const [customArgs, setCustomArgs] = useState('')
  const [customConfig, setCustomConfig] = useState('')
  const [customSkillBody, setCustomSkillBody] = useState('')
  const [skillRootId, setSkillRootId] = useState<SkillRootId>(() => loadPreferredSkillRootId())
  const [mcpConfigText, setMcpConfigText] = useState('')
  const [mcpLoaded, setMcpLoaded] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<LocalRuntimeInfoJson | null>(null)
  const [toolDiagnostics, setToolDiagnostics] = useState<LocalRuntimeToolDiagnosticsJson | null>(null)
  const [runtimeOverlayLoading, setRuntimeOverlayLoading] = useState(false)
  const [runtimeOverlayError, setRuntimeOverlayError] = useState('')
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

  const readMcpConfig = useCallback(async (): Promise<string> => {
    if (typeof window.sciforge?.getRuntimeConfigFile !== 'function') return mcpConfigText
    const file = await window.sciforge.getRuntimeConfigFile()
    setMcpConfigText(file.content)
    setMcpLoaded(true)
    return file.content
  }, [mcpConfigText])

  useEffect(() => {
    if (activeKind !== 'mcp' || mcpLoaded) return
    void readMcpConfig().catch((e) => {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    })
  }, [activeKind, mcpLoaded, readMcpConfig])

  const refreshMcpRuntimeOverlay = useCallback(async (): Promise<void> => {
    const provider = getProvider()
    if (!provider.getRuntimeInfo && !provider.getToolDiagnostics) {
      setRuntimeOverlayError(t('pluginMcpRuntimeUnavailable'))
      return
    }
    setRuntimeOverlayLoading(true)
    setRuntimeOverlayError('')
    try {
      const [runtimeResult, diagnosticsResult] = await Promise.allSettled([
        provider.getRuntimeInfo?.(),
        provider.getToolDiagnostics?.()
      ])
      if (runtimeResult.status === 'fulfilled' && runtimeResult.value) {
        setRuntimeInfo(runtimeResult.value)
      }
      if (diagnosticsResult.status === 'fulfilled' && diagnosticsResult.value) {
        setToolDiagnostics(diagnosticsResult.value)
      }
      const errors = [runtimeResult, diagnosticsResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => runtimeOverlayErrorMessage(result.reason, t('pluginMcpRuntimeUnavailable')))
      if (errors.length > 0) setRuntimeOverlayError(errors[0] ?? t('pluginActionFailed'))
    } finally {
      setRuntimeOverlayLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (activeKind !== 'mcp') return
    void refreshMcpRuntimeOverlay()
  }, [activeKind, refreshMcpRuntimeOverlay])

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
    if (activeKind !== 'mcp') return
    void refreshScientificSkillsStatus()
  }, [activeKind, refreshScientificSkillsStatus])

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
    if (activeKind !== 'skill') return
    void refreshSkillList()
  }, [activeKind, refreshSkillList])

  useEffect(() => {
    setNotice(null)
    setCustomOpen(false)
  }, [activeKind])

  const markInstalled = (key: string): void => {
    setInstalled((prev) => {
      const next = [...new Set([...prev, key])]
      saveInstalledPluginKeys(next)
      return next
    })
  }

  const discoveredSkillIds = useMemo(
    () => new Set(discoveredSkills.map((skill) => skill.id)),
    [discoveredSkills]
  )
  const discoveredSkillItems = useMemo(
    () => skillMarketplaceItemsFromDiscoveredSkills(discoveredSkills, {
      project: t('pluginSkillSourceProject'),
      global: t('pluginSkillSourceGlobal')
    }),
    [discoveredSkills, t]
  )
  const discoveredMcpItems = useMemo(
    () => mcpMarketplaceItemsFromConfigAndDiagnostics(mcpConfigText, toolDiagnostics, {
      configured: t('pluginMcpSourceConfigured'),
      connected: t('pluginMcpSourceConnected'),
      error: t('pluginMcpSourceError'),
      disabled: t('pluginMcpSourceDisabled')
    }).filter((item) => item.id !== GUI_SCHEDULE_MCP_SERVER_ID),
    [mcpConfigText, t, toolDiagnostics]
  )
  const discoveredMcpIds = useMemo(
    () => new Set(discoveredMcpItems.map((item) => item.id)),
    [discoveredMcpItems]
  )
  const marketplaceItems = useMemo(
    () => {
      if (activeKind === 'skill') return [...RECOMMENDED_ITEMS, ...discoveredSkillItems]
      if (activeKind === 'mcp') return [...RECOMMENDED_ITEMS, ...discoveredMcpItems]
      return RECOMMENDED_ITEMS
    },
    [activeKind, discoveredMcpItems, discoveredSkillItems]
  )

  const isInstalled = useCallback((item: Pick<MarketplaceItem, 'kind' | 'id'>): boolean => {
    if ('group' in item && item.group === 'personal') return true
    const catalogItem = RECOMMENDED_ITEMS.find((candidate) => candidate.kind === item.kind && candidate.id === item.id)
    if (catalogItem?.systemManaged) return true
    if (item.kind === 'skill' && discoveredSkillIds.has(item.id)) return true
    if (item.kind === 'mcp' && discoveredMcpIds.has(item.id)) return true
    const key = pluginStorageKey(item.kind, item.id)
    if (installed.includes(key)) return true
    return item.kind === 'mcp' && mcpConfigHasServer(mcpConfigText, item.id)
  }, [discoveredMcpIds, discoveredSkillIds, installed, mcpConfigText])

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return marketplaceItems.filter((item) => item.kind === activeKind)
      .filter((item) => {
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
  }, [activeKind, filter, isInstalled, marketplaceItems, query, t])

  const builtInItems = visibleItems.filter((item) => item.systemManaged)
  const recommendedItems = visibleItems.filter((item) => !item.systemManaged && !isInstalled(item))
  const personalItems = visibleItems.filter((item) =>
    item.group === 'personal' ||
    (!item.systemManaged && isInstalled(item) && !discoveredSkillIds.has(item.id) && !discoveredMcpIds.has(item.id))
  )
  const mcpRuntimeOverlay = useMemo(
    () => buildMcpMarketplaceOverlay({
      runtimeInfo,
      toolDiagnostics,
      managedServers: [{ id: GUI_SCHEDULE_MCP_SERVER_ID, toolCount: 4 }]
    }),
    [runtimeInfo, toolDiagnostics]
  )

  const appendMcpConfig = async (id: string, config: JsonRecord): Promise<void> => {
    const content = mcpLoaded ? mcpConfigText : await readMcpConfig()
    const merged = mergeMcpJsonConfig(content, config)
    if (merged.alreadyExists && !merged.changed) {
      markInstalled(pluginStorageKey('mcp', id))
      setNotice({ tone: 'info', message: t('pluginAlreadyAdded') })
      return
    }
    const result = await window.sciforge.setRuntimeConfigFile(merged.text)
    setMcpConfigText(merged.text)
    setMcpLoaded(true)
    markInstalled(pluginStorageKey('mcp', id))
    setNotice({ tone: 'success', message: t('pluginMcpAdded', { path: result.path }) })
  }

  const addItem = async (item: MarketplaceItem): Promise<void> => {
    setBusyId(pluginStorageKey(item.kind, item.id))
    setNotice(null)
    try {
      if (item.kind === 'mcp') {
        if (!item.mcpConfig) return
        await appendMcpConfig(item.id, await item.mcpConfig(workspaceRoot))
        return
      }

      if (item.kind === 'extension') {
        markInstalled(pluginStorageKey('extension', item.id))
        setNotice({ tone: 'success', message: t('pluginExtensionEnabled') })
        return
      }

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
      markInstalled(pluginStorageKey('skill', item.id))
      await refreshSkillList()
      setNotice({ tone: 'success', message: t('pluginSkillAdded', { path: result.path }) })
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyId(null)
    }
  }

  const addCustom = async (): Promise<void> => {
    if (activeKind === 'extension') return
    const id = normalizePluginId(customName)
    if (!id) {
      setNotice({ tone: 'error', message: t('pluginCustomNameRequired') })
      return
    }
    const description = customDescription.trim() || t('pluginCustomFallbackDesc')
    setBusyId(`custom:${activeKind}`)
    setNotice(null)
    try {
      if (activeKind === 'mcp') {
        const fallback = buildMcpConfig(
          id,
          customCommand.trim() || 'npx',
          customArgs
            .split('\n')
            .map((arg) => arg.trim())
            .filter(Boolean)
        )
        await appendMcpConfig(id, customMcpConfigFragment(id, customConfig, fallback))
      } else {
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
        markInstalled(pluginStorageKey('skill', id))
        await refreshSkillList()
        setNotice({ tone: 'success', message: t('pluginSkillAdded', { path: result.path }) })
      }
      setCustomName('')
      setCustomDescription('')
      setCustomCommand('')
      setCustomArgs('')
      setCustomConfig('')
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
      if (activeKind === 'mcp') {
        const result = await window.sciforge.openRuntimeConfigDir()
        if (!result.ok) setNotice({ tone: 'error', message: result.message ?? t('pluginActionFailed') })
        return
      }
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-ds-subtle p-1">
            <TabButton active={activeKind === 'mcp'} onClick={() => setActiveKind('mcp')}>
              {t('pluginTabMcp')}
            </TabButton>
            <TabButton active={activeKind === 'skill'} tone="skill" onClick={() => setActiveKind('skill')}>
              {t('pluginTabSkill')}
            </TabButton>
            <TabButton active={activeKind === 'extension'} onClick={() => setActiveKind('extension')}>
              {t('pluginTabExtension')}
            </TabButton>
          </div>
          {activeKind !== 'extension' ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void openManageTarget()}
                className="inline-flex items-center gap-2 rounded-xl bg-ds-subtle px-3 py-2 text-[13px] font-semibold text-ds-ink transition hover:bg-ds-hover"
              >
                <Settings className="h-4 w-4" strokeWidth={1.75} />
                {t('pluginManage')}
              </button>
              <button
                type="button"
                onClick={() => setCustomOpen((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" strokeWidth={1.9} />
                {t('pluginCreate')}
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-9 flex flex-col items-center text-center">
          <h1 className="text-[32px] font-semibold text-ds-ink md:text-[40px]">
            {activeKind === 'mcp'
              ? t('pluginMcpTitle')
              : activeKind === 'skill'
                ? t('pluginSkillTitle')
                : t('pluginExtensionTitle')}
          </h1>
        </div>

        <div className="mt-9 flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-11 w-full rounded-2xl border border-ds-border bg-ds-card pl-11 pr-4 text-[15px] text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
              placeholder={
                activeKind === 'mcp'
                  ? t('pluginSearchMcp')
                  : activeKind === 'skill'
                    ? t('pluginSearchSkill')
                    : t('pluginSearchExtension')
              }
            />
          </label>
          <label className="relative w-full md:w-[168px]">
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as PluginFilter)}
              className="h-11 w-full appearance-none rounded-2xl border border-ds-border bg-ds-card px-4 pr-9 text-[15px] font-medium text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
            >
              <option value="all">{t('pluginFilterAll')}</option>
              <option value="recommended">{t('pluginFilterRecommended')}</option>
              <option value="installed">{t('pluginFilterInstalled')}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-faint" />
          </label>
        </div>

        {activeKind === 'skill' ? (
          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
            <select
              value={selectedSkillRoot?.id ?? ''}
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
              <FolderOpen className="h-4 w-4" />
              {t('pluginOpenLocation')}
            </button>
            <button
              type="button"
              onClick={() => void refreshSkillList()}
              disabled={skillListLoading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {skillListLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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
        ) : null}

        {activeKind === 'mcp' ? (
          <>
            <McpRuntimeOverlayPanel
              overlay={mcpRuntimeOverlay}
              loading={runtimeOverlayLoading}
              error={runtimeOverlayError}
              onRefresh={() => void refreshMcpRuntimeOverlay()}
              t={t}
            />
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
          </>
        ) : null}

        {customOpen ? (
          <CustomPluginPanel
            activeKind={activeKind}
            customName={customName}
            customDescription={customDescription}
            customCommand={customCommand}
            customArgs={customArgs}
            customConfig={customConfig}
            customSkillBody={customSkillBody}
            busy={busyId === `custom:${activeKind}`}
            onNameChange={setCustomName}
            onDescriptionChange={setCustomDescription}
            onCommandChange={setCustomCommand}
            onArgsChange={setCustomArgs}
            onConfigChange={setCustomConfig}
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

        {activeKind === 'mcp' ? (
          <PluginSection
            title={t('pluginBuiltIn')}
            emptyText={t('pluginNoResults')}
            items={builtInItems}
            busyId={busyId}
            isInstalled={isInstalled}
            onAdd={addItem}
            t={t}
          />
        ) : null}

        <PluginSection
          title={t('pluginRecommended')}
          emptyText={t('pluginNoResults')}
          items={recommendedItems}
          busyId={busyId}
          isInstalled={isInstalled}
          onAdd={addItem}
          t={t}
        />

        <PluginSection
          title={t('pluginPersonal')}
          emptyText={t('pluginPersonalEmpty')}
          items={personalItems}
          busyId={busyId}
          isInstalled={isInstalled}
          onAdd={addItem}
          t={t}
        />

        {activeKind === 'mcp' ? (
          <div className="mt-8 flex items-center gap-2 text-[12px] text-ds-faint">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{t('pluginMcpRestartHint')}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function McpRuntimeOverlayPanel({
  overlay,
  loading,
  error,
  onRefresh,
  t
}: {
  overlay: McpMarketplaceOverlay
  loading: boolean
  error: string
  onRefresh: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const status = mcpRuntimeStatusLabel(overlay.status, t)
  return (
    <section className="mt-4 rounded-lg border border-ds-border bg-ds-card px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-ds-ink">{t('pluginMcpRuntimeOverlay')}</span>
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${mcpRuntimeStatusTone(overlay.status)}`}>
                {status}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ds-muted">
              <span>{t('pluginMcpRuntimeServers', {
                connected: overlay.connectedServers,
                configured: overlay.configuredServers
              })}</span>
              <span>{t('pluginMcpRuntimeTools', { count: overlay.toolCount })}</span>
              <span>{t('pluginMcpRuntimeSearch', {
                mode: overlay.searchMode,
                status: overlay.searchActive ? t('pluginMcpRuntimeSearchActive') : t('pluginMcpRuntimeSearchInactive'),
                indexed: overlay.indexedToolCount,
                advertised: overlay.advertisedToolCount
              })}</span>
              {overlay.driftCount > 0 ? <span>{t('pluginMcpRuntimeDrift', { count: overlay.driftCount })}</span> : null}
            </div>
            {overlay.serverIds.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {overlay.serverIds.map((id) => (
                  <span
                    key={id}
                    className="rounded-md border border-ds-border-muted bg-ds-subtle px-2 py-0.5 font-mono text-[11px] text-ds-muted"
                  >
                    {id}
                  </span>
                ))}
              </div>
            ) : null}
            {error || overlay.lastError ? (
              <div className="mt-2 truncate text-[12px] text-red-700 dark:text-red-300">
                {error || t('pluginMcpRuntimeLastError', { message: overlay.lastError })}
              </div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-ds-border bg-ds-subtle px-3 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('pluginMcpRuntimeRefresh')}
        </button>
      </div>
    </section>
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

function mcpRuntimeStatusLabel(
  status: McpMarketplaceOverlayStatus,
  t: (key: string) => string
): string {
  switch (status) {
    case 'connected':
      return t('pluginMcpRuntimeConnected')
    case 'configured':
      return t('pluginMcpRuntimeConfigured')
    case 'drift':
      return t('pluginMcpRuntimeDrifted')
    case 'error':
      return t('pluginMcpRuntimeError')
    case 'disabled':
      return t('pluginMcpRuntimeDisabled')
    case 'offline':
      return t('pluginMcpRuntimeOffline')
  }
}

function mcpRuntimeStatusTone(status: McpMarketplaceOverlayStatus): string {
  switch (status) {
    case 'connected':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
    case 'configured':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-200'
    case 'drift':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
    case 'error':
      return 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200'
    case 'disabled':
    case 'offline':
      return 'bg-ds-subtle text-ds-muted'
  }
}

function marketplaceSourceTone(tone: MarketplaceItem['statusTone']): string {
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

function runtimeOverlayErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return /sciforge|Cannot read properties/i.test(message) ? fallback : message
}

function PluginSection({
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
  items: MarketplaceItem[]
  busyId: string | null
  isInstalled: (item: Pick<MarketplaceItem, 'kind' | 'id'>) => boolean
  onAdd: (item: MarketplaceItem) => Promise<void>
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
            const itemKey = pluginStorageKey(item.kind, item.id)
            const installed = isInstalled(item)
            const busy = busyId === itemKey
            return (
              <div
                key={itemKey}
                data-plugin-id={item.id}
                className="flex min-h-[92px] items-center gap-5 border-b border-ds-border-muted py-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[17px] font-semibold text-ds-ink">
                      {itemTitle(item, t)}
                    </span>
                    {item.sourceLabel ? (
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${marketplaceSourceTone(item.statusTone)}`}
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
                  aria-label={`${installed ? t('pluginAdded') : t('pluginAdd')}: ${itemTitle(item, t)}`}
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

function CustomPluginPanel({
  activeKind,
  customName,
  customDescription,
  customCommand,
  customArgs,
  customConfig,
  customSkillBody,
  busy,
  onNameChange,
  onDescriptionChange,
  onCommandChange,
  onArgsChange,
  onConfigChange,
  onSkillBodyChange,
  onAdd
}: {
  activeKind: PluginKind
  customName: string
  customDescription: string
  customCommand: string
  customArgs: string
  customConfig: string
  customSkillBody: string
  busy: boolean
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onCommandChange: (value: string) => void
  onArgsChange: (value: string) => void
  onConfigChange: (value: string) => void
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
          className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomName')}
        />
        <input
          value={customDescription}
          onChange={(event) => onDescriptionChange(event.target.value)}
          className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomDescription')}
        />
      </div>
      {activeKind === 'mcp' ? (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={customCommand}
              onChange={(event) => onCommandChange(event.target.value)}
              className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
              placeholder={t('pluginCustomCommand')}
            />
            <textarea
              value={customArgs}
              onChange={(event) => onArgsChange(event.target.value)}
              className="min-h-[80px] rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-[13px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
              placeholder={t('pluginCustomArgs')}
              spellCheck={false}
            />
          </div>
          <textarea
            value={customConfig}
            onChange={(event) => onConfigChange(event.target.value)}
            className="min-h-[120px] rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-[13px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
            placeholder={t('pluginCustomMcpConfig')}
            spellCheck={false}
          />
        </div>
      ) : (
        <textarea
          value={customSkillBody}
          onChange={(event) => onSkillBodyChange(event.target.value)}
          className="mt-3 min-h-[140px] w-full rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-[13px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomSkillBody')}
          spellCheck={false}
        />
      )}
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
