import type { SciForgeApi } from '@shared/sciforge-api'

const DEV_BRIDGE_PROXY_PATH = '/__sciforge-dev-bridge'
const CLIENT_ID_STORAGE_KEY = 'sciforge.dev-browser-bridge.client-id'

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
  const eventsUrl = new URL(`${bridgeUrl.replace(/\/$/, '')}/events`)
  eventsUrl.searchParams.set('clientId', clientId)
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
      'X-SciForge-Client': clientId
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

function createApi(): SciForgeApi {
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
    fetchUpstreamModels: () => invoke('upstream:models'),
    getConnectPhoneStatus,
    getScheduleStatus: () => invoke('schedule:status'),
    runScheduleTask: (taskId) => invoke('schedule:task:run', taskId),
    getWorkflowStatus: () => invoke('workflow:status'),
    runWorkflow: (workflowId, input) => invoke('workflow:run', { workflowId, input }),
    stopWorkflow: (workflowId) => invoke('workflow:stop', workflowId),
    runWorkflowNode: (workflowId, nodeId) => invoke('workflow:node:run', { workflowId, nodeId }),
    testWorkflowNode: (workflowId, nodeId, mockJson) =>
      invoke('workflow:node:test', { workflowId, nodeId, mockJson }),
    resolveWorkflowApproval: (token, decision) =>
      invoke('workflow:approval:resolve', { token, decision }),
    checkWorkflowCode: (language, code) => invoke('workflow:code:check', { language, code }),
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
    pickWorkspaceFile: (defaultPath) => invoke('workspace:pick-file', defaultPath),
    buildScientificSkillsMcpConfig: (workspaceRoot) =>
      invoke('mcp:scientific-skills-config', { workspaceRoot }),
    buildScientificPlottingMcpConfig: (workspaceRoot) =>
      invoke('mcp:scientific-plotting-config', { workspaceRoot }),
    buildImageGenerationMcpConfig: (workspaceRoot) =>
      invoke('mcp:image-generation-config', { workspaceRoot }),
    buildSciforgeCanvasMcpConfig: (workspaceRoot) =>
      invoke('mcp:sciforge-canvas-config', { workspaceRoot }),
    buildPptMasterMcpConfig: (workspaceRoot) =>
      invoke('mcp:ppt-master-config', { workspaceRoot }),
    getScientificSkillsStatus: (workspaceRoot) =>
      invoke('mcp:scientific-skills-status', { workspaceRoot }),
    installScientificSkills: (request) =>
      invoke('scientific-skills:install', request),
    getScientificPlottingStatus: (workspaceRoot) =>
      invoke('scientific-plotting:status', { workspaceRoot }),
    prepareScientificPlottingReference: (request) =>
      invoke('scientific-plotting:prepare-reference', request),
    getSciforgeCanvasStatus: (workspaceRoot) =>
      invoke('sciforge-canvas:status', { workspaceRoot }),
    openSciforgeCanvas: (request) =>
      invoke('sciforge-canvas:open', request),
    saveSciforgeCanvas: (request) =>
      invoke('sciforge-canvas:save', request),
    saveSciforgeCanvasSelection: (request) =>
      invoke('sciforge-canvas:save-selection', request),
    insertSciforgeCanvasArtifact: (request) =>
      invoke('sciforge-canvas:insert-artifact', request),
    importRecentSciforgeCanvasArtifacts: (request) =>
      invoke('sciforge-canvas:import-recent-artifacts', request),
    exportSciforgeCanvasReviewPacket: (request) =>
      invoke('sciforge-canvas:export-review-packet', request),
    extractFigureStyle: (request) =>
      invoke('figure-style:extract', request),
    evaluateFigureStyle: (request) =>
      invoke('figure-style:evaluate', request),
    reviewFigureStyle: (request) =>
      invoke('figure-style:review', request),
    listSkills: (workspaceRoot) => invoke('skill:list', { workspaceRoot }),
    saveSkillFile: (rootPath, skillName, content) =>
      invoke('skill:save-file', { rootPath, skillName, content }),
    openSkillRoot: (rootPath) => invoke('skill:open-root', rootPath),
    getRuntimeConfigFile: () => invoke('runtimeConfig:read'),
    setRuntimeConfigFile: (content) => invoke('runtimeConfig:write', content),
    openRuntimeConfigDir: () => invoke('runtimeConfig:open-dir'),
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
    previewWorkspaceHtml: (options) => invoke('file:preview-workspace-html', options),
    readWorkspaceImage: (options) => invoke('file:read-workspace-image', options),
    writeWorkspaceFile: (payload) => invoke('file:write-workspace', payload),
    writeWorkspaceDocxText: (payload) => invoke('file:write-docx-text', payload),
    createWorkspaceFile: (payload) => invoke('file:create-workspace', payload),
    createWorkspaceDirectory: (payload) => invoke('file:create-workspace-directory', payload),
    saveWorkspaceClipboardImage: (payload) => invoke('file:save-workspace-clipboard-image', payload),
    readClipboardImage: () => invoke('clipboard:read-image'),
    renameWorkspaceEntry: (payload) => invoke('file:rename-workspace-entry', payload),
    copyWorkspaceEntry: (payload) => invoke('file:copy-workspace-entry', payload),
    moveWorkspaceEntry: (payload) => invoke('file:move-workspace-entry', payload),
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
    pdfAnnotations: {
      load: (payload) => invoke('pdfAnnotations:load', payload),
      save: (payload) => invoke('pdfAnnotations:save', payload),
      export: (payload) => invoke('pdfAnnotations:export', payload),
      exportPdf: (payload) => invoke('pdfAnnotations:exportPdf', payload),
      import: (payload) => invoke('pdfAnnotations:import', payload)
    },
    visibleContext: {
      publish: (snapshot) => invoke('visibleContext:publish', snapshot),
      get: () => invoke('visibleContext:get')
    },
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
    researchCards: {
      list: (input) => invoke('researchCards:list', input ?? {}),
      create: (input) => invoke('researchCards:create', input),
      update: (input) => invoke('researchCards:update', input),
      archive: (input) => invoke('researchCards:archive', input)
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
    openExternal: (url) => invoke('shell:open-external', url),
    getComputerUsePermissions: () => invoke('computer-use:permissions'),
    requestComputerUsePermission: (kind) => invoke('computer-use:request-permission', kind),
    getComputerUseStatus: () => invoke('computer-use:status'),
    getEvidenceDagView: (input) => invoke('evidenceDag:view', input),
    runEvidenceDagAudit: (input) => invoke('evidenceDag:audit-run', input),
    exportProjectDag: (input) => invoke('projectDag:export', input),
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
    createTerminal: (payload) => invoke('terminal:create', payload),
    writeToTerminal: (payload) => invoke('terminal:write', payload),
    resizeTerminal: (payload) => invoke('terminal:resize', payload),
    disposeTerminal: (sessionId) => invoke('terminal:dispose', sessionId),
    onTerminalData: (handler) => onChannel('terminal:data', handler),
    onTerminalExit: (handler) => onChannel('terminal:exit', handler),
    getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name
  }
}

function isLocalBrowserHost(): boolean {
  const hostname = window.location?.hostname?.toLowerCase?.() ?? ''
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function hasElectronPreloadBridge(): boolean {
  return typeof window.sciforge?.onDevPreviewNavigate === 'function'
}

export function installDevSciForgeBridge(): void {
  if (installed || typeof window === 'undefined') return
  if (!import.meta.env.DEV && !isLocalBrowserHost()) return
  if (hasElectronPreloadBridge()) return
  installed = true
  bridgeUrl = defaultBridgeUrl()
  clientId = resolveClientId()
  window.sciforge = createApi()
  ensureEventSource()
}
