import type { DsGuiApi } from '@shared/ds-gui-api'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:5174'
const CLIENT_ID_STORAGE_KEY = 'deepseek-gui.dev-browser-bridge.client-id'

type BridgeEnvelope<T> =
  | { ok: true; payload: T }
  | { ok: false; message?: string }

type BridgeMessage = {
  channel: string
  payload: unknown
}

type ChannelHandler = (payload: never) => void

let installed = false
let eventSource: EventSource | null = null
let clientId = ''
let bridgeUrl = DEFAULT_BRIDGE_URL
const channelHandlers = new Map<string, Set<ChannelHandler>>()

function detectPlatform(): string {
  const platform = globalThis.navigator?.platform?.toLowerCase?.() ?? ''
  if (platform.includes('mac')) return 'darwin'
  if (platform.includes('win')) return 'win32'
  if (platform.includes('linux')) return 'linux'
  return 'browser'
}

function storageGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function storageSet(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value)
  } catch {
    /* best effort only */
  }
}

function resolveClientId(): string {
  const existing = storageGet(globalThis.sessionStorage, CLIENT_ID_STORAGE_KEY)
  if (existing) return existing
  const created = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  storageSet(globalThis.sessionStorage, CLIENT_ID_STORAGE_KEY, created)
  return created
}

function ensureEventSource(): void {
  if (eventSource || typeof EventSource === 'undefined') return
  eventSource = new EventSource(`${bridgeUrl}/events?clientId=${encodeURIComponent(clientId)}`)
  eventSource.addEventListener('bridge-message', (event) => {
    let message: BridgeMessage
    try {
      message = JSON.parse(event.data) as BridgeMessage
    } catch {
      return
    }
    if (!message || typeof message.channel !== 'string') return
    for (const handler of channelHandlers.get(message.channel) ?? []) {
      handler(message.payload as never)
    }
  })
}

function onChannel<T>(channel: string, handler: (payload: T) => void): () => void {
  ensureEventSource()
  const handlers = channelHandlers.get(channel) ?? new Set<ChannelHandler>()
  const wrapped = handler as ChannelHandler
  handlers.add(wrapped)
  channelHandlers.set(channel, handlers)
  return () => {
    handlers.delete(wrapped)
    if (handlers.size === 0) channelHandlers.delete(channel)
  }
}

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const response = await fetch(`${bridgeUrl}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DeepSeek-Gui-Client': clientId
    },
    body: JSON.stringify({ channel, payload })
  })
  const envelope = await response.json().catch(() => ({
    ok: false,
    message: `Bridge returned HTTP ${response.status}.`
  })) as BridgeEnvelope<T>
  if (!envelope.ok) {
    throw new Error(envelope.message ?? `Bridge request failed for ${channel}.`)
  }
  if (!response.ok) {
    throw new Error(`Bridge returned HTTP ${response.status} for ${channel}.`)
  }
  return envelope.payload
}

function createApi(): DsGuiApi {
  return {
    platform: detectPlatform(),
    getSettings: () => invoke('settings:get'),
    setSettings: (partial) => invoke('settings:set', partial),
    fetchUpstreamModels: () => invoke('upstream:models'),
    getClawStatus: () => invoke('claw:status'),
    runClawTask: (taskId) => invoke('claw:task:run', taskId),
    getScheduleStatus: () => invoke('schedule:status'),
    runScheduleTask: (taskId) => invoke('schedule:task:run', taskId),
    startClawImInstallQr: (provider, options) =>
      invoke('claw:im-install:qrcode', { provider, isLark: options?.isLark }),
    pollClawImInstall: (provider, deviceCode) =>
      invoke('claw:im-install:poll', { provider, deviceCode }),
    getDiscordBotStatus: () => invoke('discord:status'),
    configureDiscordClientId: (clientId) =>
      invoke('discord:configure-client', { clientId }),
    configureDiscordBotToken: (token, clientId) =>
      invoke('discord:configure-token', { token, ...(clientId ? { clientId } : {}) }),
    configureDiscordProxy: (proxyUrl) =>
      invoke('discord:configure-proxy', { proxyUrl }),
    listDiscordGuilds: () => invoke('discord:guilds'),
    listDiscordChannels: (guildId) =>
      invoke('discord:channels', { guildId }),
    bindDiscordChannel: (payload) =>
      invoke('discord:bind-channel', payload),
    testDiscordChannel: (channelId, text, channelConfigId) =>
      invoke('discord:test-send', { channelId, text, ...(channelConfigId ? { channelConfigId } : {}) }),
    setDiscordGuard: (enabled, channelConfigId, forceTakeover) =>
      invoke('discord:set-guard', {
        enabled,
        ...(channelConfigId ? { channelConfigId } : {}),
        ...(forceTakeover ? { forceTakeover } : {})
      }),
    pickWorkspaceDirectory: (defaultPath) => invoke('workspace:pick-directory', defaultPath),
    listSkills: (workspaceRoot) => invoke('skill:list', { workspaceRoot }),
    saveSkillFile: (rootPath, skillName, content) =>
      invoke('skill:save-file', { rootPath, skillName, content }),
    openSkillRoot: (rootPath) => invoke('skill:open-root', rootPath),
    getDeepseekConfigFile: () => invoke('deepseek:config:read'),
    setDeepseekConfigFile: (content) => invoke('deepseek:config:write', content),
    openDeepseekConfigDir: () => invoke('deepseek:config:open-dir'),
    openModelRouterConfigFile: () => invoke('modelRouter:config:open'),
    getGitBranches: (workspaceRoot) => invoke('git:branches', workspaceRoot),
    switchGitBranch: (workspaceRoot, branch) =>
      invoke('git:switch-branch', { workspaceRoot, branch }),
    createAndSwitchGitBranch: (workspaceRoot, branch) =>
      invoke('git:create-and-switch-branch', { workspaceRoot, branch }),
    listEditors: () => invoke('editor:list'),
    openEditorPath: (options) => invoke('editor:open-path', options),
    listWorkspaceDirectory: (options) => invoke('file:list-workspace-directory', options),
    resolveWorkspaceFile: (options) => invoke('file:resolve-workspace', options),
    readWorkspaceFile: (options) => invoke('file:read-workspace', options),
    readWorkspaceImage: (options) => invoke('file:read-workspace-image', options),
    writeWorkspaceFile: (payload) => invoke('file:write-workspace', payload),
    createWorkspaceFile: (payload) => invoke('file:create-workspace', payload),
    createWorkspaceDirectory: (payload) => invoke('file:create-workspace-directory', payload),
    saveWorkspaceClipboardImage: (payload) => invoke('file:save-workspace-clipboard-image', payload),
    readClipboardImage: () => invoke('clipboard:read-image'),
    renameWorkspaceEntry: (payload) => invoke('file:rename-workspace-entry', payload),
    deleteWorkspaceEntry: (payload) => invoke('file:delete-workspace-entry', payload),
    watchWorkspaceFile: (payload) => invoke('file:watch-workspace', payload),
    unwatchWorkspaceFile: (watchId) => invoke('file:unwatch-workspace', watchId),
    onWorkspaceFileChanged: (handler) => onChannel('file:workspace-changed', handler),
    requestWriteInlineCompletion: (payload) => invoke('write:inline-completion', payload),
    retrieveWriteContext: (payload) => invoke('write:retrieve-context', payload),
    listWriteInlineCompletionDebugEntries: () => invoke('write:inline-completion-debug:list'),
    clearWriteInlineCompletionDebugEntries: () => invoke('write:inline-completion-debug:clear'),
    exportWriteDocument: (payload) => invoke('write:export', payload),
    copyWriteDocumentAsRichText: (payload) => invoke('write:copy-rich-text', payload),
    speechToText: {
      transcribe: (payload) => invoke('speech:transcribe', payload)
    },
    paperRadar: {
      status: () => invoke('paperRadar:status'),
      syncArxiv: (payload) => invoke('paperRadar:sync-arxiv', payload),
      syncBiorxiv: (payload) => invoke('paperRadar:sync-biorxiv', payload),
      syncProfile: (payload) => invoke('paperRadar:sync-profile', payload),
      listProfiles: () => invoke('paperRadar:profiles:list'),
      saveProfile: (payload) => invoke('paperRadar:profiles:save', payload),
      search: (payload) => invoke('paperRadar:search', payload),
      rank: (payload) => invoke('paperRadar:rank', payload),
      digest: (payload) => invoke('paperRadar:digest', payload)
    },
    onRuntimeStatus: (handler) => onChannel('runtime:status', handler),
    agentRuntime: {
      connect: (runtimeId) => invoke('agentRuntime:connect', { runtimeId }),
      capabilities: (runtimeId) => invoke('agentRuntime:capabilities', { runtimeId }),
      listThreads: (input) => invoke('agentRuntime:listThreads', input ?? {}),
      startThread: (input) => invoke('agentRuntime:startThread', input),
      readThread: (input) => invoke('agentRuntime:readThread', input),
      startTurn: (input) => invoke('agentRuntime:startTurn', input),
      interruptTurn: (input) => invoke('agentRuntime:interruptTurn', input),
      steerTurn: (input) => invoke('agentRuntime:steerTurn', input),
      subscribeEvents: (input) => invoke('agentRuntime:subscribeEvents', input),
      stopEvents: (streamId) => invoke('agentRuntime:stopEvents', streamId),
      renameThread: (input) => invoke('agentRuntime:renameThread', input),
      deleteThread: (input) => invoke('agentRuntime:deleteThread', input),
      compactThread: (input) => invoke('agentRuntime:compactThread', input),
      forkThread: (input) => invoke('agentRuntime:forkThread', input),
      resumeSession: (input) => invoke('agentRuntime:resumeSession', input),
      updateThreadRelation: (input) => invoke('agentRuntime:updateThreadRelation', input),
      usage: (input) => invoke('agentRuntime:usage', input),
      auxiliary: (input) => invoke('agentRuntime:auxiliary', input),
      resolveApproval: (input) => invoke('agentRuntime:resolveApproval', input),
      resolveUserInput: (input) => invoke('agentRuntime:resolveUserInput', input),
      onEvent: (handler) => onChannel('agentRuntime:event', handler),
      onEnd: (handler) => onChannel('agentRuntime:end', handler),
      onError: (handler) => onChannel('agentRuntime:error', handler)
    },
    onClawChannelActivity: (handler) => onChannel('claw:channel-activity', handler),
    updateClawActiveThreadContext: (payload) =>
      invoke('claw:active-thread-context', payload),
    mirrorClawChannelMessage: (threadId, text, direction) =>
      invoke('claw:channel:mirror', { threadId, text, direction }),
    mirrorClawChannelMessageToFeishu: (threadId, text, direction) =>
      invoke('claw:channel:mirror-to-feishu', { threadId, text, direction }),
    createClawTaskFromText: (text, options) =>
      invoke('claw:task:create-from-text', {
        text,
        channelId: options?.channelId,
        modelHint: options?.modelHint,
        mode: options?.mode
      }),
    createScheduleTaskFromText: (text, options) =>
      invoke('schedule:task:create-from-text', {
        text,
        workspaceRoot: options?.workspaceRoot,
        modelHint: options?.modelHint,
        mode: options?.mode
    }),
    runDesktopCommand: (command) => invoke('desktop:command', command),
    openExternal: (url) => invoke('shell:open-external', url),
    openEvidenceDag: (input) => invoke('evidenceDag:open', input),
    showTurnCompleteNotification: (payload) => invoke('notification:turn-complete', payload),
    getAppVersion: () => invoke('app:version'),
    getGuiUpdateState: () => invoke('gui:update-state'),
    checkGuiUpdate: (channel) => invoke('gui:update-check', channel),
    downloadGuiUpdate: (channel) => invoke('gui:update-download', channel),
    installGuiUpdate: () => invoke('gui:update-install'),
    onGuiUpdateState: (handler) => onChannel('gui:update-state', handler),
    logError: (category, message, detail) => invoke('log:error', { category, message, detail }),
    getLogPath: () => invoke('log:get-path'),
    openLogDir: () => invoke('log:open-dir'),
    getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name
  }
}

export function installDevDsGuiBridge(): void {
  if (installed || !import.meta.env.DEV || typeof window === 'undefined' || window.dsGui) return
  installed = true
  bridgeUrl = DEFAULT_BRIDGE_URL
  clientId = resolveClientId()
  window.dsGui = createApi()
  ensureEventSource()
}
