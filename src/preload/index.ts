import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DsGuiApi } from '../shared/ds-gui-api'

const transcribeSpeech = (payload: Parameters<DsGuiApi['speechToText']['transcribe']>[0]) =>
  ipcRenderer.invoke('speech:transcribe', payload)

const api = {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) =>
    ipcRenderer.invoke('settings:set', partial),
  fetchUpstreamModels: () => ipcRenderer.invoke('upstream:models'),
  getClawStatus: () => ipcRenderer.invoke('claw:status'),
  runClawTask: (taskId) =>
    ipcRenderer.invoke('claw:task:run', taskId),
  getScheduleStatus: () => ipcRenderer.invoke('schedule:status'),
  runScheduleTask: (taskId) =>
    ipcRenderer.invoke('schedule:task:run', taskId),
  startClawImInstallQr: (provider, options) =>
    ipcRenderer.invoke('claw:im-install:qrcode', { provider, isLark: options?.isLark }),
  pollClawImInstall: (provider, deviceCode) =>
    ipcRenderer.invoke('claw:im-install:poll', { provider, deviceCode }),
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
  pickWorkspaceDirectory: (defaultPath) =>
    ipcRenderer.invoke('workspace:pick-directory', defaultPath),
  listSkills: (workspaceRoot) =>
    ipcRenderer.invoke('skill:list', { workspaceRoot }),
  saveSkillFile: (rootPath, skillName, content) =>
    ipcRenderer.invoke('skill:save-file', { rootPath, skillName, content }),
  openSkillRoot: (rootPath) =>
    ipcRenderer.invoke('skill:open-root', rootPath),
  getDeepseekConfigFile: () =>
    ipcRenderer.invoke('deepseek:config:read'),
  setDeepseekConfigFile: (content) =>
    ipcRenderer.invoke('deepseek:config:write', content),
  openDeepseekConfigDir: () =>
    ipcRenderer.invoke('deepseek:config:open-dir'),
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
  renameWorkspaceEntry: (payload) =>
    ipcRenderer.invoke('file:rename-workspace-entry', payload),
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
    search: (payload) => ipcRenderer.invoke('paperRadar:search', payload),
    rank: (payload) => ipcRenderer.invoke('paperRadar:rank', payload),
    digest: (payload) => ipcRenderer.invoke('paperRadar:digest', payload)
  },
  agentRuntime: {
    connect: (runtimeId) => ipcRenderer.invoke('agentRuntime:connect', { runtimeId }),
    capabilities: (runtimeId) => ipcRenderer.invoke('agentRuntime:capabilities', { runtimeId }),
    listThreads: (input) => ipcRenderer.invoke('agentRuntime:listThreads', input ?? {}),
    startThread: (input) => ipcRenderer.invoke('agentRuntime:startThread', input),
    readThread: (input) => ipcRenderer.invoke('agentRuntime:readThread', input),
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
  onClawChannelActivity: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('claw:channel-activity', wrapped)
    return () => ipcRenderer.removeListener('claw:channel-activity', wrapped)
  },
  updateClawActiveThreadContext: (payload) =>
    ipcRenderer.invoke('claw:active-thread-context', payload),
  mirrorClawChannelMessage: (threadId, text, direction) =>
    ipcRenderer.invoke('claw:channel:mirror', { threadId, text, direction }),
  mirrorClawChannelMessageToFeishu: (threadId, text, direction) =>
    ipcRenderer.invoke('claw:channel:mirror-to-feishu', { threadId, text, direction }),
  createClawTaskFromText: (text, options) =>
    ipcRenderer.invoke('claw:task:create-from-text', {
      text,
      channelId: options?.channelId,
      modelHint: options?.modelHint,
      mode: options?.mode
    }),
  createScheduleTaskFromText: (text, options) =>
    ipcRenderer.invoke('schedule:task:create-from-text', {
      text,
      workspaceRoot: options?.workspaceRoot,
      modelHint: options?.modelHint,
      mode: options?.mode
    }),
  runDesktopCommand: (command) =>
    ipcRenderer.invoke('desktop:command', command),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openEvidenceDag: (input) => ipcRenderer.invoke('evidenceDag:open', input),
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
} satisfies DsGuiApi

contextBridge.exposeInMainWorld('dsGui', api)
