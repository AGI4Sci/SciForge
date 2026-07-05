import type { ReactElement } from 'react'
import {
  REMOTE_CHANNEL_MODEL_IDS,
  type AppSettingsPatch,
  type AppSettingsV1,
  type RemoteChannelAgentProfileV1,
  type RemoteChannelV1,
  type RemoteChannelDiscordPlatformCredentialV1,
  type RemoteChannelZulipPlatformCredentialV1,
  type RemoteChannelModel
} from '@shared/app-settings'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'
import { remoteChannelProviderDisplayLabel } from './chat/RemoteChannelSidebar'

type ConnectPhoneSettingsContext = {
  t: (key: string, values?: Record<string, unknown>) => string
  form: AppSettingsV1
  update: (partial: AppSettingsPatch) => void
  selectControlClass: string
  pickConnectPhoneWorkspace: () => Promise<void>
  resetConnectPhoneWorkspaceToDefault: () => void
  connectPhoneWorkspacePickerError: string | null
}

type ConnectPhoneAgentProfileField = keyof RemoteChannelAgentProfileV1

const profileFields: Array<{
  key: ConnectPhoneAgentProfileField
  labelKey: string
  placeholderKey: string
  rows: number
}> = [
  { key: 'description', labelKey: 'connectPhoneManageAgentDescription', placeholderKey: 'connectPhoneManageAgentDescriptionPlaceholder', rows: 2 },
  { key: 'identity', labelKey: 'connectPhoneManageAgentIdentity', placeholderKey: 'connectPhoneManageAgentIdentityPlaceholder', rows: 4 },
  { key: 'personality', labelKey: 'connectPhoneManageAgentPersonality', placeholderKey: 'connectPhoneManageAgentPersonalityPlaceholder', rows: 3 },
  { key: 'userContext', labelKey: 'connectPhoneManageAgentUserContext', placeholderKey: 'connectPhoneManageAgentUserContextPlaceholder', rows: 3 },
  { key: 'replyRules', labelKey: 'connectPhoneManageAgentReplyRules', placeholderKey: 'connectPhoneManageAgentReplyRulesPlaceholder', rows: 4 }
]

function textInputClass(extra = ''): string {
  return `w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 ${extra}`
}

function updateChannels(
  form: AppSettingsV1,
  update: (partial: AppSettingsPatch) => void,
  mapper: (channel: RemoteChannelV1) => RemoteChannelV1
): void {
  update({ remoteChannel: { channels: form.remoteChannel.channels.map(mapper) } })
}

function updateChannel(
  form: AppSettingsV1,
  update: (partial: AppSettingsPatch) => void,
  channelId: string,
  patch: Partial<RemoteChannelV1>
): void {
  const now = new Date().toISOString()
  updateChannels(form, update, (channel) =>
    channel.id === channelId ? { ...channel, ...patch, updatedAt: now } : channel
  )
}

function updateChannelProfile(
  form: AppSettingsV1,
  update: (partial: AppSettingsPatch) => void,
  channel: RemoteChannelV1,
  patch: Partial<RemoteChannelAgentProfileV1>
): void {
  const nextProfile = {
    ...channel.agentProfile,
    ...patch
  }
  updateChannel(form, update, channel.id, {
    label: nextProfile.name.trim() || channel.label,
    agentProfile: nextProfile
  })
}

function channelEffectiveWorkspace(form: AppSettingsV1, channel: RemoteChannelV1): string {
  return channel.workspaceRoot.trim() || form.remoteChannel.im.workspaceRoot.trim() || form.workspaceRoot
}

function discordChannelName(name: string): string {
  const trimmed = name.trim().replace(/^#/, '')
  return trimmed ? `#${trimmed}` : '#channel'
}

function discordCredential(channel: RemoteChannelV1): RemoteChannelDiscordPlatformCredentialV1 | null {
  return channel.platformCredential?.kind === 'discord' ? channel.platformCredential : null
}

function zulipCredential(channel: RemoteChannelV1): RemoteChannelZulipPlatformCredentialV1 | null {
  return channel.platformCredential?.kind === 'zulip' ? channel.platformCredential : null
}

export function hasDiscordGuardConflict(form: AppSettingsV1, channel: RemoteChannelV1): boolean {
  if (!channel.enabled) return false
  const credential = discordCredential(channel)
  if (!credential) return false
  const owner = (
    credential.guardOwnerInstallationId ||
    credential.installationId ||
    ''
  ).trim()
  const current = (form.installationId ?? '').trim()
  return Boolean(owner && current && owner !== current)
}

export function hasZulipGuardConflict(form: AppSettingsV1, channel: RemoteChannelV1): boolean {
  if (!channel.enabled) return false
  const credential = zulipCredential(channel)
  if (!credential) return false
  const owner = (
    credential.guardOwnerInstallationId ||
    credential.installationId ||
    ''
  ).trim()
  const current = (form.installationId ?? '').trim()
  return Boolean(owner && current && owner !== current)
}

export function discordGuardOwnerPatch(
  form: AppSettingsV1,
  channel: RemoteChannelV1,
  enabled: boolean
): Partial<RemoteChannelV1> {
  const credential = discordCredential(channel)
  if (!credential) return { enabled }
  const now = new Date().toISOString()
  const installationId = form.installationId ?? ''
  return {
    enabled,
    guardMode: enabled ? 'all_messages' : channel.guardMode,
    platformCredential: {
      ...credential,
      installationId: credential.installationId || installationId,
      ...(enabled
        ? {
            guardOwnerInstallationId: installationId,
            guardOwnerUpdatedAt: now
          }
        : {})
    }
  }
}

export function zulipGuardOwnerPatch(
  form: AppSettingsV1,
  channel: RemoteChannelV1,
  enabled: boolean
): Partial<RemoteChannelV1> {
  const credential = zulipCredential(channel)
  if (!credential) return { enabled }
  const now = new Date().toISOString()
  const installationId = form.installationId ?? ''
  return {
    enabled,
    guardMode: enabled ? 'all_messages' : channel.guardMode,
    platformCredential: {
      ...credential,
      installationId: credential.installationId || installationId,
      ...(enabled
        ? {
            guardOwnerInstallationId: installationId,
            guardOwnerUpdatedAt: now
          }
        : {})
    },
    updatedAt: now
  }
}

export function ConnectPhoneSettingsSection({ ctx }: { ctx: ConnectPhoneSettingsContext }): ReactElement {
  const {
    t,
    form,
    update,
    selectControlClass,
    pickConnectPhoneWorkspace,
    resetConnectPhoneWorkspaceToDefault,
    connectPhoneWorkspacePickerError
  } = ctx

  return (
    <>
      <SettingsCard title={t('connectPhoneRuntime')}>
        <SettingRow
          title={t('connectPhoneEnabled')}
          description={t('connectPhoneEnabledDesc')}
          control={
            <Toggle
              checked={form.remoteChannel.enabled}
              onChange={(value) => update({ remoteChannel: { enabled: value } })}
            />
          }
        />
        <SettingRow
          title={t('connectPhoneDefaultWorkspace')}
          description={t('connectPhoneDefaultWorkspaceDesc')}
          control={
            <div className="w-full min-w-[200px] md:max-w-xl">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className={textInputClass()}
                  value={form.remoteChannel.im.workspaceRoot}
                  onChange={(e) =>
                    update({
                      remoteChannel: {
                        im: {
                          workspaceRoot: e.target.value
                        }
                      }
                    })
                  }
                  placeholder={t('connectPhoneDefaultWorkspacePlaceholder', { path: form.workspaceRoot })}
                />
                <button
                  type="button"
                  onClick={resetConnectPhoneWorkspaceToDefault}
                  className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                >
                  {t('connectPhoneDefaultWorkspaceReset')}
                </button>
                <button
                  type="button"
                  onClick={() => void pickConnectPhoneWorkspace()}
                  className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                >
                  {t('browse')}
                </button>
              </div>
              {connectPhoneWorkspacePickerError ? (
                <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                  {connectPhoneWorkspacePickerError}
                </p>
              ) : null}
            </div>
          }
        />
      </SettingsCard>

      <SettingsCard title={t('connectPhoneManageAgents')} className="mt-6">
        {form.remoteChannel.channels.length === 0 ? (
          <div className="px-3 py-4 text-[13px] leading-6 text-ds-muted">
            {t('connectPhoneManageAgentsEmpty')}
          </div>
        ) : (
          form.remoteChannel.channels.map((channel) => {
            const name = channel.agentProfile.name.trim() || channel.label
            const discord = discordCredential(channel)
            const zulip = zulipCredential(channel)
            const discordConflict = hasDiscordGuardConflict(form, channel)
            const zulipConflict = hasZulipGuardConflict(form, channel)
            const guardConflict = discordConflict || zulipConflict
            return (
              <div key={channel.id} className="px-3 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-ds-ink">{name}</div>
                    <div className="mt-1 text-[12px] text-ds-faint">
                      {t('connectPhoneManageAgentMeta', {
                        provider: remoteChannelProviderDisplayLabel(channel.provider),
                        model: channel.model,
                        workspace: channelEffectiveWorkspace(form, channel)
                      })}
                    </div>
                    {discord ? (
                      <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                        {t('connectPhoneDiscordChannelMeta', {
                          server: discord.guildName || discord.guildId,
                          channel: discordChannelName(discord.channelName || discord.channelId)
                        })}
                      </div>
                    ) : null}
                    {zulip ? (
                      <div className="mt-1 text-[12px] leading-5 text-ds-faint">
                        {zulip.streamName || zulip.streamId}{zulip.topicName ? ` · #${zulip.topicName}` : ''}
                      </div>
                    ) : null}
                    {discord || zulip ? (
                      <div className="mt-1 text-[12px] leading-5 text-ds-muted">
                        {discord ? t('connectPhoneDiscordLocalOnlineGuard') : t('connectPhoneZulipLocalOnlineGuard')}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[12px] font-medium text-ds-muted">
                      {discordConflict
                        ? t('connectPhoneDiscordGuardConflictState')
                        : zulipConflict
                          ? t('connectPhoneDiscordGuardConflictState')
                        : channel.enabled
                          ? t('connectPhoneManageAgentEnabled')
                          : t('connectPhoneManageAgentDisabled')}
                    </span>
                    <Toggle
                      checked={channel.enabled}
                      onChange={(value) =>
                        updateChannel(
                          form,
                          update,
                          channel.id,
                          channel.provider === 'discord'
                            ? discordGuardOwnerPatch(form, channel, value)
                            : channel.provider === 'zulip'
                              ? zulipGuardOwnerPatch(form, channel, value)
                              : { enabled: value }
                        )}
                    />
                  </div>
                </div>

                {guardConflict ? (
                  <div className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12.5px] leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="font-semibold">
                      {discordConflict ? t('connectPhoneDiscordGuardConflictTitle') : t('connectPhoneZulipConflictTitle')}
                    </div>
                    <div className="mt-1">
                      {t('connectPhoneDiscordGuardConflictDesc', {
                        owner: discord?.guardOwnerInstallationId ||
                          discord?.installationId ||
                          zulip?.guardOwnerInstallationId ||
                          zulip?.installationId ||
                          ''
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateChannel(
                          form,
                          update,
                          channel.id,
                          discordConflict
                            ? discordGuardOwnerPatch(form, channel, true)
                            : zulipGuardOwnerPatch(form, channel, true)
                        )
                      }
                      className="mt-2 rounded-lg border border-amber-400/60 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100 dark:hover:bg-amber-300/15"
                    >
                      {t('connectPhoneDiscordGuardTakeover')}
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                      {t('connectPhoneManageAgentName')}
                    </span>
                    <input
                      className={textInputClass()}
                      value={channel.agentProfile.name}
                      onChange={(e) => updateChannelProfile(form, update, channel, { name: e.target.value })}
                      placeholder={t('connectPhoneManageAgentNamePlaceholder')}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                      {t('connectPhoneAgentModel')}
                    </span>
                    <select
                      className={selectControlClass}
                      value={channel.model}
                      onChange={(e) => updateChannel(form, update, channel.id, { model: e.target.value as RemoteChannelModel })}
                    >
                      {REMOTE_CHANNEL_MODEL_IDS.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-0 md:col-span-2">
                    <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                      {t('connectPhoneWorkspaceOverride')}
                    </span>
                    <input
                      className={textInputClass()}
                      value={channel.workspaceRoot}
                      onChange={(e) => updateChannel(form, update, channel.id, { workspaceRoot: e.target.value })}
                      placeholder={t('connectPhoneWorkspaceInherit', {
                        path: form.remoteChannel.im.workspaceRoot.trim() || form.workspaceRoot
                      })}
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-3">
                  {profileFields.map((field) => (
                    <label key={field.key} className="block min-w-0">
                      <span className="mb-1.5 block text-[12px] font-semibold text-ds-muted">
                        {t(field.labelKey)}
                      </span>
                      <textarea
                        className={textInputClass('resize-y leading-5')}
                        rows={field.rows}
                        value={channel.agentProfile[field.key]}
                        onChange={(e) => updateChannelProfile(form, update, channel, { [field.key]: e.target.value })}
                        placeholder={t(field.placeholderKey)}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </SettingsCard>
    </>
  )
}
