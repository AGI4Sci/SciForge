import type { SciForgeApi } from '@shared/sciforge-api'
import type { VisibleContextSnapshot } from '@shared/visible-context'
import { serializeCapabilityResourceContentAccess } from '@shared/workspace-preview-asset-url'
import {
  captureDevBrowserSurface,
  type DevBrowserSurfaceCaptureRequest
} from './dev-browser-surface-capture'

const DEV_BRIDGE_PROXY_PATH = '/__sciforge-dev-bridge'
const DEV_INSTANCE_ID = typeof __SCIFORGE_DEV_INSTANCE_ID__ === 'string'
  ? __SCIFORGE_DEV_INSTANCE_ID__.trim()
  : ''
const PAGE_INCARNATION_CLIENT_ID = globalThis.crypto?.randomUUID?.()
  ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

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
let bridgeUrl = ''
let lastPublishedVisibleContextRevision: number | null = null
const channelHandlers = new Map<string, Set<ChannelHandler>>()

function defaultBridgeUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location?.origin : ''
  return origin ? `${origin}${DEV_BRIDGE_PROXY_PATH}` : 'http://127.0.0.1:5174'
}

function detectPlatform(): string {
  const platform = globalThis.navigator?.platform?.toLowerCase?.() ?? ''
  if (platform.includes('mac')) return 'darwin'
  if (platform.includes('win')) return 'win32'
  if (platform.includes('linux')) return 'linux'
  return 'browser'
}

function resolveClientId(): string {
  return PAGE_INCARNATION_CLIENT_ID
}

function ensureEventSource(): void {
  if (eventSource || typeof EventSource === 'undefined') return
  const eventsUrl = new URL(`${bridgeUrl.replace(/\/$/, '')}/events`)
  eventsUrl.searchParams.set('clientId', clientId)
  if (DEV_INSTANCE_ID) eventsUrl.searchParams.set('devInstanceId', DEV_INSTANCE_ID)
  eventSource = new EventSource(eventsUrl.toString())
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
      'X-SciForge-Client': clientId,
      ...(DEV_INSTANCE_ID ? { 'X-SciForge-Dev-Instance': DEV_INSTANCE_ID } : {})
    },
    body: JSON.stringify({ channel, payload })
  }).catch((error) => {
    const reason = error instanceof Error && error.message ? ` ${error.message}` : ''
    throw new Error(`Desktop dev bridge is not reachable at ${bridgeUrl}. Start or restart the Electron dev app, then retry.${reason}`)
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

async function submitSurfaceCapture(request: DevBrowserSurfaceCaptureRequest): Promise<void> {
  const capture = await captureDevBrowserSurface(
    request,
    () => lastPublishedVisibleContextRevision
  )
  const response = await fetch(`${bridgeUrl}/surface-capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SciForge-Client': clientId,
      ...(DEV_INSTANCE_ID ? { 'X-SciForge-Dev-Instance': DEV_INSTANCE_ID } : {})
    },
    body: JSON.stringify(capture)
  })
  if (!response.ok) {
    const envelope = await response.json().catch(() => null) as { message?: unknown } | null
    const message = typeof envelope?.message === 'string'
      ? envelope.message
      : `Bridge returned HTTP ${response.status}.`
    throw new Error(`Browser pixel capture was rejected: ${message}`)
  }
}

function createApi(): SciForgeApi {
  const publishVisibleContext: SciForgeApi['visibleContext']['publish'] = async (snapshot) => {
    const published = await invoke<VisibleContextSnapshot>('visibleContext:publish', snapshot)
    lastPublishedVisibleContextRevision = published.revision
    return published
  }
  const getConnectPhoneStatus: SciForgeApi['getConnectPhoneStatus'] = () => invoke('connectPhone:status')
  const startConnectPhoneInstallQr: SciForgeApi['startConnectPhoneInstallQr'] = (provider, options) =>
    invoke('connectPhone:install:qrcode', { provider, isLark: options?.isLark })
  const pollConnectPhoneInstall: SciForgeApi['pollConnectPhoneInstall'] = (provider, deviceCode) =>
    invoke('connectPhone:install:poll', { provider, deviceCode })
  const onRemoteChannelActivity: SciForgeApi['onRemoteChannelActivity'] = (handler) =>
    onChannel('remoteChannel:activity', handler)
  const updateRemoteChannelActiveThreadContext: SciForgeApi['updateRemoteChannelActiveThreadContext'] = (payload) =>
    invoke('remoteChannel:active-thread-context', payload)
  const mirrorRemoteChannelMessage: SciForgeApi['mirrorRemoteChannelMessage'] = (threadId, text, direction) =>
    invoke('remoteChannel:message:mirror', { threadId, text, direction })
  const createRemoteChannelTaskFromText: SciForgeApi['createRemoteChannelTaskFromText'] = (text, options) =>
    invoke('remoteChannel:task:create-from-text', {
      text,
      channelId: options?.channelId,
      modelHint: options?.modelHint,
      mode: options?.mode
    })
  const onSettingsChanged: SciForgeApi['onSettingsChanged'] = (handler) =>
    onChannel('settings:changed', handler)

  return {
    platform: detectPlatform(),
    getSettings: () => invoke('settings:get'),
    setSettings: (partial) => invoke('settings:set', partial),
    onSettingsChanged,
    remoteWorkspace: {
      list: () => invoke('remoteWorkspace:list'),
      get: () => invoke('remoteWorkspace:get'),
      attach: (input) => invoke('remoteWorkspace:attach', input),
      select: (input) => invoke('remoteWorkspace:select', input),
      reconnect: (input) => invoke('remoteWorkspace:reconnect', input),
      close: (input) => invoke('remoteWorkspace:close', input),
      onSnapshotChanged: (handler) =>
        onChannel('remoteWorkspace:snapshot-changed', handler)
    },
    getModelAccessStatus: () => invoke('modelAccess:status'),
    fetchUpstreamModels: () => invoke('upstream:models'),
    traces: {
      read: (query) => invoke('traces:read', query ?? {}),
      summaries: (query) => invoke('traces:summaries', query ?? {}),
      export: (traceIds) => invoke('traces:export', { traceIds }),
      clear: () => invoke('traces:clear')
    },
    extensions: {
      list: () => invoke('extensions:list'),
      install: (input) => invoke('extensions:install', input),
      uninstall: (input) => invoke('extensions:uninstall', input),
      rollback: (input) => invoke('extensions:rollback', input),
      setEnabled: (input) => invoke('extensions:set-enabled', input)
    },
    getConnectPhoneStatus,
    getScheduleStatus: () => invoke('schedule:status'),
    runScheduleTask: (taskId) => invoke('schedule:task:run', taskId),
    startConnectPhoneInstallQr,
    pollConnectPhoneInstall,
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
    getZulipBotStatus: () => invoke('zulip:status'),
    configureZulipBot: (payload) => invoke('zulip:configure', payload),
    listZulipStreams: () => invoke('zulip:streams'),
    listZulipTopics: (streamId) => invoke('zulip:topics', { streamId }),
    bindZulipChannel: (payload) => invoke('zulip:bind-channel', payload),
    testZulipChannel: (channelId, text, channelConfigId, topicName) =>
      invoke('zulip:test-send', {
        channelId,
        ...(text ? { text } : {}),
        ...(channelConfigId ? { channelConfigId } : {}),
        ...(topicName ? { topicName } : {})
      }),
    setZulipGuard: (enabled, channelConfigId, forceTakeover) =>
      invoke('zulip:set-guard', {
        enabled,
        ...(channelConfigId ? { channelConfigId } : {}),
        ...(forceTakeover ? { forceTakeover } : {})
      }),
    pickWorkspaceDirectory: (defaultPath) => invoke('workspace:pick-directory', defaultPath),
    pickFile: (request) => invoke('workspace:pick-file', request),
    buildScientificSkillsMcpConfig: (workspaceRoot) =>
      invoke('mcp:scientific-skills-config', { workspaceRoot }),
    buildBgcDiscoveryMcpConfig: (workspaceRoot) =>
      invoke('mcp:bgc-discovery-config', { workspaceRoot }),
    buildImageGenerationMcpConfig: (workspaceRoot) =>
      invoke('mcp:image-generation-config', { workspaceRoot }),
    buildPptMasterMcpConfig: (workspaceRoot) =>
      invoke('mcp:ppt-master-config', { workspaceRoot }),
    getScientificSkillsStatus: (workspaceRoot) =>
      invoke('mcp:scientific-skills-status', { workspaceRoot }),
    installScientificSkills: (request) =>
      invoke('scientific-skills:install', request),
    listSkills: (workspaceRoot) => invoke('skill:list', { workspaceRoot }),
    saveSkillFile: (rootPath, skillName, content) =>
      invoke('skill:save-file', { rootPath, skillName, content }),
    openSkillRoot: (rootPath) => invoke('skill:open-root', rootPath),
    getGitBranches: (workspaceRoot, workspaceLocator) => invoke('git:branches', {
      workspaceRoot,
      ...(workspaceLocator ? { workspaceLocator } : {})
    }),
    switchGitBranch: (workspaceRoot, branch, workspaceLocator) =>
      invoke('git:switch-branch', {
        workspaceRoot,
        branch,
        ...(workspaceLocator ? { workspaceLocator } : {})
      }),
    createAndSwitchGitBranch: (workspaceRoot, branch, workspaceLocator) =>
      invoke('git:create-and-switch-branch', {
        workspaceRoot,
        branch,
        ...(workspaceLocator ? { workspaceLocator } : {})
      }),
    listEditors: () => invoke('editor:list'),
    openEditorPath: (options) => invoke('editor:open-path', options),
    listWorkspaceDirectory: (options) => invoke('file:list-workspace-directory', options),
    resolveWorkspaceFile: (options) => invoke('file:resolve-workspace', options),
    readWorkspaceFile: (options) => invoke('file:read-workspace', options),
    readWorkspaceImage: (options) => invoke('file:read-workspace-image', options),
    writeWorkspaceFile: (payload) => invoke('file:write-workspace', payload),
    readWorkspaceFileRange: (payload) => invoke('file:read-workspace-range', payload),
    searchWorkspaceText: (payload) => invoke('file:search-workspace-text', payload),
    createWorkspaceFile: (payload) => invoke('file:create-workspace', payload),
    createWorkspaceDirectory: (payload) => invoke('file:create-workspace-directory', payload),
    saveWorkspaceClipboardImage: (payload) => invoke('file:save-workspace-clipboard-image', payload),
    readClipboardImage: () => invoke('clipboard:read-image'),
    pasteWorkspaceClipboard: (payload) => invoke('clipboard:paste-workspace', payload),
    renameWorkspaceEntry: (payload) => invoke('file:rename-workspace-entry', payload),
    suggestWorkspacePdfName: (payload) => invoke('file:suggest-workspace-pdf-name', payload),
    copyWorkspaceEntry: (payload) => invoke('file:copy-workspace-entry', payload),
    importWorkspaceEntries: (payload) => invoke('file:import-workspace-entries', payload),
    moveWorkspaceEntry: (payload) => invoke('file:move-workspace-entry', payload),
    deleteWorkspaceEntry: (payload) => invoke('file:delete-workspace-entry', payload),
    watchWorkspaceFile: (payload) => invoke('file:watch-workspace', payload),
    unwatchWorkspaceFile: (watchId) => invoke('file:unwatch-workspace', watchId),
    onWorkspaceFileChanged: (handler) => onChannel('file:workspace-changed', handler),
    capabilities: {
      readiness: (input) => invoke('capability:readiness', input),
      discover: (input = {}) => invoke('capability:discover', input),
      observe: (input) => invoke('capability:observe', input),
      bind: (input) => invoke('capability:bind', input),
      invoke: (input) => invoke('capability:invoke', input),
      events: (input = {}) => invoke('capability:events', input),
      subscribe: (workspaceId) => invoke('capability:subscribe', { workspaceId }),
      unsubscribe: (subscriptionId) => invoke('capability:unsubscribe', { subscriptionId }),
      resourceContentUrl: (access) => {
        const url = new URL(`${bridgeUrl.replace(/\/$/, '')}/capability/resources/content`)
        url.searchParams.set('clientId', clientId)
        if (DEV_INSTANCE_ID) url.searchParams.set('devInstanceId', DEV_INSTANCE_ID)
        url.searchParams.set('access', serializeCapabilityResourceContentAccess(access))
        return url.toString()
      },
      onEvent: (handler) => onChannel('capability:event', handler)
    },
    requestWriteInlineCompletion: (payload) => invoke('write:inline-completion', payload),
    retrieveWriteContext: (payload) => invoke('write:retrieve-context', payload),
    listWriteInlineCompletionDebugEntries: () => invoke('write:inline-completion-debug:list'),
    clearWriteInlineCompletionDebugEntries: () => invoke('write:inline-completion-debug:clear'),
    exportWriteDocument: (payload) => invoke('write:export', payload),
    visibleContext: {
      publish: publishVisibleContext,
      get: () => invoke('visibleContext:get'),
      registeredTargetRef: (request) =>
        invoke('visibleContext:target-ref', request),
      readCapturePreview: (request) => invoke('visibleContext:capture:preview', request),
      onRefreshRequested: (handler) => onChannel('visibleContext:refresh-requested', handler),
      onCaptureStateChanged: (handler) => onChannel('visibleContext:capture-state', handler)
    },
    speechToText: {
      transcribe: (payload) => invoke('speech:transcribe', payload)
    },
    researchCards: {
      list: (input) => invoke('researchCards:list', input ?? {}),
      create: (input) => invoke('researchCards:create', input),
      update: (input) => invoke('researchCards:update', input),
      archive: (input) => invoke('researchCards:archive', input)
    },
    agentRuntime: {
      connect: (runtimeId) => invoke('agentRuntime:connect', { runtimeId }),
      capabilities: (runtimeId) => invoke('agentRuntime:capabilities', { runtimeId }),
      listThreads: (input) => invoke('agentRuntime:listThreads', input ?? {}),
      startThread: (input) => invoke('agentRuntime:startThread', input),
      readThread: (input) => invoke('agentRuntime:readThread', input),
      readThreadSidebarProbe: (input) => invoke('agentRuntime:readThreadSidebarProbe', input),
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
    onRemoteChannelActivity,
    updateRemoteChannelActiveThreadContext,
    mirrorRemoteChannelMessage,
    createRemoteChannelTaskFromText,
    createScheduleTaskFromText: (text, options) =>
      invoke('schedule:task:create-from-text', {
        text,
        workspaceRoot: options?.workspaceRoot,
        modelHint: options?.modelHint,
        mode: options?.mode
    }),
    runDesktopCommand: (command) => invoke('desktop:command', command),
    getPerformanceSnapshot: () => invoke('performance:snapshot'),
    openExternal: (url) => invoke('shell:open-external', url),
    getComputerUsePermissions: () => invoke('computer-use:permissions'),
    requestComputerUsePermission: (kind) => invoke('computer-use:request-permission', kind),
    getComputerUseStatus: () => invoke('computer-use:status'),
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

function isLocalBrowserHost(): boolean {
  const hostname = window.location?.hostname?.toLowerCase?.() ?? ''
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function hasElectronPreloadBridge(): boolean {
  return typeof window.sciforge?.getAppVersion === 'function'
}

export function installDevSciForgeBridge(): void {
  if (installed || typeof window === 'undefined') return
  if (!import.meta.env.DEV && !isLocalBrowserHost()) return
  if (hasElectronPreloadBridge()) return
  installed = true
  bridgeUrl = defaultBridgeUrl()
  clientId = resolveClientId()
  window.sciforge = createApi()
  onChannel<DevBrowserSurfaceCaptureRequest>(
    'devBrowserBridge:surface-capture-requested',
    (request) => {
      void submitSurfaceCapture(request).catch(() => undefined)
    }
  )
  ensureEventSource()
}
