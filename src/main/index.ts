import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerSaveBlocker, shell, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  JsonSettingsStore,
  devServerHintUrl
} from './settings-store'
import deepseekLogoPng from '../asset/img/deepseek.png?url'
import deepseekTrayPng from '../asset/img/deepseek_gui_tray.png?url'
import { createAppIcon, pickTrayIcon } from './app-icon'
import { configureLinuxWaylandImeSwitches } from './app-command-line'
import { configureAppIdentity } from './app-identity'
import {
  applyCodexRuntimePatch,
  applyKunRuntimePatch,
  kunSettingsEnvelope,
  getKunRuntimeSettings,
  getActiveAgentRuntime,
  mergeKunRuntimeSettings,
  mergeClawSettings,
  mergeModelProviderSettings,
  mergeScheduleSettings,
  mergeSpeechToTextSettings,
  mergeWriteSettings,
  normalizeAppSettings,
  normalizeAppBehaviorSettings,
  normalizeKeyboardShortcuts,
  resolveRuntimeModelRouterSettings,
  resolveKunRuntimeSettings,
  type AgentRuntimeId,
  type AppBehaviorConfigV1,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../shared/app-settings'
import { runtimeErrorToError, type RuntimeErrorCode } from '../shared/runtime-error'
import type { GuiUpdateState } from '../shared/gui-update'
import { isAllowedDevPreviewUrl } from '../shared/dev-preview-url'
import { fetchUpstreamModelIds } from './upstream-models'
import { ensureModelRouterConfigFile, ensureModelRouterSidecar, stopModelRouterSidecar } from './model-router-sidecar'
import { ensurePaperRadarSidecar, stopPaperRadarSidecar } from './paper-radar-sidecar'
import {
  kunRuntimeAdapter,
  getRuntimeBaseUrlForSettings,
  runtimeAuthHeaders,
  kunHttpRequestViaHost
} from './runtime/kun-adapter'
import { createAgentRuntimeHost } from './runtime/agent-runtime/host'
import { createKunAgentRuntimeAdapter } from './runtime/kun-agent-runtime-adapter'
import { createCodexAgentRuntimeAdapter } from './runtime/codex/codex-agent-runtime-adapter'
import { waitForRuntimeTurnsIdle } from './runtime/managed-runtime-idle'
import { configureLogger, logError, logWarn, pruneOnStartup } from './logger'
import { createClawRuntime, type ClawRuntime } from './claw-runtime'
import { createDiscordBotRuntime, type DiscordBotRuntime } from './discord-bot-runtime'
import { createScheduleRuntime, type ScheduleRuntime } from './schedule-runtime'
import { runClawScheduleMcpServerFromArgv } from './claw-schedule-mcp-server'
import {
  clawScheduleMcpSettingsChanged,
  resolveKunMcpJsonPath,
  syncClawScheduleMcpConfig,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { registerAppIpcHandlers } from './ipc/register-app-ipc-handlers'
import { startDevBrowserBridgeServer, type DevBrowserBridgeServer } from './dev-browser-bridge'
import {
  configureManagedWeixinBridgeUrlResolver,
  pollFeishuInstall,
  pollWeixinInstall,
  startFeishuInstallQrcode,
  startWeixinInstallQrcode
} from './claw-platform-install'
import { kunRuntimeEvents } from './runtime-sse-ipc'
import {
  CodexRuntimeService,
  type CodexRuntimeEventSink
} from './runtime/codex'
import {
  configureWeixinBridgeRuntimeContextProvider,
  ensureWeixinBridgeRpcUrl,
  sendWeixinBridgeMessage,
  stopWeixinBridgeRuntime
} from './weixin-bridge-runtime'
import { webhookUrl } from './claw-runtime-helpers'
import { isKunHealthResponseBody } from './kun-health'
import {
  resolveAvailableKunPort,
  setKunUnexpectedExitHandler,
  type KunUnexpectedExitInfo
} from './kun-process'
import { RestartBudget, type KunRuntimeStatus } from './kun-runtime-supervisor'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_USER_MODEL_ID = 'com.xingyuzhong.deepseekgui'
const HIDDEN_START_ARG = '--hidden'
const startupTraceEnabled = process.env.DEEPSEEK_GUI_STARTUP_TRACE === '1'
const startupTraceStart = Date.now()

function traceStartup(label: string, detail?: unknown): void {
  if (!startupTraceEnabled) return
  const elapsed = String(Date.now() - startupTraceStart).padStart(6, ' ')
  if (detail === undefined) {
    console.info(`[startup +${elapsed}ms] ${label}`)
  } else {
    console.info(`[startup +${elapsed}ms] ${label}`, detail)
  }
}

function shouldStartWeixinBridgeRuntime(settings: AppSettingsV1): boolean {
  return settings.claw.enabled &&
    settings.claw.im.enabled &&
    settings.claw.channels.some((channel) => channel.enabled && channel.provider === 'weixin')
}

function syncWeixinBridgeRuntime(settings: AppSettingsV1): void {
  if (!shouldStartWeixinBridgeRuntime(settings)) return
  void ensureWeixinBridgeRpcUrl().catch((error) => {
    logWarn('weixin-bridge', 'Failed to start managed WeChat bridge.', {
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

const runningClawScheduleMcpServer =
  process.argv.includes('--gui-schedule-mcp-server') || process.argv.includes('--claw-schedule-mcp-server')

function resolveLogDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

function resolvePreloadPath(): string {
  const cjsPath = join(__dirname, '../preload/index.cjs')
  if (existsSync(cjsPath)) return cjsPath
  return join(__dirname, '../preload/index.mjs')
}

function getClawScheduleMcpLaunchConfig(): ClawScheduleMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runtimeFailure(code: string, message: string, status = 0, details?: unknown) {
  return {
    ok: false as const,
    status,
    body: JSON.stringify({ code, message, ...(details !== undefined ? { details } : {}) })
  }
}

function resolveConfiguredApiKey(settings: AppSettingsV1): string {
  return resolveRuntimeModelRouterSettings(settings).apiKey
}

function runtimeJsonError(code: string, message: string): Error {
  return runtimeErrorToError({ code: code as RuntimeErrorCode, message })
}

traceStartup('main module evaluated')

if (runningClawScheduleMcpServer && process.platform === 'darwin') {
  app.dock.hide()
}

// 在最早的阶段把 app 名称、AppUserModelId 都设好。
// Windows 任务栏 / 系统托盘 / 通知中心看到的应用名都来自这里;
// 设得太晚的话 BrowserWindow title、托盘、IPC 启动时拿到的还是旧的。
// 抽到 app-identity.ts 是为了让测试可以直接 import,不被 main 的
// whenReady 副作用污染。
configureAppIdentity()
configureLinuxWaylandImeSwitches()

if (!runningClawScheduleMcpServer && process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

let mainWindow: BrowserWindow | null = null
let store: JsonSettingsStore
let logDir = ''
let clawRuntime: ClawRuntime | null = null
let discordBotRuntime: DiscordBotRuntime | null = null
let scheduleRuntime: ScheduleRuntime | null = null
let codexRuntime: CodexRuntimeService | null = null
let managedRuntimesStoppedForQuit = false
let managedRuntimesStopPromise: Promise<void> | null = null
type RuntimeIdleListThreads = NonNullable<Parameters<typeof waitForRuntimeTurnsIdle>[0]['listThreads']>
let runtimeIdleListThreads: RuntimeIdleListThreads | null = null
let appBehavior: AppBehaviorConfigV1 = normalizeAppBehaviorSettings()
let tray: Tray | null = null
let isQuitting = false
let devBrowserBridgeServer: DevBrowserBridgeServer | null = null
let codexRuntimePrewarmTimer: ReturnType<typeof setTimeout> | null = null
let codexRuntimePrewarmPromise: Promise<void> | null = null
let clawActiveThreadContext: {
  threadId: string
  runtimeId?: AgentRuntimeId
  workspaceRoot?: string
  updatedAt: string
} | null = null

type GuiUpdaterModule = typeof import('./gui-updater')

let guiUpdaterModulePromise: Promise<GuiUpdaterModule> | null = null
let guiUpdaterInitialized = false

function emitClawChannelActivity(payload: {
  channelId: string
  threadId: string
  runtimeId?: AgentRuntimeId
  previousThreadId?: string
}): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('claw:channel-activity', payload)
  }
  devBrowserBridgeServer?.send('claw:channel-activity', payload)
}

const codexRuntimeEventSink: CodexRuntimeEventSink = {
  send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload)
    }
    devBrowserBridgeServer?.send(channel, payload)
  }
}

function getCodexRuntime(): CodexRuntimeService {
  if (codexRuntime) return codexRuntime
  const codexStorageRoot = join(app.getPath('userData'), 'codex-runtime')
  codexRuntime = new CodexRuntimeService({
    settings: async () => store.load(),
    sink: codexRuntimeEventSink,
    appVersion: app.getVersion(),
    storageRoot: codexStorageRoot,
    managedCodexHome: app.isPackaged
      ? join(app.getPath('userData'), 'runtime-codex', 'codex-home')
      : join(process.cwd(), '.codex-runtime', 'codex-home')
  })
  return codexRuntime
}

function scheduleCodexRuntimePrewarm(settings: AppSettingsV1, reason: 'startup' | 'settings-switch'): void {
  if (getActiveAgentRuntime(settings) !== 'codex') return
  if (codexRuntimePrewarmTimer) {
    clearTimeout(codexRuntimePrewarmTimer)
    codexRuntimePrewarmTimer = null
  }
  codexRuntimePrewarmTimer = setTimeout(() => {
    codexRuntimePrewarmTimer = null
    const runtime = getCodexRuntime()
    if (runtime.isClientWarm() || codexRuntimePrewarmPromise) return
    const task = runtime.connect()
      .then((result) => {
        if (!result.ok) {
          logWarn('codex-runtime', 'Failed to prewarm Codex app-server.', {
            reason,
            message: result.message,
            code: result.code
          })
        }
      })
      .catch((error) => {
        logWarn('codex-runtime', 'Failed to prewarm Codex app-server.', {
          reason,
          message: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        if (codexRuntimePrewarmPromise === task) {
          codexRuntimePrewarmPromise = null
        }
      })
    codexRuntimePrewarmPromise = task
  }, reason === 'startup' ? 1500 : 100)
}

async function stopManagedRuntimesForQuit(): Promise<void> {
  if (managedRuntimesStoppedForQuit) return
  await stopManagedRuntimes()
  managedRuntimesStoppedForQuit = true
}

async function stopManagedRuntimes(): Promise<void> {
  if (!managedRuntimesStopPromise) {
    managedRuntimesStopPromise = (async () => {
      stopRuntimeWatchdog()
      if (codexRuntimePrewarmTimer) {
        clearTimeout(codexRuntimePrewarmTimer)
        codexRuntimePrewarmTimer = null
      }
      scheduleRuntime?.stop()
      discordBotRuntime?.stop()
      clawRuntime?.stop()
      await stopModelRouterSidecar()
      await stopPaperRadarSidecar()
      stopWeixinBridgeRuntime()
      await codexRuntime?.stop()
      await kunRuntimeAdapter.stopAndWait()
      publishRuntimeStatus({ state: 'stopped', source: 'app-shutdown' })
    })().finally(() => {
      managedRuntimesStopPromise = null
    })
  }
  return managedRuntimesStopPromise
}

async function loadGuiUpdaterModule(): Promise<GuiUpdaterModule> {
  if (!guiUpdaterModulePromise) {
    guiUpdaterModulePromise = import('./gui-updater')
      .then((module) => {
        if (!guiUpdaterInitialized) {
          module.initializeGuiUpdater(
            () => mainWindow,
            async () => (await store.load()).guiUpdate.channel,
            stopManagedRuntimesForQuit
          )
          guiUpdaterInitialized = true
        }
        return module
      })
      .catch((error) => {
        guiUpdaterModulePromise = null
        throw error
      })
  }
  return guiUpdaterModulePromise
}

async function readGuiUpdateState(): Promise<GuiUpdateState> {
  if (!guiUpdaterModulePromise) return { status: 'idle' }
  try {
    const module = await loadGuiUpdaterModule()
    return module.getGuiUpdateState()
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'unknown'
    }
  }
}


function installDevPreviewWebviewGuards(): void {
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const src = typeof params.src === 'string' ? params.src : ''
      if (!isAllowedDevPreviewUrl(src)) {
        event.preventDefault()
        return
      }

      delete webPreferences.preload
      delete (webPreferences as { preloadURL?: string }).preloadURL
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false
    })

    contents.on('will-navigate', (event, navigationUrl) => {
      if (contents.getType() !== 'webview') return
      if (!isAllowedDevPreviewUrl(navigationUrl)) event.preventDefault()
    })

    contents.setWindowOpenHandler(({ url }) => {
      if (contents.getType() !== 'webview') return { action: 'allow' }
      return isAllowedDevPreviewUrl(url) ? { action: 'allow' } : { action: 'deny' }
    })
  })
}


const appIcon = createAppIcon(deepseekLogoPng)
const trayIcon = createAppIcon(deepseekTrayPng)
traceStartup('app icon loaded', { source: deepseekLogoPng.startsWith('data:') ? 'data-url' : 'path' })
const gotSingleInstanceLock = runningClawScheduleMcpServer || app.requestSingleInstanceLock()
traceStartup('single instance lock checked', {
  gotSingleInstanceLock,
  skippedForClawScheduleMcpServer: runningClawScheduleMcpServer
})

function trayLabels(locale: AppSettingsV1['locale']): { show: string; quit: string; tooltip: string } {
  if (locale === 'zh') {
    return {
      show: '显示 DeepSeek GUI',
      quit: '退出',
      tooltip: 'DeepSeek GUI'
    }
  }
  return {
    show: 'Show DeepSeek GUI',
    quit: 'Quit',
    tooltip: 'DeepSeek GUI'
  }
}

function shouldStartHidden(settings: AppSettingsV1): boolean {
  return (
    process.platform === 'win32' &&
    settings.appBehavior.openAtLogin &&
    settings.appBehavior.startMinimized &&
    process.argv.includes(HIDDEN_START_ARG)
  )
}

function syncLoginItemSettings(settings: AppSettingsV1): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  const behavior = settings.appBehavior
  try {
    app.setLoginItemSettings({
      openAtLogin: behavior.openAtLogin,
      args:
        process.platform === 'win32' && behavior.openAtLogin && behavior.startMinimized
          ? [HIDDEN_START_ARG]
          : []
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[deepseek-gui] failed to update login item settings:', error)
    logWarn('desktop-behavior', 'Failed to update login item settings.', { message })
  }
}

function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function syncTray(settings: AppSettingsV1): void {
  appBehavior = settings.appBehavior
  if (!appBehavior.closeToTray) {
    if (tray) {
      tray.destroy()
      tray = null
    }
    return
  }

  if (!tray) {
    // Tray 优先用专门的托盘图(在 16x16/24x24 任务栏尺寸下更清晰的剪影);
    // 托盘图加载失败时回退到主应用图,这样不会看到 electron 默认占位。
    const traySource = pickTrayIcon(trayIcon, appIcon)
    tray = new Tray(traySource.isEmpty() ? nativeImage.createEmpty() : traySource)
    tray.on('click', revealMainWindow)
    tray.on('double-click', revealMainWindow)
  }

  const labels = trayLabels(settings.locale)
  tray.setToolTip(labels.tooltip)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.show, click: revealMainWindow },
      { type: 'separator' },
      {
        label: labels.quit,
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

function normalizeNotificationText(raw: string | undefined, fallback: string, maxLength: number): string {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

type TurnCompleteNotificationPayload = {
  threadId?: string
  title?: string
  body?: string
}

async function showTurnCompleteNotification(
  payload: TurnCompleteNotificationPayload
): Promise<{ ok: true; shown: boolean; reason?: string } | { ok: false; message: string }> {
  const settings = await store.load()
  if (!settings.notifications.turnComplete) {
    return { ok: true, shown: false, reason: 'disabled' }
  }
  if (!Notification.isSupported()) {
    return { ok: true, shown: false, reason: 'unsupported' }
  }

  const title = normalizeNotificationText(payload.title, 'DeepSeek GUI', 80)
  const body = normalizeNotificationText(payload.body, 'Conversation complete.', 180)

  try {
    const notification = new Notification({
      title,
      body,
      icon: appIcon.isEmpty() ? undefined : appIcon
    })
    notification.on('click', () => {
      revealMainWindow()
    })
    notification.show()
    return { ok: true, shown: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError('notification', 'Failed to show turn completion notification', {
      message,
      threadId: payload.threadId
    })
    return { ok: false, message }
  }
}

async function waitForKunHealth(settings: AppSettingsV1, timeoutMs: number): Promise<boolean> {
  const base = getRuntimeBaseUrlForSettings(settings)
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    try {
      const remaining = Math.max(1, deadline - Date.now())
      const res = await fetch(`${base}/health`, {
        headers: runtimeAuthHeaders(settings),
        signal: AbortSignal.timeout(Math.max(250, Math.min(1_000, remaining)))
      })
      if (res.ok && isKunHealthResponseBody(await res.text())) return true
    } catch {
      /* retry until the deadline */
    }
    await sleep(150)
  }

  return false
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

let runtimeEnsurePromise: Promise<void> | null = null
let runtimeEnsureFingerprint: string | null = null
let runtimeRestartPromise: Promise<void> | null = null
let runtimeSettingsApplyPromise: Promise<void> | null = null
let lastAppliedSettings: AppSettingsV1 | null = null

const RUNTIME_RESTART_MAX_ATTEMPTS = 3
const RUNTIME_RESTART_BUDGET_RESET_MS = 60_000
const RUNTIME_WATCHDOG_INTERVAL_MS = 30_000
const RUNTIME_WATCHDOG_FAILURE_THRESHOLD = 3
const runtimeRestartBudget = new RestartBudget({
  windowMs: 60_000,
  maxRestarts: RUNTIME_RESTART_MAX_ATTEMPTS
})
let lastRuntimeStatus: KunRuntimeStatus | null = null
let supervisedRestartInFlight = false
let runtimeWatchdogTimer: NodeJS.Timeout | null = null
let runtimeWatchdogFailures = 0
let runtimeWatchdogTickInFlight = false
let managedKunPortOverride: { configuredPort: number; port: number } | null = null
let runtimeRestartBudgetResetTimer: NodeJS.Timeout | null = null

function publishRuntimeStatus(status: Omit<KunRuntimeStatus, 'at'>): void {
  const full: KunRuntimeStatus = { ...status, at: new Date().toISOString() }
  lastRuntimeStatus = full
  logWarn('runtime-status', `${full.state} (${full.source})${full.message ? `: ${full.message}` : ''}`)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('runtime:status', full)
  }
  devBrowserBridgeServer?.send('runtime:status', full)
}

function noteRuntimeHealthy(source: string): void {
  runtimeWatchdogFailures = 0
  scheduleRuntimeRestartBudgetReset()
  startRuntimeWatchdog()
  if (!lastRuntimeStatus || lastRuntimeStatus.state !== 'running') {
    publishRuntimeStatus({ state: 'running', source })
  }
}

function scheduleRuntimeRestartBudgetReset(): void {
  if (runtimeRestartBudgetResetTimer) return
  runtimeRestartBudgetResetTimer = setTimeout(() => {
    runtimeRestartBudgetResetTimer = null
    runtimeRestartBudget.reset()
  }, RUNTIME_RESTART_BUDGET_RESET_MS)
  runtimeRestartBudgetResetTimer.unref()
}

function clearRuntimeRestartBudgetReset(): void {
  if (!runtimeRestartBudgetResetTimer) return
  clearTimeout(runtimeRestartBudgetResetTimer)
  runtimeRestartBudgetResetTimer = null
}

function handleUnexpectedKunExit(info: KunUnexpectedExitInfo): void {
  void superviseKunCrash(info).catch((error: unknown) => {
    logError('kun-supervisor', 'Supervised Kun restart crashed.', {
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

async function superviseKunCrash(info: KunUnexpectedExitInfo): Promise<void> {
  if (managedRuntimesStoppedForQuit || isQuitting) return
  clearRuntimeRestartBudgetReset()
  const exitLabel = info.signal ? `signal ${info.signal}` : `code ${info.code ?? 'unknown'}`
  publishRuntimeStatus({
    state: 'crashed',
    source: 'supervisor',
    message: `Kun exited unexpectedly (${exitLabel}).`,
    stderrTail: info.stderrTail
  })
  if (supervisedRestartInFlight) return
  supervisedRestartInFlight = true
  try {
    const settings = await store.load()
    const runtime = getKunRuntimeSettings(settings)
    if (!resolveConfiguredApiKey(settings) || !runtime.autoStart) {
      publishRuntimeStatus({
        state: 'stopped',
        source: 'supervisor',
        message: 'Kun exited and automatic restart is unavailable because the API key is missing or auto-start is disabled.'
      })
      return
    }

    let lastError = ''
    for (;;) {
      if (managedRuntimesStoppedForQuit || isQuitting) return
      const verdict = runtimeRestartBudget.note()
      if (!verdict.allowed) {
        publishRuntimeStatus({
          state: 'failed',
          source: 'supervisor',
          message: lastError
            ? `Kun keeps crashing; automatic restarts are paused. Last error: ${lastError}`
            : 'Kun keeps crashing; automatic restarts are paused. Check the runtime logs, then retry.',
          stderrTail: info.stderrTail
        })
        return
      }
      publishRuntimeStatus({
        state: 'restarting',
        source: 'supervisor',
        attempt: verdict.attempt,
        maxAttempts: RUNTIME_RESTART_MAX_ATTEMPTS,
        message: `Restarting Kun automatically (attempt ${verdict.attempt}/${RUNTIME_RESTART_MAX_ATTEMPTS}).`
      })
      await sleep(verdict.delayMs)
      try {
        await ensureRuntime(await store.load())
        noteRuntimeHealthy('supervisor')
        return
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        logWarn('kun-supervisor', `Automatic restart attempt ${verdict.attempt} failed: ${lastError}`)
      }
    }
  } finally {
    supervisedRestartInFlight = false
  }
}

function startRuntimeWatchdog(): void {
  if (runtimeWatchdogTimer) return
  const timer = setInterval(() => {
    void runtimeWatchdogTick().catch((error: unknown) => {
      logWarn('kun-watchdog', 'Watchdog tick failed.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }, RUNTIME_WATCHDOG_INTERVAL_MS)
  timer.unref()
  runtimeWatchdogTimer = timer
}

function stopRuntimeWatchdog(): void {
  if (runtimeWatchdogTimer) {
    clearInterval(runtimeWatchdogTimer)
    runtimeWatchdogTimer = null
  }
  runtimeWatchdogFailures = 0
  clearRuntimeRestartBudgetReset()
}

async function runtimeWatchdogTick(): Promise<void> {
  if (runtimeWatchdogTickInFlight) return
  if (managedRuntimesStoppedForQuit || isQuitting) return
  if (
    supervisedRestartInFlight ||
    runtimeRestartPromise ||
    runtimeSettingsApplyPromise ||
    runtimeEnsurePromise
  ) {
    return
  }
  if (!kunRuntimeAdapter.isChildRunning()) return

  runtimeWatchdogTickInFlight = true
  try {
    const settings = await store.load()
    const healthy = await waitForKunHealth(settings, 5_000)
    if (healthy) {
      runtimeWatchdogFailures = 0
      return
    }
    runtimeWatchdogFailures += 1
    logWarn(
      'kun-watchdog',
      `Kun health probe failed (${runtimeWatchdogFailures}/${RUNTIME_WATCHDOG_FAILURE_THRESHOLD}).`
    )
    if (runtimeWatchdogFailures < RUNTIME_WATCHDOG_FAILURE_THRESHOLD) return
    runtimeWatchdogFailures = 0
    const verdict = runtimeRestartBudget.note()
    if (!verdict.allowed) {
      publishRuntimeStatus({
        state: 'failed',
        source: 'watchdog',
        message: 'Kun remains unhealthy after repeated automatic restarts; automatic restarts are paused.'
      })
      return
    }
    publishRuntimeStatus({
      state: 'restarting',
      source: 'watchdog',
      attempt: verdict.attempt,
      maxAttempts: RUNTIME_RESTART_MAX_ATTEMPTS,
      message: `Kun stopped responding to health checks; restarting it (attempt ${verdict.attempt}/${RUNTIME_RESTART_MAX_ATTEMPTS}).`
    })
    try {
      await restartRuntime(settings)
      noteRuntimeHealthy('watchdog')
    } catch (error) {
      publishRuntimeStatus({
        state: 'failed',
        source: 'watchdog',
        message: `Kun is unresponsive and the automatic restart failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
    }
  } finally {
    runtimeWatchdogTickInFlight = false
  }
}

function queueRuntimeSettingsApply(prev: AppSettingsV1, next: AppSettingsV1): void {
  // Always update the prev/next anchor so a later task diffs against
  // the settings that were actually applied last, not against the
  // original `prev` captured when this call was queued.
  const anchor = lastAppliedSettings ?? prev
  lastAppliedSettings = next
  const startupConfigChanged = runtimeStartupConfigChanged(anchor, next)
  if (!startupConfigChanged) return

  const previousTask = runtimeSettingsApplyPromise ?? Promise.resolve()
  const task = previousTask
    .catch(() => undefined)
    .then(async () => {
      const current = lastAppliedSettings ?? next
      await restartManagedRuntimeForSettingsChange(anchor, current)
    })
    .catch((error: unknown) => {
      logWarn('settings-apply', 'Failed to apply Kun runtime settings in background', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
    .finally(() => {
      if (runtimeSettingsApplyPromise === task) {
        runtimeSettingsApplyPromise = null
      }
    })

  runtimeSettingsApplyPromise = task
}

function queueRuntimeMcpConfigApply(settings: AppSettingsV1): void {
  lastAppliedSettings = settings

  const previousTask = runtimeSettingsApplyPromise ?? Promise.resolve()
  const task = previousTask
    .catch(() => undefined)
    .then(async () => {
      const current = lastAppliedSettings ?? settings
      await restartManagedRuntimeForMcpConfigChange(current)
    })
    .catch((error: unknown) => {
      logWarn('mcp-config', 'Failed to apply Kun MCP config change in background', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
    .finally(() => {
      if (runtimeSettingsApplyPromise === task) {
        runtimeSettingsApplyPromise = null
      }
    })

  runtimeSettingsApplyPromise = task
}

async function waitForQueuedRuntimeSettingsApply(): Promise<void> {
  if (!runtimeSettingsApplyPromise) return
  await runtimeSettingsApplyPromise
}

/**
 * Build a stable fingerprint of the settings that affect the
 * Kun runtime so that `ensureRuntime` can debounce on real
 * state instead of on a single in-flight promise. Without this,
 * a fresh call that arrives while a failing ensure is still pending
 * would re-throw the old error.
 */
function runtimeFingerprint(settings: AppSettingsV1): string {
  return stableSettingsStringify(resolveKunRuntimeSettings(settings))
}

async function ensureRuntime(settings: AppSettingsV1): Promise<void> {
  const restart = runtimeRestartPromise
  if (restart) {
    try {
      await restart
      return
    } catch {
      /* fall through to a normal ensure so callers see the latest state */
    }
  }
  const fingerprint = runtimeFingerprint(settings)
  const pending = runtimeEnsurePromise
  const pendingFingerprint = runtimeEnsureFingerprint
  if (pending) {
    // Wait for the in-flight ensure, then re-evaluate against the
    // fingerprint so callers don't inherit a stale result.
    let pendingSucceeded = true
    try {
      await pending
    } catch {
      pendingSucceeded = false
      /* fall through to retry with the current settings */
    }
    if (pendingSucceeded && pendingFingerprint === fingerprint) return
  }
  const task = ensureRuntimeOnce(settings)
  runtimeEnsurePromise = task.finally(() => {
    if (runtimeEnsurePromise === task) {
      runtimeEnsurePromise = null
      runtimeEnsureFingerprint = null
    }
  })
  runtimeEnsureFingerprint = fingerprint
  try {
    return await task
  } finally {
    /* cleanup runs via the .finally above */
  }
}

async function ensureRuntimeOnce(settings: AppSettingsV1): Promise<void> {
  await waitForQueuedRuntimeSettingsApply()
  await ensureKunRuntime(settings)
}

function syncSettingsObject(target: AppSettingsV1, source: AppSettingsV1): void {
  Object.assign(target, source)
}

function settingsWithKunPort(settings: AppSettingsV1, port: number): AppSettingsV1 {
  return {
    ...settings,
    agents: {
      ...settings.agents,
      kun: {
        ...settings.agents.kun,
        port
      }
    }
  }
}

function applyManagedKunPortOverride(settings: AppSettingsV1): AppSettingsV1 {
  const override = managedKunPortOverride
  if (!override) return settings
  const runtime = getKunRuntimeSettings(settings)
  if (runtime.port === override.port) return settings
  if (runtime.port !== override.configuredPort) {
    managedKunPortOverride = null
    return settings
  }
  const next = settingsWithKunPort(settings, override.port)
  syncSettingsObject(settings, next)
  return settings
}

async function resolveManagedKunLaunchSettings(
  settings: AppSettingsV1,
  source: string
): Promise<AppSettingsV1> {
  const runtime = getKunRuntimeSettings(settings)
  const resolved = await resolveAvailableKunPort(runtime.port)
  if (!resolved.changed) {
    if (managedKunPortOverride?.configuredPort === runtime.port) {
      managedKunPortOverride = null
    }
    return settings
  }

  managedKunPortOverride = { configuredPort: runtime.port, port: resolved.port }
  const next = settingsWithKunPort(settings, resolved.port)
  syncSettingsObject(settings, next)
  const message = `Kun runtime port ${runtime.port} is unavailable; using ${resolved.port} instead.`
  logWarn(source, message, {
    previousPort: runtime.port,
    port: resolved.port,
    reason: resolved.message
  })
  publishRuntimeStatus({
    state: source === 'runtime-start' ? 'starting' : 'restarting',
    source,
    message
  })
  return settings
}

async function ensureKunRuntime(settings: AppSettingsV1): Promise<void> {
  settings = applyManagedKunPortOverride(settings)
  const runtime = getKunRuntimeSettings(settings)
  const hasApiKey = Boolean(resolveConfiguredApiKey(settings))

  const healthy = await waitForKunHealth(settings, 2_000)
  if (healthy) {
    noteRuntimeHealthy('ensure')
    return
  }

  if (!hasApiKey) {
    throw runtimeJsonError(
      'missing_api_key',
      'Model Router runtime API key is required before the GUI can start Kun.'
    )
  }
  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'Kun is offline. Enable automatic startup in Settings, or start `kun serve` manually.'
    )
  }

  publishRuntimeStatus({ state: 'starting', source: 'ensure' })
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(settings, 'runtime-start')
    const adapter = kunRuntimeAdapter
    await adapter.ensureRunning(launchSettings)
    const started = await waitForKunHealth(launchSettings, 20_000)
    if (!started) {
      throw runtimeJsonError(
        'runtime_unhealthy',
        'Kun did not become healthy after launch.'
      )
    }

    noteRuntimeHealthy('ensure')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[deepseek-gui] failed to start kun:', e)
    publishRuntimeStatus({
      state: 'failed',
      source: 'ensure',
      message: `Kun failed to start: ${message}`
    })
    throw e
  }
}

async function restartRuntime(settings: AppSettingsV1): Promise<void> {
  if (runtimeRestartPromise) return runtimeRestartPromise
  const task = restartRuntimeOnce(settings)
    .finally(() => {
      if (runtimeRestartPromise === task) {
        runtimeRestartPromise = null
      }
    })
  runtimeRestartPromise = task
  runtimeEnsurePromise = null
  runtimeEnsureFingerprint = null
  return task
}

async function restartRuntimeOnce(settings: AppSettingsV1): Promise<void> {
  await waitForQueuedRuntimeSettingsApply()
  const runtime = getKunRuntimeSettings(settings)

  if (!resolveConfiguredApiKey(settings)) {
    throw runtimeJsonError(
      'missing_api_key',
      'Model Router runtime API key is required before the GUI can start Kun.'
    )
  }
  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'Kun is offline. Enable automatic startup in Settings, or start `kun serve` manually.'
    )
  }

  const adapter = kunRuntimeAdapter
  await adapter.stopAndWait()
  const launchSettings = await resolveManagedKunLaunchSettings(settings, 'runtime-restart')

  try {
    await adapter.ensureRunning(launchSettings)
  } catch (e) {
    console.error('[deepseek-gui] failed to restart kun:', e)
    throw e
  }

  const healthy = await waitForKunHealth(launchSettings, 20_000)
  if (!healthy) {
    throw runtimeJsonError(
      'runtime_unhealthy',
      'Kun did not become healthy after restart.'
    )
  }

  noteRuntimeHealthy('restart')
}

function createWindow(options: { suppressInitialShow?: boolean } = {}): void {
  traceStartup('createWindow:start')
  const preloadPath = resolvePreloadPath()
  const usesDesktopTitleBar = process.platform === 'win32' || process.platform === 'linux'
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : usesDesktopTitleBar ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 31, y: 22 } : undefined,
    autoHideMenuBar: usesDesktopTitleBar,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true
    }
  })
  if (usesDesktopTitleBar) {
    mainWindow.setMenu(null)
    mainWindow.setMenuBarVisibility(false)
  }
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[deepseek-gui] failed to load preload ${preloadPath}:`, error)
    logError('preload', 'Failed to load preload script', { preloadPath, message })
  })
  const showWindow = (): void => {
    if (options.suppressInitialShow) return
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return
    mainWindow.show()
  }
  mainWindow.on('close', (event) => {
    if (isQuitting || !appBehavior.closeToTray) return
    event.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  const devUrl = devServerHintUrl()
  traceStartup('createWindow:load', { devUrl: devUrl ?? 'file' })
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.once('ready-to-show', () => {
    traceStartup('window:ready-to-show')
    showWindow()
  })
  mainWindow.webContents.once('did-finish-load', () => {
    traceStartup('window:did-finish-load')
    if (lastRuntimeStatus && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('runtime:status', lastRuntimeStatus)
    }
    showWindow()
  })
  setTimeout(() => {
    traceStartup('window:fallback-show-timeout')
    showWindow()
  }, 1500)
}

/**
 * Stable equality for the Kun runtime settings. Most fields are flat,
 * but GUI-managed capability options can be nested, so compare values
 * structurally while still surviving future field additions.
 */
function kunRuntimeConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  const a = resolveKunRuntimeSettings(prev)
  const b = resolveKunRuntimeSettings(next)
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof typeof a>)
  for (const key of keys) {
    if (!stableSettingsValueEqual(a[key], b[key])) return true
  }
  return false
}

function stableSettingsValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return stableSettingsStringify(a) === stableSettingsStringify(b)
}

function stableSettingsStringify(value: unknown): string {
  return JSON.stringify(canonicalSettingsValue(value))
}

function canonicalSettingsValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSettingsValue)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalSettingsValue((value as Record<string, unknown>)[key])
  }
  return out
}

function runtimeStartupConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  return kunRuntimeConfigChanged(prev, next) || clawScheduleMcpSettingsChanged(prev, next)
}

async function restartManagedRuntimeForSettingsChange(
  prev: AppSettingsV1,
  next: AppSettingsV1
): Promise<void> {
  if (!runtimeStartupConfigChanged(prev, next)) return

  const runtime = resolveKunRuntimeSettings(next)
  const adapter = kunRuntimeAdapter
  const wasRunning = adapter.isChildRunning()

  if (!wasRunning) return
  await waitForManagedRuntimeReadyBeforeStop(prev, 'settings-apply')
  await adapter.stopAndWait()
  if (!resolveConfiguredApiKey(next) || !runtime.autoStart) {
    publishRuntimeStatus({
      state: 'stopped',
      source: 'settings-apply',
      message: 'Kun was stopped because the new settings have no API key or auto-start is disabled.'
    })
    return
  }

  publishRuntimeStatus({ state: 'restarting', source: 'settings-apply' })
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(next, 'settings-apply')
    await adapter.ensureRunning(launchSettings)
    const healthy = await waitForKunHealth(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('Kun did not become healthy after the settings change')
    }
    noteRuntimeHealthy('settings-apply')
    publishRuntimeStatus({ state: 'running', source: 'settings-apply' })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('[deepseek-gui] Kun restart failed after settings change:', e)
    publishRuntimeStatus({
      state: 'failed',
      source: 'settings-apply',
      message: `Kun failed to restart after the settings change: ${message}`
    })
  }
}

async function restartManagedRuntimeForMcpConfigChange(settings: AppSettingsV1): Promise<void> {
  const runtime = resolveKunRuntimeSettings(settings)
  const adapter = kunRuntimeAdapter
  const wasRunning = adapter.isChildRunning()

  if (!wasRunning) return
  await waitForManagedRuntimeReadyBeforeStop(settings, 'mcp-config')
  await adapter.stopAndWait()
  if (!resolveConfiguredApiKey(settings) || !runtime.autoStart) return

  publishRuntimeStatus({ state: 'restarting', source: 'mcp-config' })
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(settings, 'mcp-config')
    await adapter.ensureRunning(launchSettings)
    const healthy = await waitForKunHealth(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('Kun did not become healthy after the MCP config change')
    }
    noteRuntimeHealthy('mcp-config')
    publishRuntimeStatus({ state: 'running', source: 'mcp-config' })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('[deepseek-gui] Kun restart failed after MCP config change:', e)
    publishRuntimeStatus({
      state: 'failed',
      source: 'mcp-config',
      message: `Kun failed to restart after the MCP config change: ${message}`
    })
  }
}

async function waitForManagedRuntimeReadyBeforeStop(
  settings: AppSettingsV1,
  source: string
): Promise<void> {
  const healthy = await waitForKunHealth(settings, 20_000)
  if (!healthy) {
    logWarn(source, 'Kun did not become healthy before a managed restart; stopping it anyway')
    return
  }
  const idle = await waitForRuntimeTurnsIdle({
    listThreads: runtimeIdleListThreads ?? undefined
  })
  if (idle === 'timeout') {
    logWarn(source, 'Kun still has running turns after waiting; stopping it anyway')
  } else if (idle === 'unavailable') {
    logWarn(source, 'Could not verify Kun turn idleness before a managed restart; stopping it anyway')
  }
}

if (runningClawScheduleMcpServer) {
  void runClawScheduleMcpServerFromArgv(process.argv).catch((error) => {
    console.error('[claw-schedule-mcp] server failed:', error)
    process.exit(1)
  })
} else {
app.whenReady().then(async () => {
  traceStartup('app.whenReady:start')
  if (!gotSingleInstanceLock) return

  traceStartup('install webview guards:start')
  installDevPreviewWebviewGuards()
  traceStartup('install webview guards:done')

  if (process.platform === 'darwin' && !appIcon.isEmpty()) {
    app.dock.setIcon(appIcon)
  }

  store = new JsonSettingsStore(app.getPath('userData'))
  traceStartup('settings load:start')
  const initial = await store.load()
  traceStartup('settings load:done')
  setKunUnexpectedExitHandler(handleUnexpectedKunExit)
  appBehavior = initial.appBehavior
  syncLoginItemSettings(initial)
  syncTray(initial)
  await syncClawScheduleMcpConfig(initial, getClawScheduleMcpLaunchConfig()).catch((error) => {
    console.error('[claw-schedule-mcp] failed to sync config on startup:', error)
  })

  logDir = resolveLogDirectory()
  configureLogger({
    dir: logDir,
    enabled: initial.log.enabled,
    retentionDays: initial.log.retentionDays
  })
  traceStartup('logger configured')
  void ensureModelRouterSidecar(initial, {
    userDataDir: app.getPath('userData'),
    appRoot: app.getAppPath(),
    log: (message) => logWarn('model-router', message)
  }).catch((error) => {
    logWarn('model-router', 'Failed to auto-start Model Router.', {
      message: error instanceof Error ? error.message : String(error)
    })
  })
  if (!app.isPackaged) {
    void ensurePaperRadarSidecar({
      userDataDir: app.getPath('userData'),
      appRoot: app.getAppPath(),
      log: (message) => logWarn('paper-radar', message)
    }).catch((error) => {
      logWarn('paper-radar', 'Failed to auto-start Paper Radar.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }
  const agentRuntimeHost = createAgentRuntimeHost({
    settings: async () => store.load(),
    adapters: [
      createKunAgentRuntimeAdapter({
        request: async (settings, pathAndQuery, init) =>
          kunHttpRequestViaHost(settings, pathAndQuery, init, ensureRuntime),
        events: kunRuntimeEvents
      }),
      createCodexAgentRuntimeAdapter(getCodexRuntime())
    ]
  })
  runtimeIdleListThreads = (input) => agentRuntimeHost.listThreads(input)

  scheduleRuntime = createScheduleRuntime({
    store,
    agentRuntime: agentRuntimeHost,
    logError,
    powerSaveBlocker
  })
  scheduleRuntime.sync(initial)
  discordBotRuntime = createDiscordBotRuntime({
    store,
    userDataPath: app.getPath('userData'),
    handleIncomingMessage: async (input) => {
      if (!clawRuntime) return { ok: false, message: 'Claw runtime is not initialized.' }
      return clawRuntime.handleIncomingImMessage(input)
    },
    onSettingsChanged: (settings) => {
      scheduleRuntime?.sync(settings)
      clawRuntime?.sync(settings)
      discordBotRuntime?.sync(settings)
      syncWeixinBridgeRuntime(settings)
    },
    logError
  })
  clawRuntime = createClawRuntime({
    store,
    agentRuntime: agentRuntimeHost,
    getActiveThreadContext: () => clawActiveThreadContext,
    logError,
    notifyChannelActivity: emitClawChannelActivity,
    sendWeixinBridgeMessage,
    sendDiscordChannelMessage: (options) =>
      discordBotRuntime?.sendChannelMessage(options) ??
      Promise.resolve({ ok: false, message: 'Discord bot runtime is not initialized.' }),
    createScheduledTaskFromText: (text, options) =>
      scheduleRuntime?.createScheduledTaskFromText(text, options) ?? Promise.resolve({ kind: 'noop' })
  })
  clawRuntime.sync(initial)
  discordBotRuntime.sync(initial)
  configureWeixinBridgeRuntimeContextProvider(async () => {
    const settings = await store.load()
    const channel = settings.claw.channels.find((item) => item.enabled && item.provider === 'weixin')
    return {
      webhookUrl: webhookUrl(settings),
      webhookSecret: settings.claw.im.secret,
      channelId: channel?.id ?? ''
    }
  })
  configureManagedWeixinBridgeUrlResolver(ensureWeixinBridgeRpcUrl)
  syncWeixinBridgeRuntime(initial)

  traceStartup('ipc registration:start')
  const applySettingsPatch = async (partial: AppSettingsPatch): Promise<AppSettingsV1> => {
    const prev = await store.load()
    const { agents: agentsPatch, provider: providerPatch, speechToText: speechToTextPatch, ...restPatch } = partial
    const next = normalizeAppSettings({
      ...applyCodexRuntimePatch(applyKunRuntimePatch(prev, agentsPatch?.kun), agentsPatch?.codex),
      ...restPatch,
      provider: mergeModelProviderSettings(prev.provider, providerPatch),
      log: { ...prev.log, ...(partial.log ?? {}) },
      notifications: { ...prev.notifications, ...(partial.notifications ?? {}) },
      appBehavior: normalizeAppBehaviorSettings({
        ...prev.appBehavior,
        ...(partial.appBehavior ?? {})
      }),
      keyboardShortcuts: normalizeKeyboardShortcuts({
        bindings: {
          ...prev.keyboardShortcuts.bindings,
          ...(partial.keyboardShortcuts?.bindings ?? {})
        }
      }),
      write: mergeWriteSettings(prev.write, partial.write),
      speechToText: mergeSpeechToTextSettings(prev.speechToText, speechToTextPatch),
      claw: mergeClawSettings(prev.claw, partial.claw),
      schedule: mergeScheduleSettings(prev.schedule, partial.schedule),
      guiUpdate: { ...prev.guiUpdate, ...(partial.guiUpdate ?? {}) }
    })
    if (prev.log.enabled !== next.log.enabled || prev.log.retentionDays !== next.log.retentionDays) {
      configureLogger({ enabled: next.log.enabled, retentionDays: next.log.retentionDays })
    }
    const saved = await store.patch(partial)
    await syncClawScheduleMcpConfig(saved, getClawScheduleMcpLaunchConfig()).catch((error) => {
      console.error('[claw-schedule-mcp] failed to sync config after settings change:', error)
    })
    if (prev.guiUpdate.channel !== saved.guiUpdate.channel && guiUpdaterModulePromise) {
      void guiUpdaterModulePromise.then((module) => module.setGuiUpdateChannel(saved.guiUpdate.channel))
    }
    queueRuntimeSettingsApply(prev, saved)
    scheduleCodexRuntimePrewarm(saved, 'settings-switch')
    if (partial.modelRouter) {
      void ensureModelRouterSidecar(saved, {
        userDataDir: app.getPath('userData'),
        appRoot: app.getAppPath(),
        log: (message) => logWarn('model-router', message)
      }).catch((error) => {
        logWarn('model-router', 'Failed to auto-start Model Router after settings change.', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
    scheduleRuntime?.sync(saved)
    clawRuntime?.sync(saved)
    discordBotRuntime?.sync(saved)
    syncWeixinBridgeRuntime(saved)
    syncLoginItemSettings(saved)
    syncTray(saved)
    return saved
  }

  const fetchModels = async () => {
    const settings = await store.load()
    const key = resolveConfiguredApiKey(settings)
    return fetchUpstreamModelIds(settings, key)
  }

  const openModelRouterConfigFile = async (settings: AppSettingsV1) => {
    let path = join(app.getPath('userData'), 'model-router', 'config.json')
    try {
      const ensured = await ensureModelRouterConfigFile(settings, {
        userDataDir: app.getPath('userData')
      })
      path = ensured.path
      const message = await shell.openPath(path)
      if (message) {
        return { ok: false as const, path, message }
      }
      return { ok: true as const, path }
    } catch (error) {
      return {
        ok: false as const,
        path,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const appBridgeDispatcher = registerAppIpcHandlers({
    store,
    getMainWindow: () => mainWindow,
    applySettingsPatch,
    agentRuntime: agentRuntimeHost,
    fetchUpstreamModels: fetchModels,
    getClawRuntime: () => clawRuntime,
    getDiscordBotRuntime: () => discordBotRuntime,
    setClawActiveThreadContext: (payload) => {
      clawActiveThreadContext = payload
        ? {
            ...payload,
            updatedAt: new Date().toISOString()
          }
        : null
    },
    getScheduleRuntime: () => scheduleRuntime,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    startWeixinInstallQrcode,
    pollWeixinInstall,
    resolveKunConfigPath: resolveKunMcpJsonPath,
    openModelRouterConfigFile,
    onKunMcpConfigWritten: async () => {
      const settings = await store.load()
      queueRuntimeMcpConfigApply(settings)
    },
    showTurnCompleteNotification,
    getAppVersion: () => app.getVersion(),
    readGuiUpdateState,
    loadGuiUpdaterModule,
    resolveLogDirectory,
    logError
  })

  if (!app.isPackaged && process.env.DEEPSEEK_GUI_DEV_BROWSER_BRIDGE !== '0') {
    void startDevBrowserBridgeServer({
      dispatcher: appBridgeDispatcher
    }).then((server) => {
      devBrowserBridgeServer = server
      console.info(`[deepseek-gui dev] browser bridge listening at ${server.url}`)
    }).catch((error) => {
      console.warn('[deepseek-gui dev] failed to start browser bridge:', error)
    })
  }

  void loadGuiUpdaterModule().catch((error) => {
    console.warn('[deepseek-gui updater] failed to initialize on startup:', error)
  })

  traceStartup('ipc registration:done')

  createWindow({ suppressInitialShow: shouldStartHidden(initial) })
  traceStartup('createWindow:returned')
  scheduleCodexRuntimePrewarm(initial, 'startup')

  void pruneOnStartup().catch((err) => {
    console.warn('[deepseek-gui] prune logs:', err)
  })

  if (resolveConfiguredApiKey(initial)) {
    setTimeout(() => {
      void kunRuntimeAdapter.resolveExecutable(initial).catch((err) => {
        console.warn('[deepseek-gui] prewarm Kun binary:', err)
      })
    }, 1500)
  }

  app.on('second-instance', () => {
    revealMainWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else revealMainWindow()
  })
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[deepseek-gui] startup failed:', error)
  dialog.showErrorBox('DeepSeek GUI failed to start', message)
  app.quit()
})
}

app.on('window-all-closed', () => {
  void stopManagedRuntimes().catch((error) => {
    console.warn('[deepseek-gui] failed to stop Kun runtime:', error)
  })
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  const server = devBrowserBridgeServer
  devBrowserBridgeServer = null
  void server?.close().catch((error) => {
    console.warn('[deepseek-gui dev] failed to stop browser bridge:', error)
  })
})

app.on('before-quit', (event) => {
  isQuitting = true
  if (managedRuntimesStoppedForQuit) return
  event.preventDefault()
  void stopManagedRuntimesForQuit()
    .catch((error) => {
      console.warn('[deepseek-gui] failed to stop Kun runtime:', error)
      managedRuntimesStoppedForQuit = true
    })
    .finally(() => {
      app.quit()
    })
})
