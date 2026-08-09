import type { ReactElement } from 'react'
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
  DEFAULT_COMPUTER_USE_BACKEND,
  getClaudeRuntimeSettings,
  getCodexRuntimeSettings
} from '@shared/app-settings'
import type { SkillRootId } from '../lib/skill-root-preference'
import { FolderOpen, Settings } from 'lucide-react'
import {
  InlineNoticeView,
  SectionJumpButton,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'
import { installedRendererContributions } from '../domain-modules/installed-renderer-contributions'

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
        {installedRendererContributions.settingsSections
          .filter(({ value }) => value.section === 'agents.permissions')
          .map(({ id, value }) => (
            <div key={id}>{value.render({ section: value.section, host: ctx })}</div>
          ))}
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
