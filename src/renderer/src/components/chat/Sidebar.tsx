import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Clock3,
  LayoutGrid,
  MessageSquare,
  Plus,
  Settings,
  Smartphone,
  Workflow
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import {
  remoteChannelThreadBindingsFromChannels,
  watchedRemoteChannelThreadIdsFromChannels
} from '../../store/chat-store-helpers'
import type {
  RemoteChannelV1,
} from '@shared/app-settings'
import { ConnectPhoneDialog, resolveConnectPhoneWorkspaceRoot } from './ConnectPhoneView'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  activeView: 'chat' | 'schedule' | 'workflow'
  connectPhoneSidebarOpen: boolean
  pluginsActive: boolean
  runtimeReady: boolean
  threadSearch: string
  showArchivedThreads: boolean
  onThreadSearchChange: (query: string) => void
  onShowArchivedThreadsChange: (show: boolean) => void
  onSelectThread: (id: string) => void
  onRenameThread: (id: string, title: string) => Promise<void>
  onArchiveThread: (id: string) => Promise<void>
  onDeleteThread: (id: string) => Promise<void>
  onRestoreThread: (id: string) => Promise<void>
  onNewChat: () => void
  onNewChatInWorkspace: (workspaceRoot: string) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: () => void
  onToggleConnectPhone: () => void
  onScheduleOpen: () => void
  onWorkflowOpen: () => void
  onToggleSidebar: () => void
}

export function Sidebar({
  threads,
  activeThreadId,
  activeView,
  connectPhoneSidebarOpen,
  pluginsActive,
  runtimeReady,
  threadSearch,
  showArchivedThreads,
  onThreadSearchChange,
  onShowArchivedThreadsChange,
  onSelectThread,
  onRenameThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onNewChat,
  onNewChatInWorkspace,
  onOpenSettings,
  onOpenPlugins,
  onToggleConnectPhone,
  onScheduleOpen,
  onWorkflowOpen,
  onToggleSidebar
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const codeWorkspaceRoots = useChatStore((s) => s.codeWorkspaceRoots)
  const hiddenCodeWorkspaceRoots = useChatStore((s) => s.hiddenCodeWorkspaceRoots)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const deleteWorkspace = useChatStore((s) => s.deleteWorkspace)
  const busy = useChatStore((s) => s.busy)
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)
  const queuedMessages = useChatStore((s) => s.queuedMessages)
  const remoteChannels = useChatStore((s) => s.remoteChannels)
  const activeRemoteChannelId = useChatStore((s) => s.activeRemoteChannelId)
  const remoteGuardChannelId = useChatStore((s) => s.remoteGuardChannelId)
  const selectRemoteGuardChannel = useChatStore((s) => s.selectRemoteGuardChannel)
  const addRemoteChannel = useChatStore((s) => s.addRemoteChannel)
  const deleteRemoteChannel = useChatStore((s) => s.deleteRemoteChannel)
  const botWatchedThreadIds = useMemo(
    () => watchedRemoteChannelThreadIdsFromChannels(remoteChannels),
    [remoteChannels]
  )
  const botThreadBindings = useMemo(
    () => remoteChannelThreadBindingsFromChannels(remoteChannels),
    [remoteChannels]
  )
  const queuedThreadIds = useMemo(
    () => new Set(queuedMessages.map((message) => message.threadId?.trim() ?? '').filter(Boolean)),
    [queuedMessages]
  )
  const activeRemoteThreadIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [threadId, binding] of botThreadBindings) {
      if (binding.channelId === activeRemoteChannelId) ids.add(threadId)
    }
    return ids
  }, [activeRemoteChannelId, botThreadBindings])
  return (
    <>
    <SidebarFrame
      title={t('appName')}
      onCollapse={onToggleSidebar}
      footer={
        <div className="space-y-1">
          <SidebarCommandRow
            icon={<Smartphone className="h-4 w-4" strokeWidth={1.75} />}
            label={t('connectPhoneLabel')}
            onClick={onToggleConnectPhone}
            active={connectPhoneSidebarOpen}
            variant="footer"
          />
          <SidebarCommandRow
            icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
            label={t('settings')}
            onClick={() => onOpenSettings('general')}
            variant="footer"
          />
        </div>
      }
    >
      <div className="ds-no-drag flex flex-col px-1">
        <SidebarCommandRow
          icon={<Plus className="h-4 w-4" strokeWidth={2} />}
          label={t('newAgent')}
          onClick={runtimeReady ? onNewChat : undefined}
          disabled={!runtimeReady}
          disabledHint={t('runtimeActionNeedsConnection')}
          variant="accent"
        />
        <SidebarCommandRow
          icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
          label={t('plugins')}
          onClick={onOpenPlugins}
          active={pluginsActive}
        />
        <SidebarCommandRow
          icon={<Clock3 className="h-4 w-4" strokeWidth={1.75} />}
          label={t('schedule')}
          onClick={onScheduleOpen}
          active={activeView === 'schedule'}
        />
        <SidebarCommandRow
          icon={<Workflow className="h-4 w-4" strokeWidth={1.75} />}
          label={t('workflow')}
          onClick={onWorkflowOpen}
          active={activeView === 'workflow'}
        />
      </div>

      <div className="ds-no-drag mx-1 my-3" />

      <SidebarRemoteChannelSection
        channels={remoteChannels}
        activeChannelId={remoteGuardChannelId ?? ''}
        runtimeReady={runtimeReady}
        onSelectChannel={selectRemoteGuardChannel}
        t={t}
      />
      <SidebarProjectsSection
        threads={threads}
        activeView="chat"
        activeThreadId={activeThreadId}
        runtimeReady={runtimeReady}
        searchQuery={threadSearch}
        showArchived={showArchivedThreads}
        workspaceRoot={workspaceRoot}
        workspaceRoots={codeWorkspaceRoots}
        hiddenWorkspaceRoots={hiddenCodeWorkspaceRoots}
        busy={busy}
        watchTurnCompletion={watchTurnCompletion}
        unreadThreadIds={unreadThreadIds}
        botWatchedThreadIds={botWatchedThreadIds}
        botThreadBindings={botThreadBindings}
        queuedThreadIds={queuedThreadIds}
        activeRemoteThreadIds={activeRemoteThreadIds}
        locale={i18n.language}
        onPickWorkspace={() => void chooseWorkspace()}
        onRemoveWorkspace={deleteWorkspace}
        onCreateThreadInWorkspace={onNewChatInWorkspace}
        onSelectThread={onSelectThread}
        onRenameThread={onRenameThread}
        onArchiveThread={onArchiveThread}
        onDeleteThread={onDeleteThread}
        onRestoreThread={onRestoreThread}
        onSearchQueryChange={onThreadSearchChange}
        onShowArchivedChange={onShowArchivedThreadsChange}
        t={t}
      />

    </SidebarFrame>

    {connectPhoneSidebarOpen ? (
      <ConnectPhoneDialog
        channels={remoteChannels}
        workspaceRoot={workspaceRoot}
        onAddProvider={async (provider, agentProfile, platformCredential, options) => {
          await addRemoteChannel(provider, agentProfile, platformCredential, {
            ...options,
            workspaceRoot: resolveConnectPhoneWorkspaceRoot(options?.workspaceRoot, workspaceRoot),
            preserveRoute: true
          })
          onToggleConnectPhone()
        }}
        onDisconnect={(channelId) => deleteRemoteChannel(channelId)}
        onOpenSettings={() => {
          onToggleConnectPhone()
          onOpenSettings('connectPhone')
        }}
        onClose={onToggleConnectPhone}
      />
    ) : null}

    </>
  )
}

type SidebarRemoteChannelSectionProps = {
  channels: RemoteChannelV1[]
  activeChannelId: string
  runtimeReady: boolean
  onSelectChannel: (channelId: string) => void
  t: (k: string, opts?: Record<string, unknown>) => string
}

export function SidebarRemoteChannelSection({
  channels,
  activeChannelId,
  runtimeReady,
  onSelectChannel,
  t
}: SidebarRemoteChannelSectionProps): ReactElement | null {
  const visibleChannels = [...channels]
    .filter((channel) =>
      channel.enabled ||
      channel.conversations.length > 0 ||
      (channel.recentMessages?.length ?? 0) > 0
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  if (visibleChannels.length === 0) return null

  return (
    <div className="ds-no-drag mb-2 px-1">
      <SidebarSectionHeader label={t('sidebarRemoteChannels')} />
      <div className="space-y-[3px] px-0.5">
        {visibleChannels.map((channel) => {
          const active = channel.id === activeChannelId
          const latestMessage = latestSidebarRemoteMessage(channel)
          const secondary = sidebarRemoteChannelSecondaryLabel(channel, latestMessage, t)
          const statusLabel = channel.enabled
            ? t('sidebarRemoteChannelGuarding')
            : t('sidebarRemoteChannelPaused')
          const title = sidebarRemoteChannelTitle(channel)
          return (
            <SidebarTreeRow
              key={channel.id}
              active={active}
              activeVariant="outline"
              disabled={!runtimeReady}
              title={`${title}\n${secondary}`}
              ariaLabel={`${title} — ${statusLabel} — ${secondary}`}
              onClick={() => onSelectChannel(channel.id)}
              trailing={
                <span
                  className={`mr-1 inline-flex min-h-5 shrink-0 items-center rounded-full border px-1.5 text-[10.5px] font-semibold leading-none ${
                    channel.enabled
                      ? 'border-accent/25 bg-accent/10 text-accent'
                      : 'border-ds-border-muted bg-ds-subtle text-ds-faint'
                  }`}
                  title={statusLabel}
                >
                  {statusLabel}
                </span>
              }
              className={channel.enabled ? undefined : 'opacity-60'}
              buttonClassName="items-center gap-2 px-2.5 py-1.5"
            >
              <Bot className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-accent' : 'text-ds-faint'}`} strokeWidth={1.85} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-[13px] text-ds-ink">{title}</span>
                  <SidebarRemoteProviderPill provider={channel.provider} />
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-ds-faint">
                  {secondary}
                </span>
              </span>
            </SidebarTreeRow>
          )
        })}
      </div>
    </div>
  )
}

function SidebarRemoteProviderPill({
  provider
}: {
  provider: RemoteChannelV1['provider']
}): ReactElement {
  const label = provider === 'discord'
    ? 'Discord'
    : provider === 'zulip'
      ? 'Zulip'
      : provider === 'weixin'
        ? 'WeChat'
        : 'Feishu'
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ds-border-muted bg-ds-subtle/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-ds-faint">
      <MessageSquare className="h-2.5 w-2.5" strokeWidth={1.8} />
      {label}
    </span>
  )
}

function sidebarRemoteChannelTitle(channel: RemoteChannelV1): string {
  if (channel.platformCredential?.kind === 'discord') {
    const name = channel.platformCredential.channelName.trim() || channel.platformCredential.channelId.trim()
    return name ? `#${name}` : 'Discord'
  }
  if (channel.platformCredential?.kind === 'zulip') {
    const stream = channel.platformCredential.streamName.trim() || channel.platformCredential.streamId.trim()
    const topic = channel.platformCredential.topicName.trim()
    if (stream && topic) return `${stream} · #${topic}`
    return stream || 'Zulip'
  }
  return channel.label.trim() || channel.agentProfile.name.trim() || remoteChannelSidebarProviderLabel(channel.provider)
}

function sidebarRemoteChannelSecondaryLabel(
  channel: RemoteChannelV1,
  latestMessage: NonNullable<RemoteChannelV1['recentMessages']>[number] | null,
  t: (k: string, opts?: Record<string, unknown>) => string
): string {
  if (latestMessage) {
    const messageLabel = sidebarRemoteMessageLabel(latestMessage)
    if (messageLabel) {
      return t('sidebarRemoteChannelLatest', { message: messageLabel })
    }
    return t('sidebarRemoteChannelReceived')
  }
  const latestConversation = [...channel.conversations]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
  const conversationLabel = latestConversation?.senderName.trim() ||
    latestConversation?.chatId.trim() ||
    latestConversation?.remoteThreadId.trim() ||
    ''
  if (conversationLabel) return t('sidebarRemoteChannelLatest', { message: conversationLabel })
  return t('sidebarRemoteChannelNoMessages')
}

function latestSidebarRemoteMessage(channel: RemoteChannelV1): NonNullable<RemoteChannelV1['recentMessages']>[number] | null {
  const messages = channel.recentMessages ?? []
  if (messages.length === 0) return null
  return [...messages].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))[0] ?? null
}

function sidebarRemoteMessageLabel(message: NonNullable<RemoteChannelV1['recentMessages']>[number]): string {
  const sender = message.senderName?.trim()
  const text = message.text?.trim()
  if (sender && text) return `${sender}: ${text}`
  return text || sender || ''
}

function remoteChannelSidebarProviderLabel(provider: RemoteChannelV1['provider']): string {
  if (provider === 'discord') return 'Discord'
  if (provider === 'zulip') return 'Zulip'
  if (provider === 'weixin') return 'WeChat'
  return 'Feishu / Lark'
}
