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
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultAgentCapabilitySettings,
  defaultComputerUseSettings,
  defaultRuntimeGuardSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultRemoteExecutorSettings,
  defaultBioGymSettings,
  defaultImageGenerationSettings,
  getCodexRuntimeSettings,
  getClaudeRuntimeSettings,
  getLocalRuntimeSettings,
  getModelRouterSettings,
  mergeCodexRuntimeSettings,
  mergeClaudeRuntimeSettings,
  mergeLocalRuntimeSettings,
  mergeModelRouterSettings,
  mergeModelProviderSettings,
  mergeComputerUseSettings,
  mergeConnectPhoneSettings,
  mergeAgentCapabilitySettings,
  mergeRuntimeGuardSettings,
  defaultWriteSettings,
  mergeRemoteChannelSettings,
  mergeScheduleSettings,
  mergeSpeechToTextSettings,
  mergeWorkflowSettings,
  mergeRemoteExecutorSettings,
  mergeBioGymSettings,
  mergeWriteSettings,
  mergeImageGenerationSettings,
  normalizeAppBehaviorSettings,
  normalizeKeyboardShortcuts,
  normalizeAppSettings,
  normalizeAgentRuntimeId,
  shouldMigrateLegacyLocalRuntimeMcpSearchDefaults,
  reconcileScheduleWorkflows,
  type AppSettingsPatch,
  type AppSettingsV1,
  type RemoteChannelV1,
  type RemoteChannelConversationV1
} from '../shared/app-settings'
import { APP_SETTINGS_FILE_NAME } from '../shared/app-brand'
import { createInternalHttpSecret } from './internal-http-secret'

export type { AppSettingsV1 }

const DEFAULT_WORKSPACE_ROOT = join(homedir(), '.sciforge', 'default_workspace')
const DEFAULT_REMOTE_CHANNELS_ROOT = join(homedir(), '.sciforge', 'remote-channel')
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

function sanitizePathSegment(raw: string | null | undefined, fallback: string): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  const sanitized = value
    .replace(/[\\/]/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || fallback
}

function defaultClawChannelWorkspaceRoot(channel: RemoteChannelV1): string {
  const credential = channel.platformCredential
  const domain = credential?.kind === 'feishu'
    ? credential.domain
    : credential?.kind === 'weixin'
      ? 'weixin'
      : credential?.kind === 'discord'
        ? sanitizePathSegment(credential.guildName || credential.guildId, 'discord')
        : channel.provider
  const credentialId = credential?.kind === 'feishu'
    ? credential.appId
    : credential?.kind === 'weixin'
      ? credential.accountId
      : credential?.kind === 'discord'
        ? credential.channelId
        : ''
  const workspaceId = sanitizePathSegment(credentialId || channel.id, 'channel')
  return join(DEFAULT_REMOTE_CHANNELS_ROOT, channel.provider, domain, workspaceId)
}

function normalizeClawChannelWorkspaceRoot(channel: RemoteChannelV1): string {
  return expandHomePath(channel.workspaceRoot) || defaultClawChannelWorkspaceRoot(channel)
}

function sanitizeConversationWorkspaceSegment(conversation: RemoteChannelConversationV1): string {
  return sanitizePathSegment(
    conversation.remoteThreadId || conversation.chatId,
    conversation.id || 'conversation'
  )
}

function defaultClawConversationWorkspaceRoot(
  channel: RemoteChannelV1,
  conversation: RemoteChannelConversationV1
): string {
  return join(normalizeClawChannelWorkspaceRoot(channel), 'conversations', sanitizeConversationWorkspaceSegment(conversation))
}

function normalizeClawConversationWorkspaceRoot(
  channel: RemoteChannelV1,
  conversation: RemoteChannelConversationV1
): string {
  return expandHomePath(conversation.workspaceRoot) || defaultClawConversationWorkspaceRoot(channel, conversation)
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
    },
    remoteChannel: {
      ...normalized.remoteChannel,
      channels: normalized.remoteChannel.channels.map((channel) => ({
        ...channel,
        workspaceRoot: normalizeClawChannelWorkspaceRoot(channel),
        conversations: channel.conversations.map((conversation) => ({
          ...conversation,
          workspaceRoot: normalizeClawConversationWorkspaceRoot(channel, conversation)
        }))
      }))
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

async function ensureClawChannelWorkspaceRootsExist(settings: AppSettingsV1): Promise<void> {
  for (const channel of settings.remoteChannel.channels) {
    const workspaceRoot = normalizeClawChannelWorkspaceRoot(channel)
    if (!workspaceRoot) continue
    await mkdir(workspaceRoot, { recursive: true })
    for (const conversation of channel.conversations) {
      const conversationWorkspaceRoot = normalizeClawConversationWorkspaceRoot(channel, conversation)
      if (!conversationWorkspaceRoot) continue
      await mkdir(conversationWorkspaceRoot, { recursive: true })
    }
  }
}

const defaultSettings = (): AppSettingsV1 => ({
  version: 1,
  installationId: '',
  locale: 'en',
  theme: 'system',
  uiFontScale: 'small',
  provider: defaultModelProviderSettings(),
  modelRouter: defaultModelRouterSettings(),
  agentCapabilities: defaultAgentCapabilitySettings(),
  computerUse: defaultComputerUseSettings(),
  runtimeGuards: defaultRuntimeGuardSettings(),
  activeAgentRuntime: 'sciforge',
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
  keyboardShortcuts: normalizeKeyboardShortcuts(),
  guiUpdate: {
    channel: DEFAULT_GUI_UPDATE_CHANNEL
  },
  codePromptPrefix: '',
  write: defaultWriteSettings(),
  imageGeneration: defaultImageGenerationSettings(),
  remoteChannel: defaultRemoteChannelSettings(),
  connectPhone: defaultConnectPhoneSettings(),
  schedule: defaultScheduleSettings(),
  workflow: defaultWorkflowSettings(),
  remoteExecutor: defaultRemoteExecutorSettings(),
  biogym: defaultBioGymSettings()
})

function buildMergedSettings(parsed: Partial<AppSettingsV1>): AppSettingsV1 {
  const migrated = parsed
  const defaults = defaultSettings()
  const schedule = mergeScheduleSettings(defaults.schedule, migrated.schedule)
  const workflow = reconcileScheduleWorkflows(
    mergeWorkflowSettings(defaults.workflow, migrated.workflow),
    schedule
  )
  return {
    version: 1,
    installationId: migrated.installationId ?? defaults.installationId,
    locale: migrated.locale ?? defaults.locale,
    theme: migrated.theme ?? defaults.theme,
    uiFontScale: migrated.uiFontScale ?? defaults.uiFontScale,
    provider: mergeModelProviderSettings(defaults.provider, migrated.provider),
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
    keyboardShortcuts: normalizeKeyboardShortcuts(migrated.keyboardShortcuts),
    write: mergeWriteSettings(defaults.write, migrated.write),
    imageGeneration: mergeImageGenerationSettings(defaults.imageGeneration, migrated.imageGeneration),
    remoteChannel: mergeRemoteChannelSettings(defaults.remoteChannel, migrated.remoteChannel),
    connectPhone: mergeConnectPhoneSettings(defaults.connectPhone, migrated.connectPhone),
    schedule,
    workflow,
    remoteExecutor: mergeRemoteExecutorSettings(defaults.remoteExecutor, migrated.remoteExecutor),
    biogym: mergeBioGymSettings(defaults.biogym, migrated.biogym),
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
  await ensureClawChannelWorkspaceRootsExist(defaults)
  return defaults
}

async function writeInvalidSettingsBackup(path: string, raw: string): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(
    dirname(path),
    `${basename(path, '.json')}.invalid-${stamp}.json`
  )
  try {
    await writeFile(backupPath, raw, 'utf8')
    return backupPath
  } catch {
    return null
  }
}

async function readSettingsFile(
  currentPath: string
): Promise<string | null> {
  try {
    return await readFile(currentPath, 'utf8')
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error
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
      raw = loaded
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to read settings file ${sourcePath}: ${message}`, { cause: error })
    }

    let parsed: Partial<AppSettingsV1>
    try {
      parsed = JSON.parse(raw) as Partial<AppSettingsV1>
    } catch (error) {
      if (error instanceof SyntaxError) {
        const backupPath = await writeInvalidSettingsBackup(sourcePath, raw)
        const defaults = withGeneratedLocalIds(await loadDefaultSettings())
        await this.save(defaults)
        if (backupPath) {
          console.warn(
            `[sciforge] Invalid settings JSON was replaced with defaults. Backup: ${backupPath}`
          )
        } else {
          console.warn(
            `[sciforge] Invalid settings JSON was replaced with defaults. Backup could not be written for ${sourcePath}.`
          )
        }
        return defaults
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse settings file ${sourcePath}: ${message}`, { cause: error })
    }

    const normalizedBeforeLocalIds = normalizeStoredSettings(buildMergedSettings(parsed))
    const normalized = withGeneratedLocalIds(normalizedBeforeLocalIds)
    const migratedLegacyMcpSearchDefaults = shouldMigrateLegacyLocalRuntimeMcpSearchDefaults(
      parsed.agents?.sciforge?.mcpSearch
    )
    await ensureWorkspaceRootExists(normalized.workspaceRoot)
    await ensureWriteWorkspaceRootsExist(normalized)
    await ensureClawChannelWorkspaceRootsExist(normalized)
    this.cache = normalized
    if (
      getModelRouterSettings(normalized).runtimeApiKey !== getModelRouterSettings(normalizedBeforeLocalIds).runtimeApiKey ||
      normalized.installationId !== normalizedBeforeLocalIds.installationId ||
      normalized.schedule.internal.secret !== normalizedBeforeLocalIds.schedule.internal.secret ||
      normalized.workflow.webhookSecret !== normalizedBeforeLocalIds.workflow.webhookSecret ||
      !('remoteExecutor' in parsed) ||
      !('biogym' in parsed) ||
      !('agentCapabilities' in parsed) ||
      migratedLegacyMcpSearchDefaults
    ) {
      await this.save(normalized)
    }
    return this.cache
  }

  async save(data: AppSettingsV1): Promise<void> {
    const normalized = withGeneratedLocalIds(normalizeStoredSettings(data))
    await ensureWorkspaceRootExists(normalized.workspaceRoot)
    await ensureWriteWorkspaceRootsExist(normalized)
    await ensureClawChannelWorkspaceRootsExist(normalized)
    this.cache = normalized
    await mkdir(dirname(this.path), { recursive: true })
    await atomicWriteFile(this.path, serializeSettingsForDisk(normalized))
  }

  async patch(partial: AppSettingsPatch): Promise<AppSettingsV1> {
    const cur = await this.load()
    const {
      agents: agentsPatch,
      provider: providerPatch,
      modelRouter: modelRouterPatch,
      computerUse: computerUsePatch,
      agentCapabilities: agentCapabilitiesPatch,
      runtimeGuards: runtimeGuardsPatch,
      imageGeneration: imageGenerationPatch,
      speechToText: speechToTextPatch,
      connectPhone: connectPhonePatch,
      remoteExecutor: remoteExecutorPatch,
      biogym: biogymPatch,
    } = partial
    const patchedRuntimeSettings = applyClaudeRuntimePatch(
      applyCodexRuntimePatch(applyLocalRuntimePatch(cur, agentsPatch?.sciforge), agentsPatch?.codex),
      agentsPatch?.claude
    )
    const schedule = mergeScheduleSettings(cur.schedule, partial.schedule)
    const workflow = reconcileScheduleWorkflows(
      mergeWorkflowSettings(cur.workflow, partial.workflow),
      schedule
    )
    const next = withGeneratedLocalIds(normalizeStoredSettings({
      ...patchedRuntimeSettings,
      installationId: partial.installationId ?? cur.installationId,
      locale: partial.locale ?? cur.locale,
      theme: partial.theme ?? cur.theme,
      uiFontScale: partial.uiFontScale ?? cur.uiFontScale,
      activeAgentRuntime: partial.activeAgentRuntime ?? cur.activeAgentRuntime,
      workspaceRoot: partial.workspaceRoot ?? cur.workspaceRoot,
      codePromptPrefix: partial.codePromptPrefix ?? cur.codePromptPrefix,
      provider: mergeModelProviderSettings(cur.provider, providerPatch),
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
      keyboardShortcuts: normalizeKeyboardShortcuts({
        bindings: {
          ...cur.keyboardShortcuts.bindings,
          ...(partial.keyboardShortcuts?.bindings ?? {})
        }
      }),
      write: mergeWriteSettings(cur.write, partial.write),
      imageGeneration: mergeImageGenerationSettings(cur.imageGeneration, imageGenerationPatch),
      speechToText: mergeSpeechToTextSettings(cur.speechToText, speechToTextPatch),
      remoteChannel: mergeRemoteChannelSettings(cur.remoteChannel, partial.remoteChannel),
      connectPhone: mergeConnectPhoneSettings(cur.connectPhone, connectPhonePatch),
      schedule,
      workflow,
      remoteExecutor: mergeRemoteExecutorSettings(cur.remoteExecutor, remoteExecutorPatch),
      biogym: mergeBioGymSettings(cur.biogym, biogymPatch),
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
