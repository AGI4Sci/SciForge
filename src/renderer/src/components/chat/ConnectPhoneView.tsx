import type { ReactElement } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  MessageSquare,
  QrCode,
  RefreshCw,
  Settings,
  Wifi,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  type RemoteChannelAgentProfileV1,
  type RemoteChannelV1,
  type RemoteChannelPlatformCredentialV1,
  type RemoteChannelProvider,
  type RemoteChannelImSettingsV1,
  type RemoteChannelModel
} from '@shared/app-settings'
import type {
  ConnectPhoneInstallPollResult,
  ConnectPhoneInstallQrResult,
  DiscordBotStatus,
  DiscordChannel,
  DiscordGuild,
  ZulipBotStatus,
  ZulipStream,
  ZulipTopic
} from '@shared/sciforge-api'
import {
  type ConnectPhoneInstallQrState,
  type ConnectPhoneInstallTarget,
  connectPhoneInstallTargetLabel,
  formatConnectPhoneInstallError
} from './ConnectPhoneDialogHelpers'
import { RemoteChannelProviderLogo } from './RemoteChannelSidebar'
import { openSafeExternalUrl } from '../../lib/open-external'
import {
  pollConnectPhoneInstallApi,
  startConnectPhoneInstallQrApi
} from '../../lib/remote-channel-api'
import { workspaceLabelFromPath } from '../../lib/workspace-label'

export type AddConnectPhoneChannel = (
  provider: RemoteChannelProvider,
  agentProfile: RemoteChannelAgentProfileV1,
  platformCredential: RemoteChannelPlatformCredentialV1,
  options: {
    model: RemoteChannelModel
    enabled: boolean
    im: Partial<RemoteChannelImSettingsV1>
    workspaceRoot?: string
    preserveRoute?: boolean
  }
) => Promise<void>

type FeishuInstallRequest = {
  provider: 'feishu'
  options: { isLark: boolean }
}

type WeixinInstallRequest = {
  provider: 'weixin'
  options?: { isLark?: boolean }
}

type ConnectPhoneInstallRequest = FeishuInstallRequest | WeixinInstallRequest

type ConnectPhonePanelTarget = ConnectPhoneInstallTarget | 'discord' | 'zulip'

const CONNECT_PHONE_SIDEBAR_TARGETS: readonly ConnectPhonePanelTarget[] = [
  'feishu',
  'lark',
  'weixin',
  'discord',
  'zulip'
]
const INITIAL_QR_STATE: ConnectPhoneInstallQrState = {
  status: 'idle',
  url: '',
  deviceCode: '',
  userCode: '',
  timeLeft: 0,
  error: ''
}
const INTERNAL_REMOTE_CHANNEL_WORKSPACE_ROOT = '/.sciforge/remote-channel'

export function connectPhoneProviderForTarget(target: ConnectPhoneInstallTarget): RemoteChannelProvider {
  return target === 'weixin' ? 'weixin' : 'feishu'
}

export function hasEnabledConnectPhoneChannel(
  channels: RemoteChannelV1[],
  provider?: RemoteChannelProvider
): boolean {
  return channels.some((channel) =>
    (provider ? channel.provider === provider : true) && channel.enabled
  )
}

export function hasConnectPhoneChannel(
  channels: RemoteChannelV1[],
  provider?: RemoteChannelProvider
): boolean {
  return provider
    ? channels.some((channel) => channel.provider === provider)
    : channels.length > 0
}

export function connectPhoneInstallRequestOptions(
  target: ConnectPhoneInstallTarget
): ConnectPhoneInstallRequest {
  if (target === 'weixin') {
    return { provider: 'weixin' }
  }
  return {
    provider: 'feishu',
    options: { isLark: target === 'lark' }
  }
}

function isPhoneInstallTarget(target: ConnectPhonePanelTarget): target is ConnectPhoneInstallTarget {
  return target !== 'discord' && target !== 'zulip'
}

function connectPhoneTargetLabel(
  t: (k: string, opts?: Record<string, unknown>) => string,
  target: ConnectPhonePanelTarget
): string {
  if (target === 'zulip') return t('connectPhoneTargetZulip')
  return target === 'discord' ? t('connectPhoneTargetDiscord') : connectPhoneInstallTargetLabel(t, target)
}

export function normalizeConnectPhoneWorkspaceRoot(workspaceRoot?: string): string {
  return workspaceRoot?.trim() ?? ''
}

function isInternalRemoteChannelWorkspaceRoot(workspaceRoot: string): boolean {
  const normalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return (
    normalized === '~/.sciforge/remote-channel'
    || normalized.startsWith('~/.sciforge/remote-channel/')
    || normalized.endsWith(INTERNAL_REMOTE_CHANNEL_WORKSPACE_ROOT)
    || normalized.includes(`${INTERNAL_REMOTE_CHANNEL_WORKSPACE_ROOT}/`)
  )
}

export function resolveConnectPhoneWorkspaceRoot(
  workspaceRoot?: string,
  fallbackWorkspaceRoot?: string
): string {
  const primary = normalizeConnectPhoneWorkspaceRoot(workspaceRoot)
  if (primary && !isInternalRemoteChannelWorkspaceRoot(primary)) return primary
  return normalizeConnectPhoneWorkspaceRoot(fallbackWorkspaceRoot) || primary
}

export function connectPhoneWorkspaceLabel(
  workspaceRoot: string | undefined,
  fallbackLabel: string
): string {
  const normalized = normalizeConnectPhoneWorkspaceRoot(workspaceRoot)
  if (!normalized || isInternalRemoteChannelWorkspaceRoot(normalized)) return fallbackLabel
  return workspaceLabelFromPath(normalized)
}

export function latestConnectPhoneRecentMessage(channel: RemoteChannelV1 | undefined): NonNullable<RemoteChannelV1['recentMessages']>[number] | null {
  const messages = channel?.recentMessages ?? []
  if (messages.length === 0) return null
  return [...messages].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))[0] ?? null
}

export function connectPhoneRecentMessageLabel(message: NonNullable<RemoteChannelV1['recentMessages']>[number]): string {
  const sender = message.senderName?.trim()
  const text = message.text?.trim()
  if (sender && text) return `${sender}: ${text}`
  return text || sender || message.chatId
}

export function createConnectPhoneAgentProfile(): RemoteChannelAgentProfileV1 {
  return {
    name: 'SciForge Runtime',
    description: '',
    identity: '',
    personality: '',
    userContext: '',
    replyRules: ''
  }
}

export function createConnectPhoneChannelOptions(
  provider: RemoteChannelProvider = 'feishu',
  workspaceRoot = ''
): {
  model: RemoteChannelModel
  enabled: boolean
  im: Partial<RemoteChannelImSettingsV1>
  workspaceRoot?: string
} {
  const normalizedWorkspaceRoot = normalizeConnectPhoneWorkspaceRoot(workspaceRoot)
  return {
    model: 'auto',
    enabled: true,
    ...(normalizedWorkspaceRoot ? { workspaceRoot: normalizedWorkspaceRoot } : {}),
    im: {
      enabled: true,
      provider
    }
  }
}

export function createConnectPhoneCredential(
  poll: Extract<ConnectPhoneInstallPollResult, { done: true }>,
  createdAt: string = new Date().toISOString()
): RemoteChannelPlatformCredentialV1 {
  if (poll.kind === 'weixin') {
    return {
      kind: poll.kind,
      accountId: poll.accountId,
      sessionKey: poll.sessionKey,
      createdAt
    }
  }
  return {
    kind: poll.kind,
    appId: poll.appId,
    appSecret: poll.appSecret,
    domain: poll.domain,
    createdAt
  }
}

export function formatConnectPhoneUserCode(userCode: string, deviceCode: string): string {
  const source = userCode.trim() || deviceCode
  const compact = source.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)
  if (compact.length <= 4) return compact
  return `${compact.slice(0, 4)}-${compact.slice(4)}`
}

export function ConnectPhoneSidebarPanel({
  channels,
  onAddProvider,
  onDisconnect,
  onOpenSettings,
  workspaceRoot = ''
}: {
  channels: RemoteChannelV1[]
  onAddProvider: AddConnectPhoneChannel
  onDisconnect: (channelId: string) => Promise<void>
  onOpenSettings: () => void
  workspaceRoot?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const [target, setTarget] = useState<ConnectPhonePanelTarget>('feishu')
  const [installQr, setInstallQr] = useState<ConnectPhoneInstallQrState>(INITIAL_QR_STATE)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState('')
  const installPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const installRequestInFlightRef = useRef(false)
  const installAttemptRef = useRef(0)
  const phoneTarget = isPhoneInstallTarget(target) ? target : null
  const targetProvider = phoneTarget ? connectPhoneProviderForTarget(phoneTarget) : null
  const connectedChannel = targetProvider
    ? channels.find((channel) => channel.provider === targetProvider) ?? null
    : null
  const hasExistingChannel = Boolean(connectedChannel)
  const displayUserCode = targetProvider === 'weixin'
    ? ''
    : formatConnectPhoneUserCode(installQr.userCode, installQr.deviceCode)
  const installQrIsImage = installQr.url.startsWith('data:image/')

  const clearInstallTimers = useCallback((): void => {
    if (installPollTimerRef.current) {
      clearInterval(installPollTimerRef.current)
      installPollTimerRef.current = null
    }
    if (installCountdownTimerRef.current) {
      clearInterval(installCountdownTimerRef.current)
      installCountdownTimerRef.current = null
    }
  }, [])

  const cancelInstallAttempt = useCallback((): void => {
    installAttemptRef.current += 1
    installRequestInFlightRef.current = false
    clearInstallTimers()
  }, [clearInstallTimers])

  useEffect(() => {
    return cancelInstallAttempt
  }, [cancelInstallAttempt])

  useEffect(() => {
    cancelInstallAttempt()
    setSaving(false)
    setInstallQr(INITIAL_QR_STATE)
    setDisconnectError('')
  }, [cancelInstallAttempt, target])

  useEffect(() => {
    if (!hasExistingChannel) return
    cancelInstallAttempt()
    setSaving(false)
    setInstallQr(INITIAL_QR_STATE)
  }, [cancelInstallAttempt, hasExistingChannel])

  const addConnectedChannel = async (
    poll: Extract<ConnectPhoneInstallPollResult, { done: true }>
  ): Promise<void> => {
    const provider = poll.kind
    if (hasConnectPhoneChannel(channels, provider)) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('connectPhoneProviderAlreadyConnected', {
          provider: provider === 'weixin' ? connectPhoneInstallTargetLabel(t, 'weixin') : 'Feishu / Lark'
        })
      })
      return
    }
    setSaving(true)
    try {
      await onAddProvider(
        provider,
        createConnectPhoneAgentProfile(),
        createConnectPhoneCredential(poll),
        {
          ...createConnectPhoneChannelOptions(provider, workspaceRoot),
          preserveRoute: true
        }
      )
    } catch (error) {
      setInstallQr((current) => ({
        ...current,
        status: 'error',
        error: formatConnectPhoneInstallError(error instanceof Error ? error.message : String(error), t)
      }))
    } finally {
      setSaving(false)
    }
  }

  const startOfficialInstallQr = async (): Promise<void> => {
    if (!phoneTarget || !targetProvider) return
    if (hasExistingChannel) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('connectPhoneProviderAlreadyConnected', {
          provider: targetProvider === 'weixin' ? connectPhoneInstallTargetLabel(t, 'weixin') : 'Feishu / Lark'
        })
      })
      return
    }
    if (
      saving ||
      installRequestInFlightRef.current ||
      installQr.status === 'loading' ||
      installQr.status === 'showing'
    ) {
      return
    }
    const startConnectPhoneInstallQr = typeof window !== 'undefined'
      ? startConnectPhoneInstallQrApi(window.sciforge)
      : undefined
    if (typeof startConnectPhoneInstallQr !== 'function') {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: t('connectPhoneOfficialQrUnavailable')
      })
      return
    }

    clearInstallTimers()
    const installAttempt = installAttemptRef.current + 1
    installAttemptRef.current = installAttempt
    installRequestInFlightRef.current = true
    setSaving(false)
    setInstallQr({ ...INITIAL_QR_STATE, status: 'loading' })
    const request = connectPhoneInstallRequestOptions(phoneTarget)
    let result: ConnectPhoneInstallQrResult
    try {
      result = await startConnectPhoneInstallQr(request.provider, request.options)
    } catch (error) {
      if (installAttempt !== installAttemptRef.current) return
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: formatConnectPhoneInstallError(error instanceof Error ? error.message : String(error), t)
      })
      return
    } finally {
      if (installAttempt === installAttemptRef.current) {
        installRequestInFlightRef.current = false
      }
    }
    if (installAttempt !== installAttemptRef.current) return
    if (!result.ok) {
      setInstallQr({
        ...INITIAL_QR_STATE,
        status: 'error',
        error: formatConnectPhoneInstallError(result.message, t)
      })
      return
    }

    setInstallQr({
      status: 'showing',
      url: result.url,
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      timeLeft: result.expireIn,
      error: ''
    })
    installCountdownTimerRef.current = setInterval(() => {
      setInstallQr((current) => {
        if (current.status !== 'showing') return current
        if (current.timeLeft <= 1) {
          installAttemptRef.current += 1
          clearInstallTimers()
          return {
            ...current,
            status: 'error',
            timeLeft: 0,
            error: t('connectPhoneOfficialQrExpired')
          }
        }
        return { ...current, timeLeft: current.timeLeft - 1 }
      })
    }, 1000)
    const waitForInstall = async (): Promise<void> => {
      try {
        const pollConnectPhoneInstall = typeof window !== 'undefined'
          ? pollConnectPhoneInstallApi(window.sciforge)
          : undefined
        if (typeof pollConnectPhoneInstall !== 'function') {
          throw new Error(t('connectPhoneOfficialQrUnavailable'))
        }
        const poll = await pollConnectPhoneInstall(request.provider, result.deviceCode)
        if (installAttempt !== installAttemptRef.current) return
        if (poll.done) {
          clearInstallTimers()
          setInstallQr((current) => ({
            ...current,
            status: 'success',
            error: '',
            timeLeft: 0
          }))
          await addConnectedChannel(poll)
          return
        }
        if (poll.error) {
          installAttemptRef.current += 1
          clearInstallTimers()
          setInstallQr((current) => ({
            ...current,
            status: 'error',
            error: formatConnectPhoneInstallError(poll.error ?? t('connectPhoneOfficialQrFailed'), t)
          }))
        }
      } catch (error) {
        if (installAttempt !== installAttemptRef.current) return
        installAttemptRef.current += 1
        clearInstallTimers()
        setInstallQr((current) => ({
          ...current,
          status: 'error',
          error: formatConnectPhoneInstallError(error instanceof Error ? error.message : String(error), t)
        }))
      }
    }
    if (request.provider === 'weixin') {
      void waitForInstall()
    } else {
      installPollTimerRef.current = setInterval(() => {
        void waitForInstall()
      }, Math.max(result.interval, 3) * 1000)
    }
  }

  const disconnectChannel = async (): Promise<void> => {
    if (!connectedChannel || disconnecting) return
    const confirmed = window.confirm(
      t('connectPhoneDisconnectConfirm', { name: connectedChannel.label })
    )
    if (!confirmed) return

    setDisconnectError('')
    setDisconnecting(true)
    try {
      await onDisconnect(connectedChannel.id)
    } catch (error) {
      setDisconnectError(error instanceof Error ? error.message : String(error))
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="ds-no-drag flex min-h-0 flex-1 flex-col px-2 pt-2">
      <div className="px-1 pb-3">
        <div className="flex items-center gap-2 text-[12px] font-normal text-[#9aa5b5] dark:text-white/35">
          <ConnectPhoneTargetLogo target={target} className="h-4 w-4" />
          <span>{target === 'discord' || target === 'zulip' ? connectPhoneTargetLabel(t, target) : t('connectPhoneLabel')}</span>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1 rounded-xl border border-ds-border bg-ds-card p-1">
          {CONNECT_PHONE_SIDEBAR_TARGETS.map((item) => {
            const active = target === item
            return (
              <button
                key={item}
                type="button"
                onClick={() => setTarget(item)}
                className={`inline-flex min-h-[28px] items-center justify-center gap-1 rounded-lg px-2 text-[11.5px] font-semibold transition ${
                  active
                    ? 'bg-accent/12 text-accent'
                    : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'
                }`}
                aria-pressed={active}
              >
                <ConnectPhoneTargetLogo target={item} className="h-3.5 w-3.5" />
                {connectPhoneTargetLabel(t, item)}
              </button>
            )
          })}
        </div>
      </div>

      {target === 'discord' ? (
        <DiscordBotSetupPanel
          t={t}
          channels={channels}
          defaultWorkspaceRoot={workspaceRoot}
        />
      ) : target === 'zulip' ? (
        <ZulipBotSetupPanel
          t={t}
          channels={channels}
          defaultWorkspaceRoot={workspaceRoot}
        />
      ) : connectedChannel ? (
        <div className="mx-1 rounded-[12px] border border-ds-border bg-ds-card px-3 py-3 shadow-sm">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold text-ds-ink">
                {connectedChannel.label}
              </span>
              <span className="mt-1 block truncate text-[12px] text-ds-faint">
                {connectedChannel.enabled
                  ? t('connectPhoneConnectionConnected')
                  : t('remoteChannelDisabledSidebar')}
              </span>
            </span>
          </div>
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('connectPhoneSettings')}
            </button>
            <button
              type="button"
              onClick={() => void disconnectChannel()}
              disabled={disconnecting}
              className="inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12.5px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/15"
            >
              {disconnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              ) : (
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
              {disconnecting ? t('connectPhoneDisconnecting') : t('connectPhoneDisconnect')}
            </button>
          </div>
          {disconnectError ? (
            <div className="mt-2 rounded-[8px] bg-red-500/10 px-2.5 py-2 text-[12px] leading-relaxed text-red-600 dark:text-red-300">
              {disconnectError}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mx-1 flex flex-col items-center rounded-[12px] border border-ds-border bg-ds-card px-3 py-4 shadow-sm">
          <div className="flex h-[168px] w-full items-center justify-center rounded-[10px] border border-[#ececea] bg-white p-2">
            {installQr.status === 'idle' ? (
              <div className="grid justify-items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-[#f3f4f2] text-[#9aa2ad]">
                  <QrCode className="h-7 w-7" strokeWidth={1.7} />
                </div>
                <button
                  type="button"
                  onClick={() => void startOfficialInstallQr()}
                  className="inline-flex min-h-[32px] items-center justify-center gap-1.5 rounded-[8px] bg-[#222323] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-black dark:bg-white dark:text-black"
                >
                  {t('connectPhoneGenerateQr')}
                </button>
              </div>
            ) : null}

            {installQr.status === 'loading' ? (
              <div className="grid justify-items-center gap-2 text-ds-faint">
                <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
                <span className="text-[12px]">{t('connectPhoneQrLoading')}</span>
              </div>
            ) : null}

            {installQr.url && installQr.status !== 'loading' ? (
              installQrIsImage ? (
                <img
                  src={installQr.url}
                  alt={t('connectPhoneGenerateQr')}
                  className="h-[148px] w-[148px] object-contain"
                />
              ) : (
                <QRCodeSVG value={installQr.url} size={148} marginSize={1} />
              )
            ) : null}
          </div>

          {installQr.status === 'showing' ? (
            <div className="mt-3 text-center text-[12px] text-[#8d95a1]">
              {t('connectPhoneOfficialQrTimeLeft', { seconds: installQr.timeLeft })}
            </div>
          ) : null}

          {installQr.status === 'success' ? (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.9} />
              {saving ? t('connectPhoneBinding') : t('connectPhoneOfficialQrSuccess')}
            </div>
          ) : null}

          {installQr.status === 'error' ? (
            <div className="mt-3 grid justify-items-center gap-2">
              <div className="max-w-[220px] text-center text-[12px] leading-5 text-red-600 dark:text-red-300">
                {installQr.error || t('connectPhoneOfficialQrFailed')}
              </div>
              {!hasExistingChannel ? (
                <button
                  type="button"
                  onClick={() => void startOfficialInstallQr()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {t('connectPhoneOfficialQrRetry')}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 text-center text-[12px] leading-5 text-[#8d95a1]">
            <div className="inline-flex items-center justify-center gap-1.5 font-medium text-[#68707c] dark:text-white/55">
              <ConnectPhoneTargetLogo target={phoneTarget ?? 'feishu'} className="h-4 w-4" />
              {connectPhoneTargetLabel(t, phoneTarget ?? 'feishu')}
            </div>
            <div className="mt-1">{t('connectPhoneAutoBindHint')}</div>
            {displayUserCode ? (
              <div className="mt-2 font-mono text-[13px] tracking-normal text-ds-ink">
                {t('connectPhoneUserCode', { code: displayUserCode })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

export function DiscordBotSetupPanel({
  t,
  channels: configuredChannels,
  defaultWorkspaceRoot = ''
}: {
  t: (k: string, opts?: Record<string, unknown>) => string
  channels: RemoteChannelV1[]
  defaultWorkspaceRoot?: string
}): ReactElement {
  const currentWorkspaceRoot = normalizeConnectPhoneWorkspaceRoot(defaultWorkspaceRoot)
  const [status, setStatus] = useState<DiscordBotStatus>({
    configured: false,
    connected: false,
    enabled: false,
    channels: []
  })
  const [clientId, setClientId] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  const [token, setToken] = useState('')
  const [guilds, setGuilds] = useState<DiscordGuild[]>([])
  const [channels, setChannels] = useState<DiscordChannel[]>([])
  const [selectedGuildId, setSelectedGuildId] = useState('')
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState(() => currentWorkspaceRoot)
  const [agentName, setAgentName] = useState('discord bot')
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [savingClient, setSavingClient] = useState(false)
  const [savingProxy, setSavingProxy] = useState(false)
  const [savingToken, setSavingToken] = useState(false)
  const [loadingGuilds, setLoadingGuilds] = useState(false)
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [binding, setBinding] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tested, setTested] = useState(false)
  const [error, setError] = useState('')
  const inviteUrl = status.inviteUrl || status.bot?.inviteUrl || ''
  const hasInviteUrl = inviteUrl.length > 0
  const selectedGuild = guilds.find((guild) => guild.id === selectedGuildId)
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId)
  const discordStatuses = status.channels ?? []
  const selectedChannelStatus = discordStatuses.find((item) => item.channelId === selectedChannelId)
  const selectedChannelConfigId = selectedChannelStatus?.channelConfigId
  const statusConflict = selectedChannelStatus?.conflict ?? status.conflict
  const statusAccessError = selectedChannelStatus?.accessError ||
    discordStatuses.find((item) => item.accessError)?.accessError ||
    ''
  const configuredDiscordChannels = configuredChannels.filter((channel) => channel.provider === 'discord')

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (typeof window.sciforge?.getDiscordBotStatus !== 'function') return
    setLoadingStatus(true)
    try {
      const next = await window.sciforge.getDiscordBotStatus()
      setStatus(next)
      setClientId((current) => current || next.clientId || next.bot?.applicationId || '')
      setProxyUrl((current) => current || next.proxyUrl || '')
      setSelectedGuildId((current) => current || next.guildId || '')
      setSelectedChannelId((current) => current || next.channelId || '')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  const refreshGuilds = useCallback(async (): Promise<void> => {
    if (typeof window.sciforge?.listDiscordGuilds !== 'function') return
    setLoadingGuilds(true)
    setError('')
    try {
      const result = await window.sciforge.listDiscordGuilds()
      if (!result.ok) {
        setError(result.message)
        return
      }
      setGuilds(result.guilds)
      setSelectedGuildId((current) => {
        if (current && result.guilds.some((guild) => guild.id === current)) return current
        if (status.guildId && result.guilds.some((guild) => guild.id === status.guildId)) {
          return status.guildId
        }
        return ''
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingGuilds(false)
    }
  }, [status.guildId])

  const refreshChannels = useCallback(async (guildId: string): Promise<void> => {
    if (!guildId || typeof window.sciforge?.listDiscordChannels !== 'function') return
    setLoadingChannels(true)
    setError('')
    try {
      const result = await window.sciforge.listDiscordChannels(guildId)
      if (!result.ok) {
        setError(result.message)
        setChannels([])
        return
      }
      setChannels(result.channels)
      setSelectedChannelId((current) => {
        if (current && result.channels.some((channel) => channel.id === current)) return current
        if (status.channelId && result.channels.some((channel) => channel.id === status.channelId)) {
          return status.channelId
        }
        return ''
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      setChannels([])
    } finally {
      setLoadingChannels(false)
    }
  }, [status.channelId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!(status.tokenConfigured ?? status.configured)) return
    void refreshGuilds()
  }, [refreshGuilds, status.configured, status.tokenConfigured])

  useEffect(() => {
    if (!selectedGuildId) {
      setChannels([])
      setSelectedChannelId('')
      return
    }
    void refreshChannels(selectedGuildId)
  }, [refreshChannels, selectedGuildId])

  useEffect(() => {
    if (!selectedChannelStatus) return
    setWorkspaceRoot(resolveConnectPhoneWorkspaceRoot(
      selectedChannelStatus.workspaceRoot,
      currentWorkspaceRoot
    ))
    setAgentName((current) => current === 'discord bot' ? selectedChannelStatus.agentName || current : current)
  }, [currentWorkspaceRoot, selectedChannelStatus])

  useEffect(() => {
    if (selectedChannelStatus) return
    setWorkspaceRoot((current) => current || currentWorkspaceRoot)
  }, [currentWorkspaceRoot, selectedChannelStatus])

  const configureClient = async (): Promise<void> => {
    const trimmed = clientId.trim()
    if (!trimmed) {
      setError(t('connectPhoneDiscordClientIdRequired'))
      return
    }
    if (typeof window.sciforge?.configureDiscordClientId !== 'function') {
      setError(t('connectPhoneDiscordUnavailable'))
      return
    }
    setSavingClient(true)
    setError('')
    try {
      const result = await window.sciforge.configureDiscordClientId(trimmed)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setStatus(result.status)
      setClientId(result.status.clientId || trimmed)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingClient(false)
    }
  }

  const configureToken = async (): Promise<void> => {
    const trimmed = token.trim()
    if (!trimmed) {
      setError(t('connectPhoneDiscordTokenRequired'))
      return
    }
    if (typeof window.sciforge?.configureDiscordBotToken !== 'function') {
      setError(t('connectPhoneDiscordUnavailable'))
      return
    }
    setSavingToken(true)
    setError('')
    setTested(false)
    try {
      const result = await window.sciforge.configureDiscordBotToken(trimmed, clientId.trim() || undefined)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setToken('')
      setStatus(result.status)
      setClientId(result.status.clientId || result.status.bot?.applicationId || clientId)
      await refreshGuilds()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingToken(false)
    }
  }

  const configureProxy = async (): Promise<void> => {
    if (typeof window.sciforge?.configureDiscordProxy !== 'function') {
      setError(t('connectPhoneDiscordUnavailable'))
      return
    }
    setSavingProxy(true)
    setError('')
    try {
      const result = await window.sciforge.configureDiscordProxy(proxyUrl.trim())
      if (!result.ok) {
        setError(result.message)
        return
      }
      setStatus(result.status)
      setProxyUrl(result.status.proxyUrl || '')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingProxy(false)
    }
  }

  const copyInviteUrl = async (): Promise<void> => {
    if (!hasInviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  const openInviteUrl = (): void => {
    if (!hasInviteUrl) return
    void openSafeExternalUrl(inviteUrl).catch(() => undefined)
  }

  const openDeveloperPortal = (): void => {
    void openSafeExternalUrl('https://discord.com/developers/applications').catch(() => undefined)
  }

  const testAndEnable = async (): Promise<void> => {
    if (!selectedGuild || !selectedChannel) {
      setError(t('connectPhoneDiscordSelectChannelFirst'))
      return
    }
    if (
      typeof window.sciforge?.bindDiscordChannel !== 'function' ||
      typeof window.sciforge?.testDiscordChannel !== 'function' ||
      typeof window.sciforge?.setDiscordGuard !== 'function'
    ) {
      setError(t('connectPhoneDiscordUnavailable'))
      return
    }
    setBinding(true)
    setError('')
    setTested(false)
    try {
      const bindingWorkspaceRoot = resolveConnectPhoneWorkspaceRoot(workspaceRoot, currentWorkspaceRoot)
      const bind = await window.sciforge.bindDiscordChannel({
        ...(selectedChannelConfigId ? { channelConfigId: selectedChannelConfigId } : {}),
        guildId: selectedGuild.id,
        guildName: selectedGuild.name,
        channelId: selectedChannel.id,
        channelName: selectedChannel.name,
        enabled: false,
        workspaceRoot: bindingWorkspaceRoot,
        model: 'auto',
        agentProfile: {
          name: agentName.trim() || 'discord bot'
        }
      })
      if (!bind.ok) {
        setError(bind.message)
        return
      }
      setStatus(bind.status)
      const test = await window.sciforge.testDiscordChannel(
        selectedChannel.id,
        t('connectPhoneDiscordTestMessage')
      )
      if (!test.ok) {
        setError(test.message)
        return
      }
      setTested(true)
      const guard = await window.sciforge.setDiscordGuard(true, bind.channelConfigId)
      if (!guard.ok) {
        setError(guard.message)
        if (guard.status) setStatus(guard.status)
        return
      }
      setStatus(guard.status)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBinding(false)
    }
  }

  const disableGuard = async (): Promise<void> => {
    if (typeof window.sciforge?.setDiscordGuard !== 'function') return
    setBinding(true)
    setError('')
    try {
      const result = await window.sciforge.setDiscordGuard(false, selectedChannelConfigId)
      if (result.ok) setStatus(result.status)
      else setError(result.message)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBinding(false)
    }
  }

  const setGuardForChannel = async (
    channelConfigId: string,
    enabled: boolean,
    forceTakeover = false
  ): Promise<void> => {
    if (!channelConfigId || typeof window.sciforge?.setDiscordGuard !== 'function') return
    setBinding(true)
    setError('')
    try {
      const result = await window.sciforge.setDiscordGuard(enabled, channelConfigId, forceTakeover)
      if (result.ok) {
        setStatus(result.status)
        return
      }
      setError(result.message)
      if (result.status) setStatus(result.status)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBinding(false)
    }
  }

  const takeOverGuard = async (channelConfigId?: string): Promise<void> => {
    if (!channelConfigId || typeof window.sciforge?.setDiscordGuard !== 'function') return
    await setGuardForChannel(channelConfigId, true, true)
  }

  const setupSteps = [
    {
      label: t('connectPhoneDiscordStepClient'),
      done: Boolean(status.clientId || clientId.trim())
    },
    {
      label: t('connectPhoneDiscordStepToken'),
      done: status.tokenConfigured ?? status.configured
    },
    {
      label: t('connectPhoneDiscordStepInviteBot'),
      done: Boolean(status.guildId || guilds.length > 0)
    },
    {
      label: t('connectPhoneDiscordStepSelectChannel'),
      done: Boolean(status.channelId || selectedChannelId)
    },
    {
      label: t('connectPhoneDiscordStepTestGuard'),
      done: Boolean(status.enabled && (status.connected || tested))
    }
  ]

  return (
    <div className="mx-1 flex flex-col rounded-[12px] border border-ds-border bg-ds-card px-3 py-3 shadow-sm">
      <div className="flex h-[156px] w-full items-center justify-center rounded-[10px] border border-[#ececea] bg-white p-2">
        {hasInviteUrl ? (
          <QRCodeSVG value={inviteUrl} size={138} marginSize={1} />
        ) : (
          <div className="grid justify-items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-[#5865F2]/10 text-[#5865F2]">
              <DiscordLogo className="h-8 w-8" />
            </div>
          <div className="max-w-[210px] text-[12px] leading-5 text-ds-faint">
            {t('connectPhoneDiscordMissingInvite')}
          </div>
          </div>
        )}
      </div>

      <div className="mt-3 text-center text-[12px] leading-5 text-[#8d95a1]">
        <div className="inline-flex items-center justify-center gap-1.5 font-medium text-[#68707c] dark:text-white/55">
          <DiscordLogo className="h-4 w-4" />
          {t('connectPhoneDiscordJoinTitle')}
        </div>
        <div className="mt-1">
          {hasInviteUrl
            ? t('connectPhoneDiscordScanHint')
            : t('connectPhoneDiscordConfigureHint')}
        </div>
        {status.bot?.botUsername ? (
          <div className="mt-1 font-medium text-ds-muted">
            {t('connectPhoneDiscordBotReady', { name: status.bot.botUsername })}
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid w-full grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void copyInviteUrl()}
          disabled={!hasInviteUrl}
          className="inline-flex min-h-[30px] items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copied ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" strokeWidth={1.8} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
          )}
          {copied ? t('connectPhoneAddImCopied') : t('connectPhoneDiscordCopy')}
        </button>
        <button
          type="button"
          onClick={openInviteUrl}
          disabled={!hasInviteUrl}
          className="inline-flex min-h-[30px] items-center justify-center gap-1.5 rounded-[8px] bg-[#5865F2] px-2.5 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:bg-ds-subtle disabled:text-ds-faint disabled:shadow-none"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('connectPhoneDiscordOpen')}
        </button>
      </div>

      <button
        type="button"
        onClick={openDeveloperPortal}
        className="mt-2 inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
      >
        <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('connectPhoneDiscordPortal')}
      </button>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
          {t('connectPhoneDiscordClientId')}
        </span>
        <input
          className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#5865F2]/45 focus:ring-1 focus:ring-[#5865F2]/25"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder={t('connectPhoneDiscordClientIdPlaceholder')}
        />
      </label>
      <button
        type="button"
        onClick={() => void configureClient()}
        disabled={savingClient || !clientId.trim()}
        className="mt-2 inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {savingClient ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
        ) : (
          <QrCode className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
        {savingClient ? t('connectPhoneDiscordSavingClient') : t('connectPhoneDiscordSaveClient')}
      </button>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
          {t('connectPhoneDiscordProxy')}
        </span>
        <input
          className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#5865F2]/45 focus:ring-1 focus:ring-[#5865F2]/25"
          value={proxyUrl}
          onChange={(event) => setProxyUrl(event.target.value)}
          placeholder={t('connectPhoneDiscordProxyPlaceholder')}
        />
      </label>
      <div className="mt-1.5 text-[11.5px] leading-5 text-ds-faint">
        {t('connectPhoneDiscordProxyHint')}
      </div>
      <button
        type="button"
        onClick={() => void configureProxy()}
        disabled={savingProxy}
        className="mt-2 inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {savingProxy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
        ) : (
          <Wifi className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
        {savingProxy ? t('connectPhoneDiscordSavingProxy') : t('connectPhoneDiscordSaveProxy')}
      </button>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
          {(status.tokenConfigured ?? status.configured)
            ? t('connectPhoneDiscordTokenConfigured')
            : t('connectPhoneDiscordBotToken')}
        </span>
        <input
          type="password"
          className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#5865F2]/45 focus:ring-1 focus:ring-[#5865F2]/25"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={(status.tokenConfigured ?? status.configured)
            ? t('connectPhoneDiscordTokenReplacePlaceholder')
            : t('connectPhoneDiscordBotTokenPlaceholder')}
        />
      </label>
      <button
        type="button"
        onClick={() => void configureToken()}
        disabled={savingToken || !token.trim()}
        className="mt-2 inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] bg-[#222323] px-2.5 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:bg-ds-subtle disabled:text-ds-faint disabled:shadow-none dark:bg-white dark:text-black"
      >
        {savingToken ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
        ) : (
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
        {savingToken ? t('connectPhoneDiscordSavingToken') : t('connectPhoneDiscordSaveToken')}
      </button>

      <div className="mt-2 rounded-[10px] border border-[#5865F2]/15 bg-[#5865F2]/5 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#5865F2]">
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('connectPhoneDiscordTokenTitle')}
        </div>
        <div className="mt-1 text-[11.5px] leading-5 text-ds-muted">
          {t('connectPhoneDiscordTokenHint')}
        </div>
        <div className="mt-1 text-[11.5px] leading-5 text-ds-muted">
          {t('connectPhoneDiscordLocalOnlineGuard')}
        </div>
      </div>

      {(status.tokenConfigured ?? status.configured) ? (
        <div className="mt-3 grid gap-2">
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between text-[11.5px] font-semibold text-ds-muted">
              {t('connectPhoneDiscordServer')}
              <button
                type="button"
                onClick={() => void refreshGuilds()}
                disabled={loadingGuilds}
                className="inline-flex items-center gap-1 text-[11px] text-[#5865F2] disabled:opacity-50"
              >
                {loadingGuilds ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.8} />
                ) : (
                  <RefreshCw className="h-3 w-3" strokeWidth={1.8} />
                )}
                {t('connectPhoneDiscordRefresh')}
              </button>
            </span>
            <select
              className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none focus:border-[#5865F2]/45 focus:ring-1 focus:ring-[#5865F2]/25"
              value={selectedGuildId}
              onChange={(event) => {
                setSelectedGuildId(event.target.value)
                setSelectedChannelId('')
              }}
              disabled={loadingGuilds || guilds.length === 0}
            >
              {guilds.length === 0 ? (
                <option value="">{t('connectPhoneDiscordNoServers')}</option>
              ) : (
                <option value="">{t('connectPhoneDiscordChooseServer')}</option>
              )}
              {guilds.map((guild) => (
                <option key={guild.id} value={guild.id}>{guild.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
              {t('connectPhoneDiscordChannel')}
            </span>
            <select
              className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none focus:border-[#5865F2]/45 focus:ring-1 focus:ring-[#5865F2]/25"
              value={selectedChannelId}
              onChange={(event) => setSelectedChannelId(event.target.value)}
              disabled={loadingChannels || channels.length === 0}
            >
              {channels.length === 0 ? (
                <option value="">
                  {loadingChannels ? t('connectPhoneDiscordLoadingChannels') : t('connectPhoneDiscordNoChannels')}
                </option>
              ) : (
                <option value="">{t('connectPhoneDiscordChooseChannel')}</option>
              )}
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{discordChannelLabel(channel.name)}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
              {t('connectPhoneDiscordAgentName')}
            </span>
            <input
              className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#5865F2]/45 focus:ring-1 focus:ring-[#5865F2]/25"
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              placeholder={t('connectPhoneDiscordAgentNamePlaceholder')}
            />
          </label>

          <div className="rounded-[8px] bg-ds-main/45 px-2.5 py-2 text-[11.5px] leading-5 text-ds-faint">
            {t('connectPhoneDiscordLocalOnlineGuard')}
          </div>

          {statusConflict ? (
            <div className="rounded-[8px] border border-amber-300/70 bg-amber-50 px-2.5 py-2 text-[11.5px] leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <div className="font-semibold">{t('connectPhoneDiscordConflictTitle')}</div>
              <div className="mt-1">
                {t('connectPhoneDiscordConflictDesc', { owner: statusConflict.ownerInstallationId })}
              </div>
              <button
                type="button"
                onClick={() => void takeOverGuard(statusConflict.channelConfigId)}
                disabled={binding}
                className="mt-2 rounded-[7px] border border-amber-400/60 bg-white px-2 py-1 text-[11.5px] font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:opacity-50 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100 dark:hover:bg-amber-300/15"
              >
                {t('connectPhoneDiscordTakeover')}
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={() => void testAndEnable()}
              disabled={binding || !selectedGuild || !selectedChannel}
              className="inline-flex min-h-[32px] items-center justify-center gap-1.5 rounded-[8px] bg-[#5865F2] px-2.5 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-[#4752C4] disabled:cursor-not-allowed disabled:bg-ds-subtle disabled:text-ds-faint disabled:shadow-none"
            >
              {binding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
              {binding ? t('connectPhoneDiscordTesting') : t('connectPhoneDiscordTestEnable')}
            </button>
            {selectedChannelStatus?.enabled ? (
              <button
                type="button"
                onClick={() => void disableGuard()}
                disabled={binding}
                className="inline-flex min-h-[32px] items-center justify-center rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
              >
                {t('connectPhoneDiscordPause')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid gap-1.5">
        {setupSteps.map((step, index) => (
          <div
            key={step.label}
            className="flex min-h-[28px] items-center justify-between gap-2 rounded-[8px] border border-ds-border-muted/70 bg-ds-main/40 px-2 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  step.done
                    ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300'
                    : 'bg-ds-hover text-ds-faint'
                }`}
              >
                {step.done ? <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> : index + 1}
              </span>
              <span className="truncate text-[11.5px] font-medium text-ds-muted">
                {step.label}
              </span>
            </span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${
                step.done
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                  : 'bg-[#5865F2]/10 text-[#5865F2]'
              }`}
            >
              {step.done ? t('connectPhoneDiscordStatusReady') : t('connectPhoneDiscordStatusTodo')}
            </span>
          </div>
        ))}
      </div>

      {discordStatuses.length > 0 ? (
        <div className="mt-3 grid gap-1.5">
          <div className="text-[11.5px] font-semibold text-ds-muted">
            {t('connectPhoneDiscordConfiguredChannels')}
          </div>
          {discordStatuses.map((item) => {
            const workspaceLabel = connectPhoneWorkspaceLabel(
              item.workspaceRoot,
              t('connectPhoneDiscordWorkspaceDefault')
            )
            const configuredChannel = configuredDiscordChannels.find((channel) => channel.id === item.channelConfigId)
            const recentMessage = latestConnectPhoneRecentMessage(configuredChannel)
            return (
            <div
              key={item.channelConfigId}
              className="rounded-[8px] border border-ds-border-muted/70 bg-ds-main/40 px-2.5 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-ds-ink">
                    {item.guildName || item.guildId} · {discordChannelLabel(item.channelName || item.channelId)}
                  </div>
                  <div
                    className="mt-0.5 truncate text-[11px] text-ds-faint"
                    title={workspaceLabel}
                  >
                    {workspaceLabel}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${
                    item.conflict || item.accessError
                      ? 'bg-amber-500/12 text-amber-700 dark:text-amber-200'
                      : item.enabled
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                        : 'bg-ds-hover text-ds-faint'
                  }`}
                >
                  {item.conflict
                    ? t('connectPhoneDiscordConflictState')
                    : item.accessError
                      ? t('connectPhoneDiscordUnavailableState')
                    : item.enabled
                      ? t('connectPhoneDiscordGuardOn')
                      : t('connectPhoneDiscordGuardPaused')}
                </span>
              </div>
              {item.accessError ? (
                <div className="mt-1.5 rounded-[7px] bg-amber-500/10 px-2 py-1.5 text-[11px] leading-5 text-amber-700 dark:text-amber-200">
                  {item.accessError}
                </div>
              ) : null}
              {recentMessage ? (
                <div
                  className="mt-1.5 truncate rounded-[7px] bg-ds-subtle/70 px-2 py-1.5 text-[11px] leading-5 text-ds-muted"
                  title={connectPhoneRecentMessageLabel(recentMessage)}
                >
                  {t('connectPhoneRecentMessage', {
                    message: connectPhoneRecentMessageLabel(recentMessage)
                  })}
                </div>
              ) : null}
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {item.conflict ? (
                  <button
                    type="button"
                    onClick={() => void setGuardForChannel(item.channelConfigId, true, true)}
                    disabled={binding}
                    className="inline-flex min-h-[28px] items-center justify-center rounded-[7px] bg-amber-500 px-2 py-1 text-[11.5px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
                  >
                    {t('connectPhoneDiscordTakeover')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void setGuardForChannel(item.channelConfigId, !item.enabled)}
                    disabled={binding}
                    className="inline-flex min-h-[28px] items-center justify-center rounded-[7px] border border-ds-border bg-ds-main/55 px-2 py-1 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
                  >
                    {item.enabled ? t('connectPhoneDiscordPause') : t('connectPhoneDiscordResume')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGuildId(item.guildId)
                    setSelectedChannelId(item.channelId)
                  }}
                  className="inline-flex min-h-[28px] items-center justify-center rounded-[7px] border border-ds-border bg-ds-main/55 px-2 py-1 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                >
                  {t('connectPhoneDiscordEditBinding')}
                </button>
              </div>
            </div>
            )
          })}
        </div>
      ) : configuredDiscordChannels.length > 0 ? (
        <div className="mt-3 rounded-[8px] bg-ds-main/45 px-2.5 py-2 text-[11.5px] leading-5 text-ds-faint">
          {t('connectPhoneDiscordConfiguredFallback', { count: configuredDiscordChannels.length })}
        </div>
      ) : null}

      <div className="mt-2 rounded-[8px] bg-ds-main/45 px-2.5 py-2 text-[11.5px] leading-5 text-ds-faint">
        {loadingStatus ? t('connectPhoneDiscordLoadingStatus') : statusConflict
          ? t('connectPhoneDiscordGuardConflict')
          : statusAccessError
            ? statusAccessError
          : status.enabled
          ? status.connected
            ? t('connectPhoneDiscordGuardConnected')
            : t('connectPhoneDiscordGuardConnecting')
          : t('connectPhoneDiscordGuardOff')}
      </div>
      {error ? (
        <div className="mt-2 rounded-[8px] bg-red-500/10 px-2.5 py-2 text-[11.5px] leading-5 text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  )
}

export function ZulipBotSetupPanel({
  t,
  channels: configuredChannels,
  defaultWorkspaceRoot = ''
}: {
  t: (k: string, opts?: Record<string, unknown>) => string
  channels: RemoteChannelV1[]
  defaultWorkspaceRoot?: string
}): ReactElement {
  const currentWorkspaceRoot = normalizeConnectPhoneWorkspaceRoot(defaultWorkspaceRoot)
  const [status, setStatus] = useState<ZulipBotStatus>({
    configured: false,
    connected: false,
    enabled: false,
    channels: []
  })
  const [realmUrl, setRealmUrl] = useState('')
  const [botEmail, setBotEmail] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [streams, setStreams] = useState<ZulipStream[]>([])
  const [topics, setTopics] = useState<ZulipTopic[]>([])
  const [selectedStreamId, setSelectedStreamId] = useState('')
  const [topicName, setTopicName] = useState('sciforge')
  const [workspaceRoot, setWorkspaceRoot] = useState(() => currentWorkspaceRoot)
  const [agentName, setAgentName] = useState('zulip bot')
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingStreams, setLoadingStreams] = useState(false)
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [binding, setBinding] = useState(false)
  const [tested, setTested] = useState(false)
  const [error, setError] = useState('')
  const zulipStatuses = status.channels ?? []
  const selectedStream = streams.find((stream) => stream.id === selectedStreamId)
  const selectedChannelStatus = zulipStatuses.find((item) =>
    item.streamId === selectedStreamId &&
    (item.topicName || '') === topicName.trim()
  ) ?? zulipStatuses.find((item) => item.streamId === selectedStreamId)
  const selectedChannelConfigId = selectedChannelStatus?.channelConfigId
  const statusConflict = selectedChannelStatus?.conflict ?? status.conflict
  const statusAccessError = selectedChannelStatus?.accessError ||
    zulipStatuses.find((item) => item.accessError)?.accessError ||
    ''
  const configuredZulipChannels = configuredChannels.filter((channel) => channel.provider === 'zulip')

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (typeof window.sciforge?.getZulipBotStatus !== 'function') return
    setLoadingStatus(true)
    try {
      const next = await window.sciforge.getZulipBotStatus()
      setStatus(next)
      setRealmUrl((current) => current || next.realmUrl || '')
      setBotEmail((current) => current || next.botEmail || next.bot?.botEmail || '')
      setSelectedStreamId((current) => current || next.streamId || '')
      setTopicName((current) => current || next.topicName || 'sciforge')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  const refreshStreams = useCallback(async (): Promise<void> => {
    if (typeof window.sciforge?.listZulipStreams !== 'function') return
    setLoadingStreams(true)
    setError('')
    try {
      const result = await window.sciforge.listZulipStreams()
      if (!result.ok) {
        setError(result.message)
        return
      }
      setStreams(result.streams)
      setSelectedStreamId((current) => {
        if (current && result.streams.some((stream) => stream.id === current)) return current
        if (status.streamId && result.streams.some((stream) => stream.id === status.streamId)) return status.streamId
        return result.streams[0]?.id ?? ''
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingStreams(false)
    }
  }, [status.streamId])

  const refreshTopics = useCallback(async (streamId: string): Promise<void> => {
    if (!streamId || typeof window.sciforge?.listZulipTopics !== 'function') return
    setLoadingTopics(true)
    setError('')
    try {
      const result = await window.sciforge.listZulipTopics(streamId)
      if (!result.ok) {
        setError(result.message)
        setTopics([])
        return
      }
      setTopics(result.topics)
      setTopicName((current) => current || status.topicName || result.topics[0]?.name || 'sciforge')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      setTopics([])
    } finally {
      setLoadingTopics(false)
    }
  }, [status.topicName])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!(status.tokenConfigured ?? status.configured)) return
    void refreshStreams()
  }, [refreshStreams, status.configured, status.tokenConfigured])

  useEffect(() => {
    if (!selectedStreamId) {
      setTopics([])
      return
    }
    void refreshTopics(selectedStreamId)
  }, [refreshTopics, selectedStreamId])

  useEffect(() => {
    if (!selectedChannelStatus) return
    setWorkspaceRoot(resolveConnectPhoneWorkspaceRoot(
      selectedChannelStatus.workspaceRoot,
      currentWorkspaceRoot
    ))
    setAgentName((current) => current === 'zulip bot' ? selectedChannelStatus.agentName || current : current)
  }, [currentWorkspaceRoot, selectedChannelStatus])

  useEffect(() => {
    if (selectedChannelStatus) return
    setWorkspaceRoot((current) => current || currentWorkspaceRoot)
  }, [currentWorkspaceRoot, selectedChannelStatus])

  const configure = async (): Promise<void> => {
    if (!realmUrl.trim() || !botEmail.trim() || !apiKey.trim()) {
      setError(t('connectPhoneZulipRequired'))
      return
    }
    if (typeof window.sciforge?.configureZulipBot !== 'function') {
      setError(t('connectPhoneZulipUnavailable'))
      return
    }
    setSaving(true)
    setError('')
    setTested(false)
    try {
      const result = await window.sciforge.configureZulipBot({
        realmUrl: realmUrl.trim(),
        botEmail: botEmail.trim(),
        apiKey: apiKey.trim()
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setApiKey('')
      setStatus(result.status)
      setRealmUrl(result.status.realmUrl || realmUrl)
      setBotEmail(result.status.botEmail || result.status.bot?.botEmail || botEmail)
      await refreshStreams()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const testAndEnable = async (): Promise<void> => {
    if (!selectedStream) {
      setError(t('connectPhoneZulipSelectStreamFirst'))
      return
    }
    if (
      typeof window.sciforge?.bindZulipChannel !== 'function' ||
      typeof window.sciforge?.testZulipChannel !== 'function' ||
      typeof window.sciforge?.setZulipGuard !== 'function'
    ) {
      setError(t('connectPhoneZulipUnavailable'))
      return
    }
    setBinding(true)
    setError('')
    setTested(false)
    try {
      const bindingWorkspaceRoot = resolveConnectPhoneWorkspaceRoot(workspaceRoot, currentWorkspaceRoot)
      const bind = await window.sciforge.bindZulipChannel({
        ...(selectedChannelConfigId ? { channelConfigId: selectedChannelConfigId } : {}),
        streamId: selectedStream.id,
        streamName: selectedStream.name,
        topicName: topicName.trim() || 'sciforge',
        enabled: false,
        workspaceRoot: bindingWorkspaceRoot,
        model: 'auto',
        agentProfile: {
          name: agentName.trim() || 'zulip bot'
        }
      })
      if (!bind.ok) {
        setError(bind.message)
        return
      }
      setStatus(bind.status)
      const test = await window.sciforge.testZulipChannel(
        selectedStream.id,
        t('connectPhoneZulipTestMessage'),
        bind.channelConfigId,
        topicName.trim() || 'sciforge'
      )
      if (!test.ok) {
        setError(test.message)
        return
      }
      setTested(true)
      const guard = await window.sciforge.setZulipGuard(true, bind.channelConfigId)
      if (!guard.ok) {
        setError(guard.message)
        if (guard.status) setStatus(guard.status)
        return
      }
      setStatus(guard.status)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBinding(false)
    }
  }

  const setGuardForChannel = async (
    channelConfigId: string,
    enabled: boolean,
    forceTakeover = false
  ): Promise<void> => {
    if (!channelConfigId || typeof window.sciforge?.setZulipGuard !== 'function') return
    setBinding(true)
    setError('')
    try {
      const result = await window.sciforge.setZulipGuard(enabled, channelConfigId, forceTakeover)
      if (result.ok) {
        setStatus(result.status)
        return
      }
      setError(result.message)
      if (result.status) setStatus(result.status)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBinding(false)
    }
  }

  const setupSteps = [
    { label: t('connectPhoneZulipStepServer'), done: Boolean(status.realmUrl || realmUrl.trim()) },
    { label: t('connectPhoneZulipStepToken'), done: status.tokenConfigured ?? status.configured },
    { label: t('connectPhoneZulipStepStream'), done: Boolean(status.streamId || selectedStreamId) },
    { label: t('connectPhoneZulipStepGuard'), done: Boolean(status.enabled && (status.connected || tested)) }
  ]

  return (
    <div className="mx-1 flex flex-col rounded-[12px] border border-ds-border bg-ds-card px-3 py-3 shadow-sm">
      <div className="flex h-[132px] w-full items-center justify-center rounded-[10px] border border-[#ececea] bg-white p-2">
        <div className="grid justify-items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-[#52c2a8]/12 text-[#1c8f76]">
            <MessageSquare className="h-8 w-8" strokeWidth={1.8} />
          </div>
          <div className="max-w-[220px] text-[12px] leading-5 text-ds-faint">
            {t('connectPhoneZulipConfigureHint')}
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-[12px] leading-5 text-[#8d95a1]">
        <div className="inline-flex items-center justify-center gap-1.5 font-medium text-[#68707c] dark:text-white/55">
          <MessageSquare className="h-4 w-4" strokeWidth={1.8} />
          {t('connectPhoneZulipJoinTitle')}
        </div>
        {status.bot?.botFullName ? (
          <div className="mt-1 font-medium text-ds-muted">
            {t('connectPhoneZulipBotReady', { name: status.bot.botFullName })}
          </div>
        ) : null}
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
          {t('connectPhoneZulipRealmUrl')}
        </span>
        <input
          className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#1c8f76]/45 focus:ring-1 focus:ring-[#1c8f76]/25"
          value={realmUrl}
          onChange={(event) => setRealmUrl(event.target.value)}
          placeholder={t('connectPhoneZulipRealmUrlPlaceholder')}
        />
      </label>
      <label className="mt-3 block">
        <span className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
          {t('connectPhoneZulipBotEmail')}
        </span>
        <input
          className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#1c8f76]/45 focus:ring-1 focus:ring-[#1c8f76]/25"
          value={botEmail}
          onChange={(event) => setBotEmail(event.target.value)}
          placeholder={t('connectPhoneZulipBotEmailPlaceholder')}
        />
      </label>
      <label className="mt-3 block">
        <span className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
          {(status.tokenConfigured ?? status.configured)
            ? t('connectPhoneZulipTokenConfigured')
            : t('connectPhoneZulipApiKey')}
        </span>
        <input
          type="password"
          className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#1c8f76]/45 focus:ring-1 focus:ring-[#1c8f76]/25"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={(status.tokenConfigured ?? status.configured)
            ? t('connectPhoneZulipTokenReplacePlaceholder')
            : t('connectPhoneZulipApiKeyPlaceholder')}
        />
      </label>
      <button
        type="button"
        onClick={() => void configure()}
        disabled={saving || !realmUrl.trim() || !botEmail.trim() || !apiKey.trim()}
        className="mt-2 inline-flex min-h-[30px] w-full items-center justify-center gap-1.5 rounded-[8px] bg-[#222323] px-2.5 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:bg-ds-subtle disabled:text-ds-faint disabled:shadow-none dark:bg-white dark:text-black"
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
        ) : (
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
        {saving ? t('connectPhoneZulipSavingToken') : t('connectPhoneZulipSaveToken')}
      </button>

      <div className="mt-2 rounded-[10px] border border-[#1c8f76]/15 bg-[#1c8f76]/5 px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#1c8f76]">
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('connectPhoneZulipTokenTitle')}
        </div>
        <div className="mt-1 text-[11.5px] leading-5 text-ds-muted">
          {t('connectPhoneZulipTokenHint')}
        </div>
      </div>

      {(status.tokenConfigured ?? status.configured) ? (
        <div className="mt-3 grid gap-2">
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between text-[11.5px] font-semibold text-ds-muted">
              {t('connectPhoneZulipStream')}
              <button
                type="button"
                onClick={() => void refreshStreams()}
                disabled={loadingStreams}
                className="inline-flex items-center gap-1 text-[11px] text-[#1c8f76] disabled:opacity-50"
              >
                {loadingStreams ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.8} />
                ) : (
                  <RefreshCw className="h-3 w-3" strokeWidth={1.8} />
                )}
                {t('connectPhoneDiscordRefresh')}
              </button>
            </span>
            <select
              className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none focus:border-[#1c8f76]/45 focus:ring-1 focus:ring-[#1c8f76]/25"
              value={selectedStreamId}
              onChange={(event) => {
                setSelectedStreamId(event.target.value)
                setTopicName('sciforge')
              }}
              disabled={loadingStreams || streams.length === 0}
            >
              {streams.length === 0 ? (
                <option value="">{t('connectPhoneZulipNoStreams')}</option>
              ) : (
                <option value="">{t('connectPhoneZulipChooseStream')}</option>
              )}
              {streams.map((stream) => (
                <option key={stream.id} value={stream.id}>{stream.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
              {t('connectPhoneZulipTopic')}
            </span>
            <input
              className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#1c8f76]/45 focus:ring-1 focus:ring-[#1c8f76]/25"
              list="zulip-topic-options"
              value={topicName}
              onChange={(event) => setTopicName(event.target.value)}
              placeholder={loadingTopics ? t('connectPhoneZulipLoadingTopics') : t('connectPhoneZulipTopicPlaceholder')}
            />
            <datalist id="zulip-topic-options">
              {topics.map((topic) => (
                <option key={topic.name} value={topic.name} />
              ))}
            </datalist>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold text-ds-muted">
              {t('connectPhoneDiscordAgentName')}
            </span>
            <input
              className="h-8 w-full rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#1c8f76]/45 focus:ring-1 focus:ring-[#1c8f76]/25"
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              placeholder={t('connectPhoneDiscordAgentNamePlaceholder')}
            />
          </label>

          <div className="rounded-[8px] bg-ds-main/45 px-2.5 py-2 text-[11.5px] leading-5 text-ds-faint">
            {t('connectPhoneZulipLocalOnlineGuard')}
          </div>

          {statusConflict ? (
            <div className="rounded-[8px] border border-amber-300/70 bg-amber-50 px-2.5 py-2 text-[11.5px] leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <div className="font-semibold">{t('connectPhoneZulipConflictTitle')}</div>
              <div className="mt-1">
                {t('connectPhoneDiscordConflictDesc', { owner: statusConflict.ownerInstallationId })}
              </div>
              <button
                type="button"
                onClick={() => void setGuardForChannel(statusConflict.channelConfigId, true, true)}
                disabled={binding}
                className="mt-2 rounded-[7px] border border-amber-400/60 bg-white px-2 py-1 text-[11.5px] font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:opacity-50 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100 dark:hover:bg-amber-300/15"
              >
                {t('connectPhoneDiscordTakeover')}
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={() => void testAndEnable()}
              disabled={binding || !selectedStream}
              className="inline-flex min-h-[32px] items-center justify-center gap-1.5 rounded-[8px] bg-[#1c8f76] px-2.5 py-1.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-[#15745f] disabled:cursor-not-allowed disabled:bg-ds-subtle disabled:text-ds-faint disabled:shadow-none"
            >
              {binding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
              {binding ? t('connectPhoneZulipTesting') : t('connectPhoneZulipTestEnable')}
            </button>
            {selectedChannelStatus?.enabled ? (
              <button
                type="button"
                onClick={() => void setGuardForChannel(selectedChannelStatus.channelConfigId, false)}
                disabled={binding}
                className="inline-flex min-h-[32px] items-center justify-center rounded-[8px] border border-ds-border bg-ds-main/55 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
              >
                {t('connectPhoneDiscordPause')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid gap-1.5">
        {setupSteps.map((step, index) => (
          <div
            key={step.label}
            className="flex min-h-[28px] items-center justify-between gap-2 rounded-[8px] border border-ds-border-muted/70 bg-ds-main/40 px-2 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  step.done
                    ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300'
                    : 'bg-ds-hover text-ds-faint'
                }`}
              >
                {step.done ? <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> : index + 1}
              </span>
              <span className="truncate text-[11.5px] font-medium text-ds-muted">
                {step.label}
              </span>
            </span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${
                step.done
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                  : 'bg-[#1c8f76]/10 text-[#1c8f76]'
              }`}
            >
              {step.done ? t('connectPhoneDiscordStatusReady') : t('connectPhoneDiscordStatusTodo')}
            </span>
          </div>
        ))}
      </div>

      {zulipStatuses.length > 0 ? (
        <div className="mt-3 grid gap-1.5">
          <div className="text-[11.5px] font-semibold text-ds-muted">
            {t('connectPhoneZulipConfiguredChannels')}
          </div>
          {zulipStatuses.map((item) => {
            const workspaceLabel = connectPhoneWorkspaceLabel(
              item.workspaceRoot,
              t('connectPhoneDiscordWorkspaceDefault')
            )
            const configuredChannel = configuredZulipChannels.find((channel) => channel.id === item.channelConfigId)
            const recentMessage = latestConnectPhoneRecentMessage(configuredChannel)
            return (
              <div
                key={item.channelConfigId}
                className="rounded-[8px] border border-ds-border-muted/70 bg-ds-main/40 px-2.5 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-ds-ink">
                      {zulipBindingLabel(item.streamName || item.streamId, item.topicName)}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ds-faint" title={workspaceLabel}>
                      {workspaceLabel}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${
                      item.conflict || item.accessError
                        ? 'bg-amber-500/12 text-amber-700 dark:text-amber-200'
                        : item.enabled
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                          : 'bg-ds-hover text-ds-faint'
                    }`}
                  >
                    {item.conflict
                      ? t('connectPhoneDiscordConflictState')
                      : item.accessError
                        ? t('connectPhoneDiscordUnavailableState')
                      : item.enabled
                        ? t('connectPhoneDiscordGuardOn')
                        : t('connectPhoneDiscordGuardPaused')}
                  </span>
                </div>
                {recentMessage ? (
                  <div
                    className="mt-1.5 truncate rounded-[7px] bg-ds-subtle/70 px-2 py-1.5 text-[11px] leading-5 text-ds-muted"
                    title={connectPhoneRecentMessageLabel(recentMessage)}
                  >
                    {t('connectPhoneRecentMessage', {
                      message: connectPhoneRecentMessageLabel(recentMessage)
                    })}
                  </div>
                ) : null}
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => void setGuardForChannel(item.channelConfigId, item.conflict ? true : !item.enabled, Boolean(item.conflict))}
                    disabled={binding}
                    className="inline-flex min-h-[28px] items-center justify-center rounded-[7px] border border-ds-border bg-ds-main/55 px-2 py-1 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
                  >
                    {item.conflict
                      ? t('connectPhoneDiscordTakeover')
                      : item.enabled
                        ? t('connectPhoneDiscordPause')
                        : t('connectPhoneDiscordResume')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStreamId(item.streamId)
                      setTopicName(item.topicName || 'sciforge')
                    }}
                    className="inline-flex min-h-[28px] items-center justify-center rounded-[7px] border border-ds-border bg-ds-main/55 px-2 py-1 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                  >
                    {t('connectPhoneDiscordEditBinding')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : configuredZulipChannels.length > 0 ? (
        <div className="mt-3 rounded-[8px] bg-ds-main/45 px-2.5 py-2 text-[11.5px] leading-5 text-ds-faint">
          {t('connectPhoneZulipConfiguredFallback', { count: configuredZulipChannels.length })}
        </div>
      ) : null}

      <div className="mt-2 rounded-[8px] bg-ds-main/45 px-2.5 py-2 text-[11.5px] leading-5 text-ds-faint">
        {loadingStatus ? t('connectPhoneZulipLoadingStatus') : statusConflict
          ? t('connectPhoneZulipGuardConflict')
          : statusAccessError
            ? statusAccessError
          : status.enabled
            ? status.connected
              ? t('connectPhoneZulipGuardConnected')
              : t('connectPhoneZulipGuardConnecting')
            : t('connectPhoneZulipGuardOff')}
      </div>
      {error ? (
        <div className="mt-2 rounded-[8px] bg-red-500/10 px-2.5 py-2 text-[11.5px] leading-5 text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function discordChannelLabel(name: string): string {
  const trimmed = name.trim().replace(/^#/, '')
  return trimmed ? `#${trimmed}` : 'Discord'
}

function zulipBindingLabel(streamName: string, topicName: string): string {
  const stream = streamName.trim() || 'Zulip'
  const topic = topicName.trim()
  return topic ? `${stream} · #${topic}` : stream
}

function ConnectPhoneTargetLogo({
  target,
  className = 'h-5 w-5'
}: {
  target: ConnectPhonePanelTarget
  className?: string
}): ReactElement {
  if (target === 'discord') return <DiscordLogo className={className} />
  if (target === 'zulip') return <MessageSquare className={className} strokeWidth={1.8} />
  return <RemoteChannelProviderLogo provider={connectPhoneProviderForTarget(target)} className={className} />
}

function DiscordLogo({ className = 'h-5 w-5' }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M19.6 5.4A17.1 17.1 0 0 0 15.4 4l-.2.4c1.5.4 2.2 1 2.2 1s-1.9-1-5.4-1-5.4 1-5.4 1 .7-.6 2.2-1L8.6 4a17.1 17.1 0 0 0-4.2 1.4C1.7 9.4 1 13.3 1.4 17.1A17 17 0 0 0 6.6 20l1.1-1.8c-.6-.2-1.2-.5-1.7-.9l.4-.3c3.3 1.5 7 1.5 10.3 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.8a17 17 0 0 0 5.2-2.9c.5-4.4-.8-8.3-2.1-11.7Z"
        fill="#5865F2"
      />
      <path
        d="M9 14.3c-.9 0-1.6-.8-1.6-1.8S8.1 10.7 9 10.7s1.6.8 1.6 1.8-.7 1.8-1.6 1.8Zm6 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8Z"
        fill="white"
      />
    </svg>
  )
}

export function ConnectPhoneDialog({
  channels,
  onAddProvider,
  onDisconnect,
  onOpenSettings,
  onClose,
  workspaceRoot = ''
}: {
  channels: RemoteChannelV1[]
  onAddProvider: AddConnectPhoneChannel
  onDisconnect: (channelId: string) => Promise<void>
  onOpenSettings: () => void
  onClose: () => void
  workspaceRoot?: string
}): ReactElement {
  const { t } = useTranslation('common')

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('connectPhoneTitle')}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[min(640px,calc(100vh-32px))] w-full max-w-[380px] flex-col overflow-hidden rounded-[16px] border border-ds-border bg-ds-elevated shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-ds-border-muted/60 px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
              <h2 className="truncate text-[15px] font-semibold text-ds-ink">
                {t('connectPhoneTitle')}
              </h2>
            </div>
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-ds-faint">
              {t('connectPhoneAutoBindHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('connectPhoneAddImClose')}
            title={t('connectPhoneAddImClose')}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1">
          <ConnectPhoneSidebarPanel
            channels={channels}
            onAddProvider={onAddProvider}
            onDisconnect={onDisconnect}
            onOpenSettings={onOpenSettings}
            workspaceRoot={workspaceRoot}
          />
        </div>
      </div>
    </div>
  )
}
