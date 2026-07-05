import type { ReactElement } from 'react'
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  FolderOpen,
  MessageSquare,
  Smartphone
} from 'lucide-react'
import type { AgentRuntimeId, RemoteChannelV1 } from '@shared/app-settings'
import { workspaceLabelFromPath } from '../../lib/workspace-label'

type RemoteGuardTarget = {
  threadId: string
  runtimeId: AgentRuntimeId
}

type RemoteGuardDetailViewProps = {
  channel: RemoteChannelV1
  onOpenThread: (threadId: string, runtimeId: AgentRuntimeId) => void
  onOpenSettings: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}

export function remoteGuardChannelTitle(channel: RemoteChannelV1): string {
  if (channel.platformCredential?.kind === 'discord') {
    const channelName = channel.platformCredential.channelName.trim() || channel.platformCredential.channelId.trim()
    return channelName ? `#${channelName}` : 'Discord'
  }
  if (channel.platformCredential?.kind === 'zulip') {
    const stream = channel.platformCredential.streamName.trim() || channel.platformCredential.streamId.trim()
    const topic = channel.platformCredential.topicName.trim()
    if (stream && topic) return `${stream} · #${topic}`
    return stream || 'Zulip'
  }
  return channel.label.trim() || channel.agentProfile.name.trim() || remoteGuardProviderLabel(channel.provider)
}

export function remoteGuardProviderLabel(provider: RemoteChannelV1['provider']): string {
  if (provider === 'discord') return 'Discord'
  if (provider === 'zulip') return 'Zulip'
  if (provider === 'weixin') return 'WeChat'
  return 'Feishu / Lark'
}

export function remoteGuardTargetThread(channel: RemoteChannelV1): RemoteGuardTarget | null {
  const preferredRuntime: AgentRuntimeId =
    channel.runtimeId === 'claude' ? 'claude' : channel.runtimeId === 'codex' ? 'codex' : 'sciforge'
  const preferred = channel.agentThreadIds?.[preferredRuntime]?.trim()
  if (preferred) return { threadId: preferred, runtimeId: preferredRuntime }
  for (const runtimeId of ['claude', 'codex', 'sciforge'] as const satisfies readonly AgentRuntimeId[]) {
    const threadId = channel.agentThreadIds?.[runtimeId]?.trim()
    if (threadId) return { threadId, runtimeId }
  }
  return null
}

export function latestRemoteGuardMessages(channel: RemoteChannelV1): NonNullable<RemoteChannelV1['recentMessages']> {
  return [...(channel.recentMessages ?? [])]
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
    .slice(0, 6)
}

export function remoteGuardMessageLabel(message: NonNullable<RemoteChannelV1['recentMessages']>[number]): string {
  const sender = message.senderName?.trim()
  const text = message.text?.trim()
  if (sender && text) return `${sender}: ${text}`
  return text || sender || message.chatId
}

export function RemoteGuardDetailView({
  channel,
  onOpenThread,
  onOpenSettings,
  t
}: RemoteGuardDetailViewProps): ReactElement {
  const providerLabel = remoteGuardProviderLabel(channel.provider)
  const title = remoteGuardChannelTitle(channel)
  const target = remoteGuardTargetThread(channel)
  const messages = latestRemoteGuardMessages(channel)
  const workspaceRoot = channel.workspaceRoot.trim()
  const workspaceLabel = workspaceRoot ? workspaceLabelFromPath(workspaceRoot) : t('remoteGuardDefaultWorkspace')
  const currentRemote = channel.remoteSession?.senderName?.trim() ||
    channel.remoteSession?.chatId?.trim() ||
    ''
  const lastFailure = channel.lastFailure
  const lastFailureMessage = lastFailure?.message.trim() ?? ''

  return (
    <div className="ds-no-drag flex min-h-0 flex-1 overflow-y-auto px-4 py-7 md:px-8">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4">
        <div className="rounded-[8px] border border-ds-border bg-ds-card/82 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-accent/20 bg-accent/10 text-accent">
                <Bot className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="truncate text-[22px] font-semibold tracking-normal text-ds-ink">
                    {title}
                  </h1>
                  <span className="rounded-full border border-ds-border-muted bg-ds-subtle px-2 py-0.5 text-[11px] font-semibold text-ds-faint">
                    {providerLabel}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                    channel.enabled
                      ? 'border-accent/25 bg-accent/10 text-accent'
                      : 'border-ds-border-muted bg-ds-subtle text-ds-faint'
                  }`}>
                    {channel.enabled ? t('remoteGuardStatusActive') : t('remoteGuardStatusPaused')}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-6 text-ds-muted">
                  {t('remoteGuardSubtitle')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-[7px] border border-ds-border bg-ds-main/65 px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <Smartphone className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('remoteGuardManage')}
            </button>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <RemoteGuardFact
              label={t('remoteGuardWorkspace')}
              value={workspaceLabel}
              title={workspaceRoot || workspaceLabel}
            />
            <RemoteGuardFact
              label={t('remoteGuardCurrentThread')}
              value={target ? `${target.runtimeId}:${shortRemoteGuardId(target.threadId)}` : t('remoteGuardNoThread')}
              title={target?.threadId}
            />
            <RemoteGuardFact
              label={t('remoteGuardRemoteUser')}
              value={currentRemote || t('remoteGuardNoRemoteUser')}
              title={currentRemote}
            />
          </div>

          {lastFailureMessage ? (
            <div
              className="mt-4 flex gap-2 rounded-[7px] border border-red-400/25 bg-red-500/10 px-3 py-2.5 text-[12.5px] leading-5 text-red-700 dark:text-red-300"
              title={lastFailureMessage}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
              <div className="min-w-0">
                <div className="font-semibold">{t('remoteGuardLastFailure')}</div>
                <div className="mt-0.5 break-words text-red-800/90 dark:text-red-200/90">
                  {lastFailureMessage}
                </div>
                {lastFailure?.failureKind ? (
                  <div className="mt-1 text-[11px] text-red-700/75 dark:text-red-300/75">
                    {t('remoteGuardFailureKind', { kind: lastFailure.failureKind })}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!target}
              onClick={() => {
                if (target) onOpenThread(target.threadId, target.runtimeId)
              }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[7px] bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
              {t('remoteGuardOpenThread')}
            </button>
            <div className="inline-flex min-h-9 items-center rounded-[7px] bg-ds-subtle px-3 py-2 text-[12.5px] leading-5 text-ds-muted">
              {t('remoteGuardNewHint')}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[8px] border border-ds-border bg-ds-card/72 p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
              <MessageSquare className="h-4 w-4 text-ds-faint" strokeWidth={1.8} />
              {t('remoteGuardRecentMessages')}
            </div>
            <div className="mt-3 space-y-2">
              {messages.length > 0 ? messages.map((message) => (
                <div
                  key={`${message.channelId}:${message.messageId}`}
                  className="rounded-[7px] bg-ds-main/60 px-3 py-2"
                >
                  <div className="truncate text-[12.5px] text-ds-ink">
                    {remoteGuardMessageLabel(message)}
                  </div>
                  <div className="mt-1 text-[11px] text-ds-faint">
                    {new Date(message.receivedAt).toLocaleString()}
                  </div>
                </div>
              )) : (
                <div className="rounded-[7px] bg-ds-main/55 px-3 py-3 text-[12.5px] text-ds-faint">
                  {t('remoteGuardNoMessages')}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[8px] border border-ds-border bg-ds-card/72 p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
              <FolderOpen className="h-4 w-4 text-ds-faint" strokeWidth={1.8} />
              {t('remoteGuardCommands')}
            </div>
            <div className="mt-3 space-y-2 text-[12.5px] leading-5 text-ds-muted">
              <RemoteGuardCommand command="/where" label={t('remoteGuardCommandWhere')} />
              <RemoteGuardCommand command="/new" label={t('remoteGuardCommandNew')} />
              <RemoteGuardCommand command="/summary" label={t('remoteGuardCommandSummary')} />
              <RemoteGuardCommand command="/attach current" label={t('remoteGuardCommandAttach')} />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function RemoteGuardFact({
  label,
  value,
  title
}: {
  label: string
  value: string
  title?: string
}): ReactElement {
  return (
    <div className="min-w-0 rounded-[7px] bg-ds-main/55 px-3 py-2" title={title}>
      <div className="text-[11px] font-medium text-ds-faint">{label}</div>
      <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">{value}</div>
    </div>
  )
}

function RemoteGuardCommand({
  command,
  label
}: {
  command: string
  label: string
}): ReactElement {
  return (
    <div className="flex items-start gap-2">
      <code className="shrink-0 rounded-[6px] border border-ds-border-muted bg-ds-main px-1.5 py-0.5 text-[11.5px] text-ds-ink">
        {command}
      </code>
      <span>{label}</span>
    </div>
  )
}

function shortRemoteGuardId(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 10) return trimmed
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}
