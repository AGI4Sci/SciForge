import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import type { SciForgeApi } from '../shared/sciforge-api'
import { capabilityResourceContentSourceUrl } from '../shared/workspace-preview-asset-url'

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

const api = {
  platform: process.platform,
  setUiZoomFactor: (factor: number) => {
    const normalized = Number.isFinite(factor)
      ? Math.min(2, Math.max(0.5, factor))
      : 1
    webFrame.setZoomFactor(normalized)
  },
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
  getModelAccessStatus: () => ipcRenderer.invoke('modelAccess:status'),
  fetchUpstreamModels: () => ipcRenderer.invoke('upstream:models'),
  traces: {
    read: (query) => ipcRenderer.invoke('traces:read', query ?? {}),
    summaries: (query) => ipcRenderer.invoke('traces:summaries', query ?? {}),
    export: (traceIds) => ipcRenderer.invoke('traces:export', { traceIds }),
    clear: () => ipcRenderer.invoke('traces:clear')
  },
  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    install: (input) => ipcRenderer.invoke('extensions:install', input),
    uninstall: (input) => ipcRenderer.invoke('extensions:uninstall', input),
    rollback: (input) => ipcRenderer.invoke('extensions:rollback', input),
    setEnabled: (input) => ipcRenderer.invoke('extensions:set-enabled', input)
  },
  getConnectPhoneStatus,
  getScheduleStatus: () => ipcRenderer.invoke('schedule:status'),
  runScheduleTask: (taskId) =>
    ipcRenderer.invoke('schedule:task:run', taskId),
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
  pickFile: (request) => ipcRenderer.invoke('workspace:pick-file', request),
  buildScientificSkillsMcpConfig: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:scientific-skills-config', { workspaceRoot }),
  buildScientificPlottingMcpConfig: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:scientific-plotting-config', { workspaceRoot }),
  buildBgcDiscoveryMcpConfig: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:bgc-discovery-config', { workspaceRoot }),
  buildImageGenerationMcpConfig: (workspaceRoot) =>
    ipcRenderer.invoke('mcp:image-generation-config', { workspaceRoot }),
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
  extractVisualStyleProfile: (request) =>
    ipcRenderer.invoke('visual-style:extract-profile', request),
  saveVisualStyleProfile: (request) =>
    ipcRenderer.invoke('visual-style:save-profile', request),
  listSkills: (workspaceRoot) =>
    ipcRenderer.invoke('skill:list', { workspaceRoot }),
  saveSkillFile: (rootPath, skillName, content) =>
    ipcRenderer.invoke('skill:save-file', { rootPath, skillName, content }),
  openSkillRoot: (rootPath) =>
    ipcRenderer.invoke('skill:open-root', rootPath),
  getGitBranches: (workspaceRoot, workspaceLocator) =>
    ipcRenderer.invoke('git:branches', {
      workspaceRoot,
      ...(workspaceLocator ? { workspaceLocator } : {})
    }),
  switchGitBranch: (workspaceRoot, branch, workspaceLocator) =>
    ipcRenderer.invoke('git:switch-branch', {
      workspaceRoot,
      branch,
      ...(workspaceLocator ? { workspaceLocator } : {})
    }),
  createAndSwitchGitBranch: (workspaceRoot, branch, workspaceLocator) =>
    ipcRenderer.invoke('git:create-and-switch-branch', {
      workspaceRoot,
      branch,
      ...(workspaceLocator ? { workspaceLocator } : {})
    }),
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
  readWorkspaceFileRange: (payload) =>
    ipcRenderer.invoke('file:read-workspace-range', payload),
  searchWorkspaceText: (payload) =>
    ipcRenderer.invoke('file:search-workspace-text', payload),
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
  renameWorkspaceEntry: (payload) =>
    ipcRenderer.invoke('file:rename-workspace-entry', payload),
  suggestWorkspacePdfName: (payload) =>
    ipcRenderer.invoke('file:suggest-workspace-pdf-name', payload),
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
  capabilities: {
    readiness: (input) => ipcRenderer.invoke('capability:readiness', input),
    discover: (input = {}) => ipcRenderer.invoke('capability:discover', input),
    observe: (input) => ipcRenderer.invoke('capability:observe', input),
    bind: (input) => ipcRenderer.invoke('capability:bind', input),
    invoke: (input) => ipcRenderer.invoke('capability:invoke', input),
    events: (input = {}) => ipcRenderer.invoke('capability:events', input),
    subscribe: (workspaceId) => ipcRenderer.invoke('capability:subscribe', { workspaceId }),
    unsubscribe: (subscriptionId) => ipcRenderer.invoke('capability:unsubscribe', { subscriptionId }),
    resourceContentUrl: capabilityResourceContentSourceUrl,
    onEvent: (handler) => {
      const wrapped = (
        _: Electron.IpcRendererEvent,
        payload: Parameters<typeof handler>[0]
      ) => handler(payload)
      ipcRenderer.on('capability:event', wrapped)
      return () => ipcRenderer.removeListener('capability:event', wrapped)
    }
  },
  exportWriteDocument: (payload) =>
    ipcRenderer.invoke('write:export', payload),
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
  researchCards: {
    list: (input) => ipcRenderer.invoke('researchCards:list', input ?? {}),
    create: (input) => ipcRenderer.invoke('researchCards:create', input),
    update: (input) => ipcRenderer.invoke('researchCards:update', input),
    archive: (input) => ipcRenderer.invoke('researchCards:archive', input)
  },
  visibleContext: {
    publish: (snapshot) => ipcRenderer.invoke('visibleContext:publish', snapshot),
    get: () => ipcRenderer.invoke('visibleContext:get'),
    registeredTargetRef: (request) =>
      ipcRenderer.invoke('visibleContext:target-ref', request),
    readCapturePreview: (request) => ipcRenderer.invoke('visibleContext:capture:preview', request),
    onRefreshRequested: (handler) => {
      const wrapped = () => handler()
      ipcRenderer.on('visibleContext:refresh-requested', wrapped)
      return () => ipcRenderer.removeListener('visibleContext:refresh-requested', wrapped)
    },
    onCaptureStateChanged: (handler) => {
      const wrapped = (_: Electron.IpcRendererEvent, active: boolean) => handler(active === true)
      ipcRenderer.on('visibleContext:capture-state', wrapped)
      return () => ipcRenderer.removeListener('visibleContext:capture-state', wrapped)
    }
  },
  remoteWorkspace: {
    list: () => ipcRenderer.invoke('remoteWorkspace:list'),
    get: () => ipcRenderer.invoke('remoteWorkspace:get'),
    attach: (input) => ipcRenderer.invoke('remoteWorkspace:attach', input),
    select: (input) => ipcRenderer.invoke('remoteWorkspace:select', input),
    reconnect: (input) => ipcRenderer.invoke('remoteWorkspace:reconnect', input),
    close: (input) => ipcRenderer.invoke('remoteWorkspace:close', input),
    onSnapshotChanged: (handler) => {
      const wrapped = (
        _: Electron.IpcRendererEvent,
        snapshot: Parameters<typeof handler>[0]
      ) => handler(snapshot)
      ipcRenderer.on('remoteWorkspace:snapshot-changed', wrapped)
      return () => ipcRenderer.removeListener('remoteWorkspace:snapshot-changed', wrapped)
    }
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
  getComputerUsePermissions: () => ipcRenderer.invoke('computer-use:permissions'),
  requestComputerUsePermission: (kind) =>
    ipcRenderer.invoke('computer-use:request-permission', kind),
  getComputerUseStatus: () => ipcRenderer.invoke('computer-use:status'),
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
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
} satisfies SciForgeApi

contextBridge.exposeInMainWorld('sciforge', api)
