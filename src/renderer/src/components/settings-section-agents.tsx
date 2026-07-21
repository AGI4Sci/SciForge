import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type {
  AgentRuntimeId,
  AppSettingsPatch,
  ApprovalPolicy,
  ClaudeRuntimeSettingsPatchV1,
  CodexRuntimeSettingsPatchV1,
  SandboxMode
} from '@shared/app-settings'
import {
  claudeSettingsPatch,
  codexSettingsPatch,
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultComputerUseSettings,
  DEFAULT_COMPUTER_USE_BACKEND,
  getClaudeRuntimeSettings,
  getCodexRuntimeSettings,
  getComputerUseSettings
} from '@shared/app-settings'
import type {
  ComputerUsePermissionKind,
  ComputerUsePermissionState,
  ComputerUseStatusView
} from '@shared/sciforge-api'
import type { SkillRootId } from '../lib/skill-root-preference'
import { FolderOpen, RefreshCw, Settings } from 'lucide-react'
import {
  InlineNoticeView,
  SectionJumpButton,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'

type ComputerUseBackendSafetyStatus = {
  inputIsolation?: string
  affectsUserInput?: boolean
  requiresHostFocus?: boolean
  usesHostClipboard?: boolean
}

type ComputerUseBackendSafetyChip = {
  labelKey: string
  valueKey: string
}

function permissionBadgeClass(state: ComputerUsePermissionState): string {
  if (state === 'granted')
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (state === 'denied')
    return 'border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-200'
  return 'border-ds-border-muted bg-ds-card text-ds-faint'
}

function computerUseStatusPill(available: boolean | undefined): string {
  if (available === true)
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (available === false)
    return 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
  return 'border-ds-border-muted bg-ds-card text-ds-faint'
}

function computerUseInputIsolationValueKey(
  value: string | undefined
): string | null {
  if (value === 'agent-isolated') return 'computerUseSafetyInputAgentIsolated'
  if (value === 'host-approved') return 'computerUseSafetyInputHostApproved'
  if (value === 'host-global') return 'computerUseSafetyInputHostGlobal'
  if (value === 'host-app-scoped') return 'computerUseSafetyInputHostAppScoped'
  return value ? 'computerUseSafetyInputUnknown' : null
}

function computerUseBooleanSafetyValueKey(
  value: boolean | undefined,
  trueKey: string,
  falseKey: string
): string | null {
  if (typeof value !== 'boolean') return null
  return value ? trueKey : falseKey
}

function computerUseBackendSafetyChips(
  status: ComputerUseBackendSafetyStatus | null | undefined
): ComputerUseBackendSafetyChip[] {
  if (!status) return []
  const chips: ComputerUseBackendSafetyChip[] = []
  const inputIsolationKey = computerUseInputIsolationValueKey(
    status.inputIsolation
  )
  if (inputIsolationKey) {
    chips.push({
      labelKey: 'computerUseSafetyInputSurface',
      valueKey: inputIsolationKey
    })
  }
  const affectsInputKey = computerUseBooleanSafetyValueKey(
    status.affectsUserInput,
    'computerUseSafetyUserInputHost',
    'computerUseSafetyUserInputIsolated'
  )
  if (affectsInputKey) {
    chips.push({
      labelKey: 'computerUseSafetyUserInput',
      valueKey: affectsInputKey
    })
  }
  const focusKey = computerUseBooleanSafetyValueKey(
    status.requiresHostFocus,
    'computerUseSafetyHostFocusRequired',
    'computerUseSafetyHostFocusNotRequired'
  )
  if (focusKey) {
    chips.push({ labelKey: 'computerUseSafetyHostFocus', valueKey: focusKey })
  }
  const clipboardKey = computerUseBooleanSafetyValueKey(
    status.usesHostClipboard,
    'computerUseSafetyClipboardUsed',
    'computerUseSafetyClipboardNotUsed'
  )
  if (clipboardKey) {
    chips.push({
      labelKey: 'computerUseSafetyClipboard',
      valueKey: clipboardKey
    })
  }
  return chips
}

export function codexRuntimeSettingsPatch(
  codex: CodexRuntimeSettingsPatchV1
): AppSettingsPatch {
  return { agents: codexSettingsPatch(codex) }
}

export function claudeRuntimeSettingsPatch(
  claude: ClaudeRuntimeSettingsPatchV1
): AppSettingsPatch {
  return { agents: claudeSettingsPatch(claude) }
}

export function AgentsSettingsSection({
  ctx
}: {
  ctx: Record<string, any>
}): ReactElement {
  const {
    t,
    tCommon,
    form,
    codex: codexFromContext,
    claude: claudeFromContext,
    update,
    updateCodex,
    updateClaude,
    selectControlClass,
    scrollToAgentSection,
    agentsSectionRef,
    skillSectionRef,
    permissionsSectionRef,
    selectedSkillRoot,
    skillRootOptions,
    skillRootId,
    setSkillRootId,
    skillNotice,
    openSkillRoot,
    openPlugins,
    splitSettingsList,
    listSettingsText
  } = ctx
  const codex =
    codexFromContext ??
    (form ? getCodexRuntimeSettings(form) : defaultCodexRuntimeSettings())
  const claude =
    claudeFromContext ??
    (form ? getClaudeRuntimeSettings(form) : defaultClaudeRuntimeSettings())
  const updateCodexRuntime = (patch: CodexRuntimeSettingsPatchV1): void => {
    if (typeof updateCodex === 'function') {
      updateCodex(patch)
      return
    }
    update(codexRuntimeSettingsPatch(patch))
  }
  const updateClaudeRuntime = (patch: ClaudeRuntimeSettingsPatchV1): void => {
    if (typeof updateClaude === 'function') {
      updateClaude(patch)
      return
    }
    update(claudeRuntimeSettingsPatch(patch))
  }
  const textInputClass =
    'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
  const textareaClass =
    'min-h-24 w-full min-w-0 resize-y rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12.5px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2">
        <SectionJumpButton
          label={t('agentsQuickBase')}
          onClick={() => scrollToAgentSection('agents')}
        />
        <SectionJumpButton
          label={t('agentsQuickSkill')}
          onClick={() => scrollToAgentSection('skill')}
        />
        <SectionJumpButton
          label={t('agentsQuickPermissions')}
          onClick={() => scrollToAgentSection('permissions')}
        />
      </div>

      <div ref={agentsSectionRef}>
        <SettingsCard title={t('agents')}>
          <SettingRow
            title={t('codexRuntime')}
            description={t('codexRuntimeDesc')}
            wideControl
            control={
              <div className="grid gap-4 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
                <InlineNoticeView
                  notice={{ tone: 'info', message: t('codexManagedHomeDesc') }}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('codexCommand')}
                    <span className="font-normal leading-5 text-ds-faint">
                      {t('codexCommandDesc')}
                    </span>
                    <input
                      className={textInputClass}
                      value={codex.command}
                      placeholder={t('codexCommandPlaceholder')}
                      onChange={(event) =>
                        updateCodexRuntime({ command: event.target.value })
                      }
                    />
                  </label>
                  <RuntimePermissionFields
                    t={t}
                    selectControlClass={selectControlClass}
                    approvalPolicy={codex.approvalPolicy}
                    sandboxMode={codex.sandboxMode}
                    approvalDescriptionKey="approvalPolicyDesc"
                    sandboxDescriptionKey="sandboxModeDesc"
                    onChange={(patch) => updateCodexRuntime(patch)}
                  />
                </div>
                <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                  {t('codexExtraArgs')}
                  <span className="font-normal leading-5 text-ds-faint">
                    {t('codexExtraArgsDesc')}
                  </span>
                  <textarea
                    className={textareaClass}
                    value={listSettingsText(codex.extraArgs)}
                    placeholder={t('codexExtraArgsPlaceholder')}
                    onChange={(event) =>
                      updateCodexRuntime({
                        extraArgs: splitSettingsList(event.target.value)
                      })
                    }
                  />
                </label>
              </div>
            }
          />
          <SettingRow
            title={t('claudeRuntime')}
            description={t('claudeRuntimeDesc')}
            wideControl
            control={
              <div className="grid gap-4 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
                <InlineNoticeView
                  notice={{
                    tone: 'info',
                    message: t('claudeManagedConfigDesc')
                  }}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('claudeCommand')}
                    <span className="font-normal leading-5 text-ds-faint">
                      {t('claudeCommandDesc')}
                    </span>
                    <input
                      className={textInputClass}
                      value={claude.command}
                      placeholder={t('claudeCommandPlaceholder')}
                      onChange={(event) =>
                        updateClaudeRuntime({ command: event.target.value })
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('claudeModel')}
                    <span className="font-normal leading-5 text-ds-faint">
                      {t('claudeModelDesc')}
                    </span>
                    <input
                      className={textInputClass}
                      value={claude.model}
                      placeholder={t('runtimeModelAutoPlaceholder')}
                      onChange={(event) =>
                        updateClaudeRuntime({ model: event.target.value })
                      }
                    />
                  </label>
                  <RuntimePermissionFields
                    t={t}
                    selectControlClass={selectControlClass}
                    approvalPolicy={claude.approvalPolicy}
                    sandboxMode={claude.sandboxMode}
                    approvalDescriptionKey="claudeApprovalPolicyDesc"
                    sandboxDescriptionKey="claudeSandboxModeDesc"
                    allowAutoApproval
                    onChange={(patch) => updateClaudeRuntime(patch)}
                  />
                </div>
                <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                  {t('claudeExtraArgs')}
                  <span className="font-normal leading-5 text-ds-faint">
                    {t('claudeExtraArgsDesc')}
                  </span>
                  <textarea
                    className={textareaClass}
                    value={listSettingsText(claude.extraArgs)}
                    placeholder={t('claudeExtraArgsPlaceholder')}
                    onChange={(event) =>
                      updateClaudeRuntime({
                        extraArgs: splitSettingsList(event.target.value)
                      })
                    }
                  />
                </label>
              </div>
            }
          />
          <SettingRow
            title={t('codePromptPrefix')}
            description={t('codePromptPrefixDesc')}
            wideControl
            control={
              <textarea
                value={form?.codePromptPrefix ?? ''}
                onChange={(event) =>
                  update({ codePromptPrefix: event.target.value })
                }
                placeholder={t('codePromptPrefixPlaceholder')}
                className="min-h-[110px] w-full resize-y rounded-xl border border-ds-border bg-ds-main/60 px-3 py-3 text-[14px] leading-6 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
              />
            }
          />
        </SettingsCard>
      </div>

      <div ref={skillSectionRef} className="mt-6">
        <SettingsCard title={t('skill')}>
          <SettingRow
            title={t('skillsLocation')}
            description={t('skillsLocationDesc')}
            control={
              <select
                className={selectControlClass}
                value={selectedSkillRoot?.id ?? skillRootId}
                onChange={(event) =>
                  setSkillRootId(event.target.value as SkillRootId)
                }
              >
                {skillRootOptions.map((option: any) => (
                  <option
                    key={option.id}
                    value={option.id}
                    disabled={!option.available}
                  >
                    {option.available
                      ? option.label
                      : `${option.label} · ${tCommon('pluginSkillRootNeedsWorkspace')}`}
                  </option>
                ))}
              </select>
            }
          />
          <SettingRow
            title={t('skillsPath')}
            description={t('skillsPathDesc')}
            control={
              <div className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
                <code className="block break-all rounded-lg bg-ds-main/70 px-2 py-1 font-mono text-[12px] text-ds-ink">
                  {selectedSkillRoot?.path || t('skillsRootUnavailable')}
                </code>
              </div>
            }
          />
          <SettingRow
            title={t('skillsScanDirs')}
            description={t('skillsScanDirsDesc')}
            wideControl
            control={
              <textarea
                value={listSettingsText(form.remoteChannel.skills.extraDirs)}
                onChange={(event) =>
                  update({
                    remoteChannel: {
                      skills: {
                        extraDirs: splitSettingsList(event.target.value)
                      }
                    }
                  })
                }
                spellCheck={false}
                placeholder={selectedSkillRoot?.path || '~/.agents/skills'}
                className="min-h-24 w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
              />
            }
          />
          <SettingRow
            title={t('skillsActions')}
            description={t('skillsActionsDesc')}
            wideControl
            control={
              <div className="flex w-full flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void openSkillRoot()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                  >
                    <FolderOpen className="h-4 w-4" />
                    {t('skillsOpenRoot')}
                  </button>
                  <button
                    type="button"
                    onClick={() => openPlugins()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
                  >
                    <Settings className="h-4 w-4" />
                    {t('skillsOpenPlugins')}
                  </button>
                </div>
                {skillNotice ? <InlineNoticeView notice={skillNotice} /> : null}
              </div>
            }
          />
        </SettingsCard>
      </div>

      <div ref={permissionsSectionRef} className="mt-6">
        <ComputerUseSettingsCard ctx={ctx} />
      </div>
    </>
  )
}

function RuntimePermissionFields({
  t,
  selectControlClass,
  approvalPolicy,
  sandboxMode,
  approvalDescriptionKey,
  sandboxDescriptionKey,
  allowAutoApproval = false,
  onChange
}: {
  t: (key: string) => string
  selectControlClass: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalDescriptionKey: string
  sandboxDescriptionKey: string
  allowAutoApproval?: boolean
  onChange: (patch: {
    approvalPolicy?: ApprovalPolicy
    sandboxMode?: SandboxMode
  }) => void
}): ReactElement {
  return (
    <>
      <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
        {t('approvalPolicy')}
        <span className="font-normal leading-5 text-ds-faint">
          {t(
            sandboxMode === 'danger-full-access'
              ? 'approvalFullAccessDesc'
              : approvalDescriptionKey
          )}
        </span>
        <select
          className={`${selectControlClass} disabled:cursor-not-allowed disabled:opacity-60`}
          value={approvalPolicy}
          disabled={sandboxMode === 'danger-full-access'}
          onChange={(event) =>
            onChange({ approvalPolicy: event.target.value as ApprovalPolicy })
          }
        >
          <option value="on-request">{t('approvalOnRequest')}</option>
          <option value="untrusted">{t('approvalUntrusted')}</option>
          <option value="never">{t('approvalNever')}</option>
          {allowAutoApproval ? (
            <option value="auto">{t('approvalAuto')}</option>
          ) : null}
        </select>
      </label>
      <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
        {t('sandboxMode')}
        <span className="font-normal leading-5 text-ds-faint">
          {t(sandboxDescriptionKey)}
        </span>
        <select
          className={selectControlClass}
          value={sandboxMode}
          onChange={(event) => {
            const nextSandboxMode = event.target.value as SandboxMode
            onChange({
              sandboxMode: nextSandboxMode,
              ...(nextSandboxMode === 'danger-full-access'
                ? { approvalPolicy: allowAutoApproval ? 'auto' : 'never' }
                : {})
            })
          }}
        >
          <option value="workspace-write">{t('sandboxWorkspaceWrite')}</option>
          <option value="read-only">{t('sandboxReadOnly')}</option>
          <option value="danger-full-access">{t('sandboxFullAccess')}</option>
        </select>
      </label>
    </>
  )
}

function ComputerUseSettingsCard({
  ctx
}: {
  ctx: Record<string, any>
}): ReactElement {
  const { t, form, update } = ctx
  const initialStatus = ctx.computerUseStatus as
    ComputerUseStatusView | null | undefined
  const [status, setStatus] = useState<ComputerUseStatusView | null>(
    initialStatus ?? null
  )
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{
    tone: 'error' | 'info' | 'success'
    message: string
  } | null>(null)
  const computerUse = form
    ? getComputerUseSettings(form)
    : defaultComputerUseSettings()
  const backend = status?.runtime.backend
  const backendSafety = backend as
    (typeof backend & ComputerUseBackendSafetyStatus) | null | undefined
  const backendSafetyChips = backend
    ? computerUseBackendSafetyChips(backendSafety)
    : []
  const activeLeases = status?.runtime.activeLeases ?? []
  const recentRejections = status?.runtime.recentRejections ?? []
  const permissions = status?.permissions
  const platform =
    permissions?.platform ??
    (typeof window !== 'undefined' ? window.sciforge?.platform : '')
  const needsPermission = permissions?.needsPermission ?? platform === 'darwin'
  const canRequestPermission =
    typeof window !== 'undefined' &&
    typeof window.sciforge?.requestComputerUsePermission === 'function'
  const updateRuntimeEnabled = (
    runtimeId: AgentRuntimeId,
    enabled: boolean
  ): void => {
    update({
      computerUse: {
        ...computerUse,
        runtimeEnabled: { ...computerUse.runtimeEnabled, [runtimeId]: enabled }
      }
    })
  }

  const refresh = async (): Promise<void> => {
    if (
      typeof window === 'undefined' ||
      typeof window.sciforge?.getComputerUseStatus !== 'function'
    )
      return
    setBusy(true)
    setNotice(null)
    try {
      setStatus(await window.sciforge.getComputerUseStatus())
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const requestPermission = async (
    kind: ComputerUsePermissionKind
  ): Promise<void> => {
    if (!canRequestPermission) return
    setBusy(true)
    setNotice(null)
    try {
      const nextPermissions =
        await window.sciforge.requestComputerUsePermission(kind)
      setStatus((current) =>
        current
          ? { ...current, permissions: nextPermissions }
          : {
              settings: computerUse,
              permissions: nextPermissions,
              runtime: {
                updatedAt: new Date(0).toISOString(),
                servers: [],
                activeLeases: [],
                recentRejections: [],
                backend: null
              }
            }
      )
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
    }
  }

  const permissionBadge = (
    label: string,
    state: ComputerUsePermissionState
  ): ReactNode => (
    <span
      className={`rounded-lg border px-2 py-0.5 text-[12px] font-medium ${permissionBadgeClass(state)}`}
    >
      {label}: {t(`computerUsePermission_${state}`)}
    </span>
  )

  return (
    <SettingsCard title={t('computerUseTitle')}>
      <div className="px-3 py-4">
        <InlineNoticeView
          notice={{ tone: 'info', message: t('computerUseHint') }}
        />
      </div>
      <SettingRow
        title={t('computerUseEnable')}
        description={t('computerUseEnableDesc')}
        control={
          <Toggle
            checked={computerUse.enabled}
            onChange={(enabled) =>
              update({ computerUse: { ...computerUse, enabled } })
            }
          />
        }
      />
      <SettingRow
        title={t('computerUseRuntimeAccess')}
        description={t('computerUseRuntimeAccessDesc')}
        wideControl
        control={
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['codex', t('agentRuntimeCodex')],
                ['claude', t('agentRuntimeClaude')]
              ] as const
            ).map(([runtimeId, label]) => (
              <label
                key={runtimeId}
                className="flex items-center justify-between gap-3 rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2 text-[12.5px] font-medium text-ds-ink"
              >
                <span>{label}</span>
                <Toggle
                  checked={computerUse.runtimeEnabled[runtimeId]}
                  disabled={!computerUse.enabled}
                  onChange={(enabled) =>
                    updateRuntimeEnabled(runtimeId, enabled)
                  }
                />
              </label>
            ))}
          </div>
        }
      />
      <SettingRow
        title={t('computerUseBackend')}
        description={t('computerUseBackendDesc')}
        wideControl
        control={
          <div className="grid gap-3">
            <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-3">
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                {t('computerUseConfiguredBackend')}:{' '}
                <span className="font-mono text-ds-ink">
                  {DEFAULT_COMPUTER_USE_BACKEND}
                </span>
              </div>
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                {t('computerUseRuntimeBackend')}:{' '}
                <span className="font-mono text-ds-ink">
                  {backend?.backend ?? DEFAULT_COMPUTER_USE_BACKEND}
                </span>
              </div>
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                {t('computerUsePlatform')}:{' '}
                <span className="font-mono text-ds-ink">
                  {backend?.platform ?? platform ?? 'unknown'}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${computerUseStatusPill(backend?.available)}`}
              >
                {backend?.available
                  ? t('computerUseBackendAvailable')
                  : backend
                    ? t('computerUseBackendUnavailable')
                    : t('computerUseBackendUnknown')}
              </span>
              {backendSafetyChips.map((chip) => (
                <span
                  key={chip.labelKey}
                  className="inline-flex max-w-full items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-main/40 px-2 py-1 text-[11px] font-medium text-ds-muted"
                >
                  <span className="text-ds-faint">{t(chip.labelKey)}</span>
                  <span className="text-ds-ink">{t(chip.valueKey)}</span>
                </span>
              ))}
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`}
                  strokeWidth={1.75}
                />
                {t('computerUseRefresh')}
              </button>
              {notice ? <InlineNoticeView notice={notice} /> : null}
            </div>
            {backend?.reason ? (
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2 text-[12.5px] leading-5 text-ds-muted">
                {backend.reason}
              </div>
            ) : null}
            {!computerUse.enabled ? (
              <InlineNoticeView
                notice={{ tone: 'info', message: t('computerUseDisabledHint') }}
              />
            ) : null}
          </div>
        }
      />
      {needsPermission ? (
        <SettingRow
          title={t('computerUsePermissions')}
          description={t('computerUsePermissionsDesc')}
          wideControl
          control={
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {permissions?.accessibilityNeedsRestart ? (
                  <span className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[12px] font-medium text-amber-700 dark:text-amber-200">
                    {t('computerUseAccessibility')}:{' '}
                    {t('computerUsePermissionNeedsRestart')}
                  </span>
                ) : (
                  permissionBadge(
                    t('computerUseAccessibility'),
                    permissions?.accessibility ?? 'unknown'
                  )
                )}
                {permissionBadge(
                  t('computerUseScreenRecording'),
                  permissions?.screenRecording ?? 'unknown'
                )}
              </div>
              {permissions?.accessibilityNeedsRestart ? (
                <p className="text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                  {t('computerUseRestartHint')}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={!canRequestPermission || busy}
                  onClick={() => void requestPermission('accessibility')}
                >
                  {t('computerUseGrantAccessibility')}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={!canRequestPermission || busy}
                  onClick={() => void requestPermission('screenRecording')}
                >
                  {t('computerUseGrantScreenRecording')}
                </button>
              </div>
            </div>
          }
        />
      ) : null}
      <SettingRow
        title={t('computerUseActiveLeases')}
        description={t('computerUseActiveLeasesDesc')}
        wideControl
        control={
          <div className="grid gap-2">
            {activeLeases.length === 0 ? (
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                {t('computerUseNoActiveLeases')}
              </div>
            ) : (
              activeLeases.slice(0, 6).map((lease) => (
                <div
                  key={lease.leaseId}
                  className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2"
                >
                  <div className="truncate text-[13px] font-semibold text-ds-ink">
                    {lease.targetId}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
                    <span className="font-mono">{lease.agentId}</span>
                    <span className="font-mono">{lease.threadId}</span>
                    {lease.turnId ? (
                      <span className="font-mono">{lease.turnId}</span>
                    ) : null}
                    <span className="font-mono">
                      {lease.computerUseSessionId}
                    </span>
                    <span>{new Date(lease.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        }
      />
      <SettingRow
        title={t('computerUseRecentRejections')}
        description={t('computerUseRecentRejectionsDesc')}
        wideControl
        control={
          <div className="grid gap-2">
            {recentRejections.length === 0 ? (
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                {t('computerUseNoRecentRejections')}
              </div>
            ) : (
              recentRejections
                .slice(-6)
                .reverse()
                .map((rejection, index) => (
                  <div
                    key={`${rejection.code}-${rejection.targetId ?? 'target'}-${index}`}
                    className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg border border-amber-300/60 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                        {rejection.code}
                      </span>
                      {rejection.targetId ? (
                        <span className="font-mono text-[11px] text-ds-faint">
                          {rejection.targetId}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[12.5px] leading-5 text-ds-muted">
                      {rejection.message}
                    </div>
                  </div>
                ))
            )}
          </div>
        }
      />
    </SettingsCard>
  )
}
