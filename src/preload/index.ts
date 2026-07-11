import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { DEV_PREVIEW_NAVIGATE_CHANNEL } from '../shared/dev-preview-url'
import type { DevPreviewNavigatePayload, SciForgeApi } from '../shared/sciforge-api'

const DEV_BROWSER_BRIDGE_ASSET_BASE_URL = 'http://127.0.0.1:5174/workspace-preview/assets'
const DEV_BROWSER_BRIDGE_CLIENT_ID = `electron-preload-${Math.random().toString(36).slice(2)}`

function workspacePreviewAssetSourceUrl(sessionId: string): string | null {
  if (!import.meta.env.DEV) return null
  const trimmed = sessionId.trim()
  if (!trimmed) return null
  const url = new URL(`${DEV_BROWSER_BRIDGE_ASSET_BASE_URL}/${encodeURIComponent(trimmed)}`)
  url.searchParams.set('clientId', DEV_BROWSER_BRIDGE_CLIENT_ID)
  return url.toString()
}

const transcribeSpeech = (payload: Parameters<SciForgeApi['speechToText']['transcribe']>[0]) =>
  ipcRenderer.invoke('speech:transcribe', payload)

const getConnectPhoneStatus = () => ipcRenderer.invoke('connectPhone:status')
const startConnectPhoneInstallQr = (
  provider: Parameters<SciForgeApi['startConnectPhoneInstallQr']>[0],
  options?: Parameters<SciForgeApi['startConnectPhoneInstallQr']>[1]
) => ipcRenderer.invoke('connectPhone:install:qrcode', { provider, isLark: options?.isLark })
const pollConnectPhoneInstall = (
  provider: Parameters<SciForgeApi['pollConnectPhoneInstall']>[0],
  deviceCode: string
) => ipcRenderer.invoke('connectPhone:install:poll', { provider, deviceCode })
const onRemoteChannelActivity = (
  handler: Parameters<SciForgeApi['onRemoteChannelActivity']>[0]
) => {
  const wrapped = (
    _: Electron.IpcRendererEvent,
    payload: Parameters<typeof handler>[0]
  ) => handler(payload)
  ipcRenderer.on('remoteChannel:activity', wrapped)
  return () => ipcRenderer.removeListener('remoteChannel:activity', wrapped)
}
const updateRemoteChannelActiveThreadContext = (
  payload: Parameters<SciForgeApi['updateRemoteChannelActiveThreadContext']>[0]
) => ipcRenderer.invoke('remoteChannel:active-thread-context', payload)
const mirrorRemoteChannelMessage = (
  threadId: string,
  text: string,
  direction: Parameters<SciForgeApi['mirrorRemoteChannelMessage']>[2]
) => ipcRenderer.invoke('remoteChannel:message:mirror', { threadId, text, direction })
const createRemoteChannelTaskFromText = (
  text: string,
  options?: Parameters<SciForgeApi['createRemoteChannelTaskFromText']>[1]
) =>
  ipcRenderer.invoke('remoteChannel:task:create-from-text', {
    text,
    channelId: options?.channelId,
    modelHint: options?.modelHint,
    mode: options?.mode
  })

function isDevPreviewNavigatePayload(value: unknown): value is DevPreviewNavigatePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as { url?: unknown; webContentsId?: unknown }
  return typeof payload.url === 'string' && Number.isInteger(payload.webContentsId)
}

const api = {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) =>
    ipcRenderer.invoke('settings:set', partial),
  onSettingsChanged: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      settings: Parameters<typeof handler>[0]
    ) => handler(settings)
    ipcRenderer.on('settings:changed', wrapped)
    return () => ipcRenderer.removeListener('settings:changed', wrapped)
  },
  fetchUpstreamModels: () => ipcRenderer.invoke('upstream:models'),
  getConnectPhoneStatus,
  getScheduleStatus: () => ipcRenderer.invoke('schedule:status'),
  runScheduleTask: (taskId) =>
    ipcRenderer.invoke('schedule:task:run', taskId),
  getWorkflowStatus: () => ipcRenderer.invoke('workflow:status'),
  runWorkflow: (workflowId, input) =>
    ipcRenderer.invoke('workflow:run', { workflowId, input }),
  stopWorkflow: (workflowId) =>
    ipcRenderer.invoke('workflow:stop', workflowId),
  runWorkflowNode: (workflowId, nodeId) =>
    ipcRenderer.invoke('workflow:node:run', { workflowId, nodeId }),
  testWorkflowNode: (workflowId, nodeId, mockJson) =>
    ipcRenderer.invoke('workflow:node:test', { workflowId, nodeId, mockJson }),
  resolveWorkflowApproval: (token, decision) =>
    ipcRenderer.invoke('workflow:approval:resolve', { token, decision }),
  checkWorkflowCode: (language, code) =>
    ipcRenderer.invoke('workflow:code:check', { language, code }),
  startConnectPhoneInstallQr,
  pollConnectPhoneInstall,
  getDiscordBotStatus: () => ipcRenderer.invoke('discord:status'),
  configureDiscordClientId: (clientId) =>
    ipcRenderer.invoke('discord:configure-client', { clientId }),
  configureDiscordBotToken: (token, clientId) =>
    ipcRenderer.invoke('discord:configure-token', { token, ...(clientId ? { clientId } : {}) }),
  configureDiscordProxy: (proxyUrl) =>
    ipcRenderer.invoke('discord:configure-proxy', { proxyUrl }),
  listDiscordGuilds: () => ipcRenderer.invoke('discord:guilds'),
  listDiscordChannels: (guildId) =>
    ipcRenderer.invoke('discord:channels', { guildId }),
  bindDiscordChannel: (payload) =>
    ipcRenderer.invoke('discord:bind-channel', payload),
  testDiscordChannel: (channelId, text, channelConfigId) =>
    ipcRenderer.invoke('discord:test-send', { channelId, text, ...(channelConfigId ? { channelConfigId } : {}) }),
  setDiscordGuard: (enabled, channelConfigId, forceTakeover) =>
    ipcRenderer.invoke('discord:set-guard', {
      enabled,
      ...(channelConfigId ? { channelConfigId } : {}),
      ...(forceTakeover ? { forceTakeover } : {})
    }),
  getZulipBotStatus: () => ipcRenderer.invoke('zulip:status'),
  configureZulipBot: (payload) =>
    ipcRenderer.invoke('zulip:configure', payload),
  listZulipStreams: () => ipcRenderer.invoke('zulip:streams'),
  listZulipTopics: (streamId) =>
    ipcRenderer.invoke('zulip:topics', { streamId }),
  bindZulipChannel: (payload) =>
    ipcRenderer.invoke('zulip:bind-channel', payload),
  testZulipChannel: (channelId, text, channelConfigId, topicName) =>
    ipcRenderer.invoke('zulip:test-send', {
      channelId,
      ...(text ? { text } : {}),
      ...(channelConfigId ? { channelConfigId } : {}),
      ...(topicName ? { topicName } : {})
    }),
  setZulipGuard: (enabled, channelConfigId, forceTakeover) =>
    ipcRenderer.invoke('zulip:set-guard', {
      enabled,
      ...(channelConfigId ? { channelConfigId } : {}),
      ...(forceTakeover ? { forceTakeover } : {})
    }),
  pickWorkspaceDirectory: (defaultPath) =>
    ipcRenderer.invoke('workspace:pick-directory', defaultPath),
  pickWorkspaceFile: (defaultPath) =>
    ipcRenderer.invoke('workspace:pick-file', defaultPath),
  buildScientificSkillsMcpConfig: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:scientific-skills-config', { workspaceRoot }),
  buildScientificPlottingMcpConfig: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:scientific-plotting-config', { workspaceRoot }),
  buildBgcDiscoveryMcpConfig: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:bgc-discovery-config', { workspaceRoot }),
  buildImageGenerationMcpConfig: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:image-generation-config', { workspaceRoot }),
  buildSciforgeCanvasMcpConfig: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:sciforge-canvas-config', { workspaceRoot }),
  buildPptMasterMcpConfig: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:ppt-master-config', { workspaceRoot }),
  getScientificSkillsStatus: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:scientific-skills-status', { workspaceRoot }),
  installScientificSkills: (request) =>
    ipcRenderer.invoke('scientific-skills:install', request),
  getScientificPlottingStatus: (workspaceRoot) =>
    ipcRenderer.invoke('scientific-plotting:status', { workspaceRoot }),
  prepareScientificPlottingReference: (request) =>
    ipcRenderer.invoke('scientific-plotting:prepare-reference', request),
  getSciforgeCanvasStatus: (workspaceRoot) =>
    ipcRenderer.invoke('sciforge-canvas:status', { workspaceRoot }),
  getLocalDrawioUrl: () =>
    ipcRenderer.invoke('drawio:local-url'),
  openSciforgeCanvas: (request) =>
    ipcRenderer.invoke('sciforge-canvas:open', request),
  saveSciforgeCanvas: (request) =>
    ipcRenderer.invoke('sciforge-canvas:save', request),
  saveSciforgeCanvasSelection: (request) =>
    ipcRenderer.invoke('sciforge-canvas:save-selection', request),
  insertSciforgeCanvasArtifact: (request) =>
    ipcRenderer.invoke('sciforge-canvas:insert-artifact', request),
  importRecentSciforgeCanvasArtifacts: (request) =>
    ipcRenderer.invoke('sciforge-canvas:import-recent-artifacts', request),
  splitSciforgeCanvasArtifactComponents: (request) =>
    ipcRenderer.invoke('sciforge-canvas:split-artifact-components', request),
  exportSciforgeCanvasReviewPacket: (request) =>
    ipcRenderer.invoke('sciforge-canvas:export-review-packet', request),
  extractFigureStyle: (request) =>
    ipcRenderer.invoke('figure-style:extract', request),
  extractFigureStyleReference: (request) =>
    ipcRenderer.invoke('figure-style:extract-reference', request),
  saveFigureStyleSpec: (request) =>
    ipcRenderer.invoke('figure-style:save-spec', request),
  evaluateFigureStyle: (request) =>
    ipcRenderer.invoke('figure-style:evaluate', request),
  reviewFigureStyle: (request) =>
    ipcRenderer.invoke('figure-style:review', request),
  listSkills: (workspaceRoot) =>
    ipcRenderer.invoke('skill:list', { workspaceRoot }),
  saveSkillFile: (rootPath, skillName, content) =>
    ipcRenderer.invoke('skill:save-file', { rootPath, skillName, content }),
  openSkillRoot: (rootPath) =>
    ipcRenderer.invoke('skill:open-root', rootPath),
  getRuntimeConfigFile: () =>
    ipcRenderer.invoke('runtimeConfig:read'),
  setRuntimeConfigFile: (content) =>
    ipcRenderer.invoke('runtimeConfig:write', content),
  openRuntimeConfigDir: () =>
    ipcRenderer.invoke('runtimeConfig:open-dir'),
  openModelRouterConfigFile: () =>
    ipcRenderer.invoke('modelRouter:config:open'),
  getGitBranches: (workspaceRoot) =>
    ipcRenderer.invoke('git:branches', workspaceRoot),
  switchGitBranch: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:switch-branch', { workspaceRoot, branch }),
  createAndSwitchGitBranch: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:create-and-switch-branch', { workspaceRoot, branch }),
  listEditors: () => ipcRenderer.invoke('editor:list'),
  openEditorPath: (options) =>
    ipcRenderer.invoke('editor:open-path', options),
  listWorkspaceDirectory: (options) =>
    ipcRenderer.invoke('file:list-workspace-directory', options),
  resolveWorkspaceFile: (options) =>
    ipcRenderer.invoke('file:resolve-workspace', options),
  readWorkspaceFile: (options) =>
    ipcRenderer.invoke('file:read-workspace', options),
  readWorkspaceImage: (options) =>
    ipcRenderer.invoke('file:read-workspace-image', options),
  writeWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:write-workspace', payload),
  createWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:create-workspace', payload),
  createWorkspaceDirectory: (payload) =>
    ipcRenderer.invoke('file:create-workspace-directory', payload),
  saveWorkspaceClipboardImage: (payload) =>
    ipcRenderer.invoke('file:save-workspace-clipboard-image', payload),
  readClipboardImage: () =>
    ipcRenderer.invoke('clipboard:read-image'),
  pasteWorkspaceClipboard: (payload) =>
    ipcRenderer.invoke('clipboard:paste-workspace', payload),
  startWorkspaceNativeFileDrag: (payload) =>
    ipcRenderer.invoke('file:start-workspace-native-drag', payload),
  renameWorkspaceEntry: (payload) =>
    ipcRenderer.invoke('file:rename-workspace-entry', payload),
  copyWorkspaceEntry: (payload) =>
    ipcRenderer.invoke('file:copy-workspace-entry', payload),
  importWorkspaceEntries: (payload) =>
    ipcRenderer.invoke('file:import-workspace-entries', payload),
  moveWorkspaceEntry: (payload) =>
    ipcRenderer.invoke('file:move-workspace-entry', payload),
  deleteWorkspaceEntry: (payload) =>
    ipcRenderer.invoke('file:delete-workspace-entry', payload),
  watchWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:watch-workspace', payload),
  unwatchWorkspaceFile: (watchId) =>
    ipcRenderer.invoke('file:unwatch-workspace', watchId),
  onWorkspaceFileChanged: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('file:workspace-changed', wrapped)
    return () => ipcRenderer.removeListener('file:workspace-changed', wrapped)
  },
  workspacePreview: {
    listPlugins: () => ipcRenderer.invoke('workspacePreview:listPlugins'),
    open: (input) => ipcRenderer.invoke('workspacePreview:open', input),
    observe: (sessionId) => ipcRenderer.invoke('workspacePreview:observe', { sessionId }),
    describeAsset: (sessionId) => ipcRenderer.invoke('workspacePreview:describeAsset', { sessionId }),
    readRange: (sessionId, range) =>
      ipcRenderer.invoke('workspacePreview:readRange', { sessionId, range }),
    prepareArtifact: (sessionId, request) =>
      ipcRenderer.invoke('workspacePreview:prepareArtifact', { sessionId, request }),
    readArtifactRange: (sessionId, request) =>
      ipcRenderer.invoke('workspacePreview:readArtifactRange', { sessionId, request }),
    applyEdit: (sessionId, operation) =>
      ipcRenderer.invoke('workspacePreview:applyEdit', { sessionId, operation }),
    export: (sessionId, target) =>
      ipcRenderer.invoke('workspacePreview:export', { sessionId, target }),
    invokeAction: (sessionId, action) =>
      ipcRenderer.invoke('workspacePreview:invokeAction', { sessionId, action }),
    releaseSession: (sessionId) =>
      ipcRenderer.invoke('workspacePreview:releaseSession', { sessionId }),
    watch: (payload) => ipcRenderer.invoke('workspacePreview:watch', payload),
    unwatch: (watchId) => ipcRenderer.invoke('workspacePreview:unwatch', watchId),
    getAssetSourceUrl: workspacePreviewAssetSourceUrl,
    onChanged: (handler) => {
      const wrapped = (
        _: Electron.IpcRendererEvent,
        payload: Parameters<typeof handler>[0]
      ) => handler(payload)
      ipcRenderer.on('workspacePreview:changed', wrapped)
      return () => ipcRenderer.removeListener('workspacePreview:changed', wrapped)
    }
  },
  exportWriteDocument: (payload) =>
    ipcRenderer.invoke('write:export', payload),
  copyWriteDocumentAsRichText: (payload) =>
    ipcRenderer.invoke('write:copy-rich-text', payload),
  requestWriteInlineCompletion: (payload) =>
    ipcRenderer.invoke('write:inline-completion', payload),
  retrieveWriteContext: (payload) =>
    ipcRenderer.invoke('write:retrieve-context', payload),
  listWriteInlineCompletionDebugEntries: () =>
    ipcRenderer.invoke('write:inline-completion-debug:list'),
  clearWriteInlineCompletionDebugEntries: () =>
    ipcRenderer.invoke('write:inline-completion-debug:clear'),
  speechToText: {
    transcribe: transcribeSpeech
  },
  paperRadar: {
    status: () => ipcRenderer.invoke('paperRadar:status'),
    syncArxiv: (payload) => ipcRenderer.invoke('paperRadar:sync-arxiv', payload),
    syncBiorxiv: (payload) => ipcRenderer.invoke('paperRadar:sync-biorxiv', payload),
    syncProfile: (payload) => ipcRenderer.invoke('paperRadar:sync-profile', payload),
    listProfiles: () => ipcRenderer.invoke('paperRadar:profiles:list'),
    saveProfile: (payload) => ipcRenderer.invoke('paperRadar:profiles:save', payload),
    review: (payload) => ipcRenderer.invoke('paperRadar:review', payload),
    search: (payload) => ipcRenderer.invoke('paperRadar:search', payload),
    rank: (payload) => ipcRenderer.invoke('paperRadar:rank', payload),
    digest: (payload) => ipcRenderer.invoke('paperRadar:digest', payload)
  },
  researchCards: {
    list: (input) => ipcRenderer.invoke('researchCards:list', input ?? {}),
    create: (input) => ipcRenderer.invoke('researchCards:create', input),
    update: (input) => ipcRenderer.invoke('researchCards:update', input),
    archive: (input) => ipcRenderer.invoke('researchCards:archive', input)
  },
  visibleContext: {
    publish: (snapshot) => ipcRenderer.invoke('visibleContext:publish', snapshot),
    get: () => ipcRenderer.invoke('visibleContext:get')
  },
  agentRuntime: {
    connect: (runtimeId) => ipcRenderer.invoke('agentRuntime:connect', { runtimeId }),
    capabilities: (runtimeId) => ipcRenderer.invoke('agentRuntime:capabilities', { runtimeId }),
    listThreads: (input) => ipcRenderer.invoke('agentRuntime:listThreads', input ?? {}),
    startThread: (input) => ipcRenderer.invoke('agentRuntime:startThread', input),
    readThread: (input) => ipcRenderer.invoke('agentRuntime:readThread', input),
    readThreadSidebarProbe: (input) => ipcRenderer.invoke('agentRuntime:readThreadSidebarProbe', input),
    startTurn: (input) => ipcRenderer.invoke('agentRuntime:startTurn', input),
    interruptTurn: (input) => ipcRenderer.invoke('agentRuntime:interruptTurn', input),
    steerTurn: (input) => ipcRenderer.invoke('agentRuntime:steerTurn', input),
    subscribeEvents: (input) => ipcRenderer.invoke('agentRuntime:subscribeEvents', input),
    stopEvents: (streamId) => ipcRenderer.invoke('agentRuntime:stopEvents', streamId),
    renameThread: (input) => ipcRenderer.invoke('agentRuntime:renameThread', input),
    deleteThread: (input) => ipcRenderer.invoke('agentRuntime:deleteThread', input),
    compactThread: (input) => ipcRenderer.invoke('agentRuntime:compactThread', input),
    forkThread: (input) => ipcRenderer.invoke('agentRuntime:forkThread', input),
    resumeSession: (input) => ipcRenderer.invoke('agentRuntime:resumeSession', input),
    updateThreadRelation: (input) => ipcRenderer.invoke('agentRuntime:updateThreadRelation', input),
    usage: (input) => ipcRenderer.invoke('agentRuntime:usage', input),
    auxiliary: (input) => ipcRenderer.invoke('agentRuntime:auxiliary', input),
    resolveApproval: (input) => ipcRenderer.invoke('agentRuntime:resolveApproval', input),
    resolveUserInput: (input) => ipcRenderer.invoke('agentRuntime:resolveUserInput', input),
    onEvent: (handler) => {
      const wrapped = (
        _: Electron.IpcRendererEvent,
        payload: Parameters<typeof handler>[0]
      ) => handler(payload)
      ipcRenderer.on('agentRuntime:event', wrapped)
      return () => ipcRenderer.removeListener('agentRuntime:event', wrapped)
    },
    onEnd: (handler) => {
      const wrapped = (
        _: Electron.IpcRendererEvent,
        payload: Parameters<typeof handler>[0]
      ) => handler(payload)
      ipcRenderer.on('agentRuntime:end', wrapped)
      return () => ipcRenderer.removeListener('agentRuntime:end', wrapped)
    },
    onError: (handler) => {
      const wrapped = (
        _: Electron.IpcRendererEvent,
        payload: Parameters<typeof handler>[0]
      ) => handler(payload)
      ipcRenderer.on('agentRuntime:error', wrapped)
      return () => ipcRenderer.removeListener('agentRuntime:error', wrapped)
    }
  },
  onRuntimeStatus: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('runtime:status', wrapped)
    return () => ipcRenderer.removeListener('runtime:status', wrapped)
  },
  onRemoteChannelActivity,
  updateRemoteChannelActiveThreadContext,
  mirrorRemoteChannelMessage,
  createRemoteChannelTaskFromText,
  createScheduleTaskFromText: (text, options) =>
    ipcRenderer.invoke('schedule:task:create-from-text', {
      text,
      workspaceRoot: options?.workspaceRoot,
      modelHint: options?.modelHint,
      mode: options?.mode
    }),
  runDesktopCommand: (command) =>
    ipcRenderer.invoke('desktop:command', command),
  getPerformanceSnapshot: () =>
    ipcRenderer.invoke('performance:snapshot'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  onDevPreviewNavigate: (handler) => {
    const wrapped = (_: Electron.IpcRendererEvent, payload: unknown) => {
      if (isDevPreviewNavigatePayload(payload)) handler(payload)
    }
    ipcRenderer.on(DEV_PREVIEW_NAVIGATE_CHANNEL, wrapped)
    return () => ipcRenderer.removeListener(DEV_PREVIEW_NAVIGATE_CHANNEL, wrapped)
  },
  getComputerUsePermissions: () => ipcRenderer.invoke('computer-use:permissions'),
  requestComputerUsePermission: (kind) =>
    ipcRenderer.invoke('computer-use:request-permission', kind),
  getComputerUseStatus: () => ipcRenderer.invoke('computer-use:status'),
  getEvidenceDagView: (input) => ipcRenderer.invoke('evidenceDag:view', input),
  updateEvidenceDag: (input) => ipcRenderer.invoke('evidenceDag:update', input),
  resolveEvidenceDagEvidencePreview: (input) =>
    ipcRenderer.invoke('evidenceDag:resolve-evidence-preview', input),
  getProjectDagView: (input) => ipcRenderer.invoke('projectDag:view', input),
  updateProjectDag: (input) => ipcRenderer.invoke('projectDag:update', input),
  saveProjectDagGoal: (input) => ipcRenderer.invoke('projectDag:save-goal', input),
  resolveProjectDagEvidencePreview: (input) =>
    ipcRenderer.invoke('projectDag:resolve-evidence-preview', input),
  showTurnCompleteNotification: (payload) => ipcRenderer.invoke('notification:turn-complete', payload),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getGuiUpdateState: () => ipcRenderer.invoke('gui:update-state'),
  checkGuiUpdate: (channel) =>
    ipcRenderer.invoke('gui:update-check', channel),
  downloadGuiUpdate: (channel) =>
    ipcRenderer.invoke('gui:update-download', channel),
  installGuiUpdate: () => ipcRenderer.invoke('gui:update-install'),
  onGuiUpdateState: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('gui:update-state', wrapped)
    return () => ipcRenderer.removeListener('gui:update-state', wrapped)
  },
  logError: (category, message, detail) =>
    ipcRenderer.invoke('log:error', { category, message, detail }),
  getLogPath: () => ipcRenderer.invoke('log:get-path'),
  openLogDir: () => ipcRenderer.invoke('log:open-dir'),
  createTerminal: (payload) => ipcRenderer.invoke('terminal:create', payload),
  writeToTerminal: (payload) => ipcRenderer.invoke('terminal:write', payload),
  resizeTerminal: (payload) => ipcRenderer.invoke('terminal:resize', payload),
  disposeTerminal: (sessionId) => ipcRenderer.invoke('terminal:dispose', sessionId),
  onTerminalData: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('terminal:data', wrapped)
    return () => ipcRenderer.removeListener('terminal:data', wrapped)
  },
  onTerminalExit: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('terminal:exit', wrapped)
    return () => ipcRenderer.removeListener('terminal:exit', wrapped)
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
} satisfies SciForgeApi

contextBridge.exposeInMainWorld('sciforge', api)
