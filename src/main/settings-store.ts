import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { atomicWriteFile } from './atomic-write-file'
import {
  applyLocalRuntimePatch,
  applyCodexRuntimePatch,
  applyClaudeRuntimePatch,
  agentRuntimeSettingsEnvelope,
  DEFAULT_GUI_UPDATE_CHANNEL,
  DEFAULT_WRITE_WORKSPACE_ROOT,
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultAgentCapabilitySettings,
  defaultComputerUseSettings,
  defaultRuntimeGuardSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultImageGenerationSettings,
  getCodexRuntimeSettings,
  getClaudeRuntimeSettings,
  getLocalRuntimeSettings,
  getModelRouterSettings,
  mergeCodexRuntimeSettings,
  mergeClaudeRuntimeSettings,
  mergeLocalRuntimeSettings,
  mergeModelAccessSettings,
  mergeModelRouterSettings,
  mergeComputerUseSettings,
  mergeAgentCapabilitySettings,
  mergeRuntimeGuardSettings,
  defaultWriteSettings,
  defaultWorkbenchToolbarSettings,
  mergeScheduleSettings,
  defaultSkillsSettings,
  mergeSkillsSettings,
  compactStrings,
  mergeSpeechToTextSettings,
  mergeWorkflowSettings,
  mergeWriteSettings,
  mergeImageGenerationSettings,
  normalizeAppBehaviorSettings,
  normalizeKeyboardShortcuts,
  normalizeAppSettings,
  normalizeModelAccessSettings,
  normalizeAgentRuntimeId,
  mergeWorkbenchToolbarSettings,
  normalizeWorkbenchToolbarSettings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  APP_PACKAGE_NAME,
  APP_SETTINGS_FILE_NAME,
  APP_USER_DATA_DIR_NAME
} from '../shared/app-brand'
import { createInternalHttpSecret } from './internal-http-secret'

export type { AppSettingsV1 }

const DEFAULT_WORKSPACE_ROOT = join(homedir(), '.sciforge', 'default_workspace')
const DEFAULT_WRITE_WORKSPACE_ROOT_ABSOLUTE = expandHomePath(DEFAULT_WRITE_WORKSPACE_ROOT)
const SETTINGS_FILE_NAME = APP_SETTINGS_FILE_NAME
const WELCOME_MARKDOWN = `# Welcome to Write

This is your default writing workspace.

- Create Markdown drafts from the sidebar.
- Select text in the editor and ask the writing assistant about it.
- Switch between source, live, split, and preview modes from the top bar.
`

export function expandHomePath(raw: string | null | undefined): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return ''
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2))
  }
  return value
}

function normalizeWorkspaceRoot(raw: string | null | undefined): string {
  return expandHomePath(raw) || DEFAULT_WORKSPACE_ROOT
}

function normalizeWriteWorkspaceRoot(raw: string | null | undefined): string {
  return expandHomePath(raw) || DEFAULT_WRITE_WORKSPACE_ROOT_ABSOLUTE
}

function normalizeStoredSettings(settings: AppSettingsV1): AppSettingsV1 {
  const normalized = normalizeAppSettings(settings)
  const writeDefaultRoot = normalizeWriteWorkspaceRoot(normalized.write.defaultWorkspaceRoot)
  const writeActiveRoot = normalizeWriteWorkspaceRoot(normalized.write.activeWorkspaceRoot || writeDefaultRoot)
  const writeWorkspaces = [...new Set(
    [writeDefaultRoot, writeActiveRoot, ...normalized.write.workspaces.map(normalizeWriteWorkspaceRoot)]
      .filter(Boolean)
  )]
  return {
    ...normalized,
    workspaceRoot: normalizeWorkspaceRoot(normalized.workspaceRoot),
    write: {
      defaultWorkspaceRoot: writeDefaultRoot,
      activeWorkspaceRoot: writeWorkspaces.includes(writeActiveRoot) ? writeActiveRoot : writeDefaultRoot,
      workspaces: writeWorkspaces.length > 0 ? writeWorkspaces : [writeDefaultRoot],
      inlineCompletion: normalized.write.inlineCompletion
    }
  }
}

function serializeSettingsForDisk(settings: AppSettingsV1): string {
  return JSON.stringify(normalizeStoredSettings(settings), null, 2)
}

function withGeneratedModelRouterRuntimeKey(settings: AppSettingsV1): AppSettingsV1 {
  const modelRouter = getModelRouterSettings(settings)
  const runtimeApiKey = modelRouter.runtimeApiKey.trim()
  if (runtimeApiKey) return settings
  return {
    ...settings,
    modelRouter: {
      ...modelRouter,
      runtimeApiKey: `local-router-${randomUUID()}`
    }
  }
}

function withGeneratedInstallationId(settings: AppSettingsV1): AppSettingsV1 {
  if (settings.installationId?.trim()) return settings
  return {
    ...settings,
    installationId: `sciforge-${randomUUID()}`
  }
}

function withGeneratedInternalHttpSecrets(settings: AppSettingsV1): AppSettingsV1 {
  const scheduleSecret = settings.schedule.internal.secret.trim()
  const workflowSecret = settings.workflow.webhookSecret.trim()
  if (scheduleSecret && workflowSecret) return settings
  return {
    ...settings,
    schedule: {
      ...settings.schedule,
      internal: {
        ...settings.schedule.internal,
        secret: scheduleSecret || createInternalHttpSecret('schedule')
      }
    },
    workflow: {
      ...settings.workflow,
      webhookSecret: workflowSecret || createInternalHttpSecret('workflow')
    }
  }
}

function withGeneratedLocalIds(settings: AppSettingsV1): AppSettingsV1 {
  return withGeneratedInternalHttpSecrets(withGeneratedInstallationId(withGeneratedModelRouterRuntimeKey(settings)))
}

export async function ensureWorkspaceRootExists(workspaceRoot: string): Promise<string> {
  const normalized = normalizeWorkspaceRoot(workspaceRoot)
  await mkdir(normalized, { recursive: true })
  return normalized
}

async function ensureWriteWorkspaceRootsExist(settings: AppSettingsV1): Promise<void> {
  for (const workspaceRoot of settings.write.workspaces) {
    if (!workspaceRoot) continue
    await mkdir(workspaceRoot, { recursive: true })
  }

  const welcomePath = join(settings.write.defaultWorkspaceRoot, 'welcome.md')
  try {
    await writeFile(welcomePath, WELCOME_MARKDOWN, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await readFile(welcomePath, 'utf8').catch(() => '')
    if (!existing.trim()) await writeFile(welcomePath, WELCOME_MARKDOWN, 'utf8')
  }
}

const defaultSettings = (): AppSettingsV1 => ({
  version: 1,
  installationId: '',
  locale: 'en',
  theme: 'system',
  uiFontScale: 'small',
  modelRouter: defaultModelRouterSettings(),
  agentCapabilities: defaultAgentCapabilitySettings(),
  computerUse: defaultComputerUseSettings(),
  runtimeGuards: defaultRuntimeGuardSettings(),
  activeAgentRuntime: 'codex',
  agents: {
    sciforge: defaultLocalRuntimeSettings(),
    codex: defaultCodexRuntimeSettings(),
    claude: defaultClaudeRuntimeSettings()
  },
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  log: {
    enabled: true,
    retentionDays: 2
  },
  notifications: {
    turnComplete: true
  },
  appBehavior: normalizeAppBehaviorSettings(),
  workbenchToolbar: defaultWorkbenchToolbarSettings(),
  keyboardShortcuts: normalizeKeyboardShortcuts(),
  guiUpdate: {
    channel: DEFAULT_GUI_UPDATE_CHANNEL
  },
  codePromptPrefix: '',
  write: defaultWriteSettings(),
  imageGeneration: defaultImageGenerationSettings(),
  skills: defaultSkillsSettings(),
  schedule: defaultScheduleSettings(),
  workflow: defaultWorkflowSettings()
})

type StoredSettingsInput = Partial<AppSettingsV1> & {
  remoteChannel?: unknown
  connectPhone?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function legacySkillExtraDirs(input: StoredSettingsInput): string[] {
  if (!isRecord(input.remoteChannel) || !isRecord(input.remoteChannel.skills)) return []
  return compactStrings(input.remoteChannel.skills.extraDirs)
}

function buildMergedSettings(parsed: StoredSettingsInput): AppSettingsV1 {
  const migrated = parsed
  const defaults = defaultSettings()
  const schedule = mergeScheduleSettings(defaults.schedule, migrated.schedule)
  const workflow = mergeWorkflowSettings(defaults.workflow, migrated.workflow)
  const skills = hasOwn(migrated, 'skills')
    ? mergeSkillsSettings(defaults.skills, migrated.skills)
    : mergeSkillsSettings(defaults.skills, { extraDirs: legacySkillExtraDirs(migrated) })
  return {
    version: 1,
    installationId: migrated.installationId ?? defaults.installationId,
    locale: migrated.locale ?? defaults.locale,
    theme: migrated.theme ?? defaults.theme,
    uiFontScale: migrated.uiFontScale ?? defaults.uiFontScale,
    modelAccess: normalizeModelAccessSettings(migrated.modelAccess),
    modelRouter: mergeModelRouterSettings(defaults.modelRouter, migrated.modelRouter),
    agentCapabilities: mergeAgentCapabilitySettings(defaults.agentCapabilities, migrated.agentCapabilities),
    computerUse: mergeComputerUseSettings(defaults.computerUse, migrated.computerUse),
    runtimeGuards: mergeRuntimeGuardSettings(defaults.runtimeGuards, migrated.runtimeGuards),
    activeAgentRuntime: normalizeAgentRuntimeId(migrated.activeAgentRuntime ?? defaults.activeAgentRuntime),
    agents: {
      ...agentRuntimeSettingsEnvelope(
        mergeLocalRuntimeSettings(getLocalRuntimeSettings(defaults), migrated.agents?.sciforge)
      ),
      codex: mergeCodexRuntimeSettings(
        getCodexRuntimeSettings(defaults),
        migrated.agents?.codex
      ),
      claude: mergeClaudeRuntimeSettings(
        getClaudeRuntimeSettings(defaults),
        migrated.agents?.claude
      )
    },
    workspaceRoot: migrated.workspaceRoot ?? defaults.workspaceRoot,
    log: { ...defaults.log, ...migrated.log },
    notifications: { ...defaults.notifications, ...migrated.notifications },
    appBehavior: normalizeAppBehaviorSettings({
      ...defaults.appBehavior,
      ...migrated.appBehavior
    }),
    workbenchToolbar: normalizeWorkbenchToolbarSettings(migrated.workbenchToolbar),
    keyboardShortcuts: normalizeKeyboardShortcuts(migrated.keyboardShortcuts),
    write: mergeWriteSettings(defaults.write, migrated.write),
    imageGeneration: mergeImageGenerationSettings(defaults.imageGeneration, migrated.imageGeneration),
    skills,
    schedule,
    workflow,
    guiUpdate: { ...defaults.guiUpdate, ...migrated.guiUpdate },
    codePromptPrefix: typeof migrated.codePromptPrefix === 'string' ? migrated.codePromptPrefix : ''
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

async function loadDefaultSettings(): Promise<AppSettingsV1> {
  const defaults = normalizeStoredSettings(defaultSettings())
  await ensureWorkspaceRootExists(defaults.workspaceRoot)
  await ensureWriteWorkspaceRootsExist(defaults)
  return defaults
}

function compatibleSettingsPaths(currentPath: string): string[] {
  const currentUserDataDir = dirname(currentPath)
  const currentDirName = basename(currentUserDataDir)
  if (currentDirName !== APP_USER_DATA_DIR_NAME) return []

  const parentDir = dirname(currentUserDataDir)
  return [APP_PACKAGE_NAME]
    .map((dirName) => join(parentDir, dirName, SETTINGS_FILE_NAME))
}

async function readSettingsFile(
  currentPath: string
): Promise<{ raw: string, sourcePath: string } | null> {
  try {
    return {
      raw: await readFile(currentPath, 'utf8'),
      sourcePath: currentPath
    }
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error
  }

  for (const candidatePath of compatibleSettingsPaths(currentPath)) {
    try {
      return {
        raw: await readFile(candidatePath, 'utf8'),
        sourcePath: candidatePath
      }
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'ENOENT') throw error
    }
  }
  return null
}

export class JsonSettingsStore {
  private path: string
  private cache: AppSettingsV1 | null = null

  constructor(userDataPath: string) {
    this.path = join(userDataPath, SETTINGS_FILE_NAME)
  }

  async load(): Promise<AppSettingsV1> {
    if (this.cache) return this.cache

    let raw = ''
    let sourcePath = this.path
    try {
      const loaded = await readSettingsFile(this.path)
      if (!loaded) {
        const defaults = withGeneratedLocalIds(await loadDefaultSettings())
        await this.save(defaults)
        return defaults
      }
      raw = loaded.raw
      sourcePath = loaded.sourcePath
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to read settings file ${sourcePath}: ${message}`, { cause: error })
    }

    let parsed: StoredSettingsInput
    try {
      parsed = JSON.parse(raw) as StoredSettingsInput
    } catch (error) {
      if (error instanceof SyntaxError) {
        const defaults = withGeneratedLocalIds(await loadDefaultSettings())
        await this.save(defaults)
        console.warn('[sciforge] Invalid settings JSON was replaced with defaults.')
        return defaults
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse settings file ${sourcePath}: ${message}`, { cause: error })
    }

    const normalizedBeforeLocalIds = normalizeStoredSettings(buildMergedSettings(parsed))
    const normalized = withGeneratedLocalIds(normalizedBeforeLocalIds)
    await ensureWorkspaceRootExists(normalized.workspaceRoot)
    await ensureWriteWorkspaceRootsExist(normalized)
    this.cache = normalized
    if (
      getModelRouterSettings(normalized).runtimeApiKey !== getModelRouterSettings(normalizedBeforeLocalIds).runtimeApiKey ||
      normalized.installationId !== normalizedBeforeLocalIds.installationId ||
      normalized.schedule.internal.secret !== normalizedBeforeLocalIds.schedule.internal.secret ||
      normalized.workflow.webhookSecret !== normalizedBeforeLocalIds.workflow.webhookSecret ||
      parsed.activeAgentRuntime !== normalized.activeAgentRuntime ||
      !('agentCapabilities' in parsed) ||
      !hasOwn(parsed, 'skills') ||
      hasOwn(parsed, 'remoteChannel') ||
      hasOwn(parsed, 'connectPhone') ||
      sourcePath !== this.path
    ) {
      await this.save(normalized)
    }
    return this.cache
  }

  async save(data: AppSettingsV1): Promise<void> {
    const normalized = withGeneratedLocalIds(normalizeStoredSettings(data))
    await ensureWorkspaceRootExists(normalized.workspaceRoot)
    await ensureWriteWorkspaceRootsExist(normalized)
    this.cache = normalized
    await mkdir(dirname(this.path), { recursive: true })
    await atomicWriteFile(this.path, serializeSettingsForDisk(normalized))
  }

  async patch(partial: AppSettingsPatch): Promise<AppSettingsV1> {
    const cur = await this.load()
    const {
      agents: agentsPatch,
      modelRouter: modelRouterPatch,
      computerUse: computerUsePatch,
      agentCapabilities: agentCapabilitiesPatch,
      runtimeGuards: runtimeGuardsPatch,
      imageGeneration: imageGenerationPatch,
      speechToText: speechToTextPatch,
      skills: skillsPatch,
    } = partial
    const patchedRuntimeSettings = applyClaudeRuntimePatch(
      applyCodexRuntimePatch(applyLocalRuntimePatch(cur, agentsPatch?.sciforge), agentsPatch?.codex),
      agentsPatch?.claude
    )
    const schedule = mergeScheduleSettings(cur.schedule, partial.schedule)
    const workflow = mergeWorkflowSettings(cur.workflow, partial.workflow)
    const next = withGeneratedLocalIds(normalizeStoredSettings({
      ...patchedRuntimeSettings,
      installationId: partial.installationId ?? cur.installationId,
      locale: partial.locale ?? cur.locale,
      theme: partial.theme ?? cur.theme,
      uiFontScale: partial.uiFontScale ?? cur.uiFontScale,
      activeAgentRuntime: partial.activeAgentRuntime ?? cur.activeAgentRuntime,
      workspaceRoot: partial.workspaceRoot ?? cur.workspaceRoot,
      codePromptPrefix: partial.codePromptPrefix ?? cur.codePromptPrefix,
      modelAccess: mergeModelAccessSettings(cur.modelAccess, partial.modelAccess),
      modelRouter: mergeModelRouterSettings(cur.modelRouter, modelRouterPatch),
      agentCapabilities: mergeAgentCapabilitySettings(cur.agentCapabilities, agentCapabilitiesPatch),
      computerUse: mergeComputerUseSettings(cur.computerUse, computerUsePatch),
      runtimeGuards: mergeRuntimeGuardSettings(cur.runtimeGuards, runtimeGuardsPatch),
      log: { ...cur.log, ...(partial.log ?? {}) },
      notifications: { ...cur.notifications, ...(partial.notifications ?? {}) },
      appBehavior: normalizeAppBehaviorSettings({
        ...cur.appBehavior,
        ...(partial.appBehavior ?? {})
      }),
      workbenchToolbar: mergeWorkbenchToolbarSettings(
        cur.workbenchToolbar,
        partial.workbenchToolbar
      ),
      keyboardShortcuts: normalizeKeyboardShortcuts({
        bindings: {
          ...cur.keyboardShortcuts.bindings,
          ...(partial.keyboardShortcuts?.bindings ?? {})
        }
      }),
      write: mergeWriteSettings(cur.write, partial.write),
      imageGeneration: mergeImageGenerationSettings(cur.imageGeneration, imageGenerationPatch),
      speechToText: mergeSpeechToTextSettings(cur.speechToText, speechToTextPatch),
      skills: mergeSkillsSettings(cur.skills, skillsPatch),
      schedule,
      workflow,
      guiUpdate: { ...cur.guiUpdate, ...(partial.guiUpdate ?? {}) }
    }))
    await this.save(next)
    return next
  }
}

export function getRuntimeBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

export function devServerHintUrl(): string | undefined {
  return process.env.ELECTRON_RENDERER_URL
}
