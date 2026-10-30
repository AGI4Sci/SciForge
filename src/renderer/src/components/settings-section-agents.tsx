import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type {
  AgentRuntimeId,
  AppSettingsPatch,
  ApprovalPolicy,
  ClaudeRuntimeSettingsPatchV1,
  CodexRuntimeSettingsPatchV1,
  DshRuntimeSettingsPatchV1,
  SandboxMode
} from '@shared/app-settings'
import {
  claudeSettingsPatch,
  codexSettingsPatch,
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultComputerUseSettings,
  defaultDshRuntimeSettings,
  DEFAULT_COMPUTER_USE_BACKEND,
  getClaudeRuntimeSettings,
  getCodexRuntimeSettings,
  getActiveAgentRuntime,
  getDshRuntimeSettings,
  getPiRuntimeSettings,
  getComputerUseSettings,
  dshSettingsPatch,
  permissionLevelFromRuntime,
  runtimePatchForPermissionLevel,
  type AgentPermissionLevel
} from '@shared/app-settings'
import type {
  AgentRuntimeDiscoveryResult,
  AgentRuntimeModelCatalog,
  AgentRuntimeModelDescriptor,
  AgentRuntimeModelReasoningEffort,
  AgentRuntimeModelServiceTier
} from '@shared/agent-runtime-contract'
import type {
  ComputerUsePermissionKind,
  ComputerUsePermissionState,
  ComputerUseStatusView
} from '@shared/sciforge-api'
import type { SkillRootId } from '../lib/skill-root-preference'
import { FolderOpen, RefreshCw, Settings } from 'lucide-react'
import { runtimeErrorTranslationKey } from '../lib/format-runtime-error'
import { getProvider } from '../agent/registry'
import { RuntimeSettingsCard } from './runtime-settings-card'
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

export function dshRuntimeSettingsPatch(
  dsh: DshRuntimeSettingsPatchV1
): AppSettingsPatch {
  return { agents: dshSettingsPatch(dsh) }
}

// DSH model catalog reported by the ACP session/new handshake. Kept as static
// options until the renderer consumes the live catalog end to end.
export const DSH_MODEL_OPTIONS = ['v4-flash', 'v4-pro'] as const
export const DSH_REASONING_EFFORT_OPTIONS = ['off', 'low', 'high', 'max'] as const

export async function chooseCodexRuntimeExecutable(
  pickFile: () => Promise<{ canceled: boolean; path: string | null }>,
  update: (patch: CodexRuntimeSettingsPatchV1) => void,
  normalize: (path: string) => string = (path) => path
): Promise<string | null> {
  const selection = await pickFile()
  if (selection.canceled || !selection.path) return null
  const selectedPath = normalize(selection.path)
  update({ command: selectedPath })
  return selectedPath
}

export function probeCodexRuntimeCandidate(
  probe: (runtimeId?: AgentRuntimeId, command?: string) => Promise<AgentRuntimeDiscoveryResult>,
  command: string
): Promise<AgentRuntimeDiscoveryResult> {
  return probe('codex', command)
}

export function probeDshRuntimeCandidate(
  probe: (runtimeId?: AgentRuntimeId, command?: string) => Promise<AgentRuntimeDiscoveryResult>,
  command: string
): Promise<AgentRuntimeDiscoveryResult> {
  return probe('dsh', command)
}

async function runLatestRuntimeProbe<T>(
  probe: (runtimeId?: AgentRuntimeId, command?: string) => Promise<T>,
  runtimeId: AgentRuntimeId,
  command: string,
  sequence: { current: number }
): Promise<{ status: 'current'; result: T } | { status: 'stale' }> {
  const requestSeq = ++sequence.current
  try {
    const result = await probe(runtimeId, command)
    return requestSeq === sequence.current
      ? { status: 'current', result }
      : { status: 'stale' }
  } catch (error) {
    if (requestSeq !== sequence.current) return { status: 'stale' }
    throw error
  }
}

export function runLatestCodexRuntimeProbe<T>(
  probe: (runtimeId?: AgentRuntimeId, command?: string) => Promise<T>,
  command: string,
  sequence: { current: number }
): Promise<{ status: 'current'; result: T } | { status: 'stale' }> {
  return runLatestRuntimeProbe(probe, 'codex', command, sequence)
}

export function runLatestDshRuntimeProbe<T>(
  probe: (runtimeId?: AgentRuntimeId, command?: string) => Promise<T>,
  command: string,
  sequence: { current: number }
): Promise<{ status: 'current'; result: T } | { status: 'stale' }> {
  return runLatestRuntimeProbe(probe, 'dsh', command, sequence)
}

export async function chooseDshRuntimeExecutable(
  pickFile: () => Promise<{ canceled: boolean; path: string | null }>,
  update: (patch: DshRuntimeSettingsPatchV1) => void,
  normalize: (path: string) => string = (path) => path
): Promise<string | null> {
  const selection = await pickFile()
  if (selection.canceled || !selection.path) return null
  const selectedPath = normalize(selection.path)
  update({ executablePath: selectedPath })
  return selectedPath
}

export function selectedCodexCatalogModel(
  modelId: string,
  catalog: AgentRuntimeModelCatalog | null | undefined
): AgentRuntimeModelDescriptor | null {
  if (!catalog?.available) return null
  const normalized = modelId.trim()
  if (normalized) return catalog.models.find((model) => model.id === normalized) ?? null
  return catalog.models.find((model) => model.id === catalog.defaultModelId) ??
    catalog.models.find((model) => model.isDefault) ??
    null
}

export function discoveredReasoningEfforts(
  models: readonly AgentRuntimeModelDescriptor[]
): AgentRuntimeModelReasoningEffort[] {
  const options = new Map<string, AgentRuntimeModelReasoningEffort>()
  for (const model of models) {
    for (const effort of model.reasoningEfforts) {
      if (!options.has(effort.id)) options.set(effort.id, effort)
    }
  }
  return [...options.values()]
}

export function discoveredServiceTiers(
  models: readonly AgentRuntimeModelDescriptor[]
): AgentRuntimeModelServiceTier[] {
  const options = new Map<string, AgentRuntimeModelServiceTier>()
  for (const model of models) {
    for (const tier of model.serviceTiers) {
      if (!options.has(tier.id)) options.set(tier.id, tier)
    }
  }
  return [...options.values()]
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
    dsh: dshFromContext,
    update,
    updateCodex,
    updateClaude,
    updateDsh,
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
  const dsh =
    dshFromContext ??
    (form ? getDshRuntimeSettings(form) : defaultDshRuntimeSettings())
  const injectedCodexDiscovery = ctx.codexDiscovery as AgentRuntimeDiscoveryResult | undefined
  const injectedCodexModelCatalog = ctx.codexModelCatalog as AgentRuntimeModelCatalog | undefined
  const [codexDiscovery, setCodexDiscovery] = useState<AgentRuntimeDiscoveryResult | null>(
    injectedCodexDiscovery ?? null
  )
  const [codexDiscoveryChecking, setCodexDiscoveryChecking] = useState(false)
  const [codexModelCatalog, setCodexModelCatalog] = useState<AgentRuntimeModelCatalog | null>(
    injectedCodexModelCatalog ?? null
  )
  const codexDiscoveryRequestSeq = useRef(0)
  const runtimeProvider = getProvider()
  const codexRecoveryOptions = runtimeProvider.getRecoveryOptions('codex')
  const dshRecoveryOptions = runtimeProvider.getRecoveryOptions('dsh')
  const updateCodexRuntime = (patch: CodexRuntimeSettingsPatchV1): void => {
    if (typeof updateCodex === 'function') {
      updateCodex(patch)
      return
    }
    update(codexRuntimeSettingsPatch(patch))
  }
  const detectCodex = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined') return
    setCodexDiscoveryChecking(true)
    try {
      const outcome = await runLatestCodexRuntimeProbe(
        (runtimeId, command) => runtimeProvider.probe(runtimeId, command),
        codex.command,
        codexDiscoveryRequestSeq
      )
      if (outcome.status === 'stale') return
      setCodexDiscovery(outcome.result)
      if (outcome.result.available && runtimeProvider.getRuntimeCapabilities) {
        const capabilities = await runtimeProvider.getRuntimeCapabilities('codex')
        setCodexModelCatalog(capabilities.model.catalog ?? null)
      }
      setCodexDiscoveryChecking(false)
    } catch {
      setCodexDiscovery({
        runtimeId: 'codex',
        available: false,
        executablePath: null,
        source: null,
        version: null,
        protocol: null,
        failure: {
          code: 'runtime_probe_failed'
        }
      })
      setCodexModelCatalog({
        available: false,
        complete: false,
        models: [],
        reason: 'runtime_model_catalog_unavailable'
      })
      setCodexDiscoveryChecking(false)
    }
  }, [codex.command, runtimeProvider])
  useEffect(() => {
    if (injectedCodexDiscovery) {
      codexDiscoveryRequestSeq.current += 1
      setCodexDiscovery(injectedCodexDiscovery)
      if (injectedCodexModelCatalog) setCodexModelCatalog(injectedCodexModelCatalog)
      setCodexDiscoveryChecking(false)
      return
    }
    void detectCodex()
  }, [detectCodex, injectedCodexDiscovery, injectedCodexModelCatalog])
  const updateClaudeRuntime = (patch: ClaudeRuntimeSettingsPatchV1): void => {
    if (typeof updateClaude === 'function') {
      updateClaude(patch)
      return
    }
    update(claudeRuntimeSettingsPatch(patch))
  }
  const injectedDshDiscovery = ctx.dshDiscovery as AgentRuntimeDiscoveryResult | undefined
  const [dshDiscovery, setDshDiscovery] = useState<AgentRuntimeDiscoveryResult | null>(
    injectedDshDiscovery ?? null
  )
  const [dshDiscoveryChecking, setDshDiscoveryChecking] = useState(false)
  const dshDiscoveryRequestSeq = useRef(0)
  const updateDshRuntime = (patch: DshRuntimeSettingsPatchV1): void => {
    if (typeof updateDsh === 'function') {
      updateDsh(patch)
      return
    }
    update(dshRuntimeSettingsPatch(patch))
  }
  const detectDsh = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined') return
    setDshDiscoveryChecking(true)
    try {
      const outcome = await runLatestDshRuntimeProbe(
        (runtimeId, command) => runtimeProvider.probe(runtimeId, command),
        dsh.executablePath,
        dshDiscoveryRequestSeq
      )
      if (outcome.status === 'stale') return
      setDshDiscovery(outcome.result)
      setDshDiscoveryChecking(false)
    } catch {
      setDshDiscovery({
        runtimeId: 'dsh',
        available: false,
        executablePath: null,
        source: null,
        version: null,
        protocol: null,
        failure: {
          code: 'runtime_probe_failed'
        }
      })
      setDshDiscoveryChecking(false)
    }
  }, [dsh.executablePath, runtimeProvider])
  useEffect(() => {
    if (injectedDshDiscovery) {
      dshDiscoveryRequestSeq.current += 1
      setDshDiscovery(injectedDshDiscovery)
      setDshDiscoveryChecking(false)
      return
    }
    void detectDsh()
  }, [detectDsh, injectedDshDiscovery])
  const textInputClass =
    'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
  const textareaClass =
    'min-h-24 w-full min-w-0 resize-y rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12.5px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
  const catalogModels = codexModelCatalog?.models ?? []
  const selectedCatalogModel = selectedCodexCatalogModel(codex.model, codexModelCatalog)
  const reasoningOptions = discoveredReasoningEfforts(catalogModels)
  const serviceTierOptions = discoveredServiceTiers(catalogModels)
  const selectedReasoningIds = new Set(selectedCatalogModel?.reasoningEfforts.map(({ id }) => id) ?? [])
  const selectedServiceTierIds = new Set(
    selectedCatalogModel?.serviceTiers.map(({ id }) => id) ?? []
  )

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
          <RuntimeSettingsCard runtimeId="dsh"
            command={form ? getDshRuntimeSettings(form).command : 'dsh'}
            selected={form ? getActiveAgentRuntime(form) === 'dsh' : false}
            onSelect={() => update({ activeAgentRuntime: 'dsh' })}
            onCommand={(command) => update({ agents: { dsh: { command } } })}
            t={t} tCommon={tCommon}
          />
          <RuntimeSettingsCard runtimeId="pi"
            command={form ? getPiRuntimeSettings(form).command : 'pi'}
            selected={form ? getActiveAgentRuntime(form) === 'pi' : false}
            onSelect={() => update({ activeAgentRuntime: 'pi' })}
            onCommand={(command) => update({ agents: { pi: { command } } })}
            t={t} tCommon={tCommon}
          />
          <SettingRow
            title={t('codexRuntime')}
            wideControl
            control={
              <div className="grid gap-3 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
                <div className="grid gap-3 rounded-xl border border-ds-border-muted bg-ds-card/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`inline-flex rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${
                      codexDiscovery?.available
                        ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                        : 'border-amber-400/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                    }`}>
                      {codexDiscovery?.available
                        ? t('codexDiscoveryAvailable')
                        : t('codexDiscoveryUnavailable')}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={codexDiscoveryChecking}
                        onClick={() => void detectCodex()}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:opacity-55"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${codexDiscoveryChecking ? 'animate-spin' : ''}`} />
                        {t('codexDiscoveryRedetect')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void chooseCodexRuntimeExecutable(
                          () => window.sciforge.pickFile({
                            title: t('codexDiscoveryChoose'),
                            filters: [
                              { name: t('codexDiscoveryApplications'), extensions: ['app'] },
                              { name: t('codexDiscoveryAllFiles'), extensions: ['*'] }
                            ]
                          }),
                          updateCodexRuntime,
                          (path) => runtimeProvider.normalizeExecutablePath('codex', path)
                        )}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        {t('codexDiscoveryChoose')}
                      </button>
                      {codexRecoveryOptions.installGuideUrl ? (
                        <button
                          type="button"
                          onClick={() => void window.sciforge.openExternal(codexRecoveryOptions.installGuideUrl!)}
                          className="rounded-xl px-3 py-2 text-[12.5px] font-medium text-accent transition hover:bg-ds-hover"
                        >
                          {t('codexDiscoveryInstall')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <details
                    className="rounded-lg border border-ds-border-muted bg-ds-main/35 px-3 py-2 text-[12px] text-ds-muted"
                    data-runtime-details="codex"
                  >
                    <summary className="cursor-pointer font-medium text-ds-ink">{t('runtimeDetails')}</summary>
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      <p className="sm:col-span-2">{t('codexManagedHomeDesc')}</p>
                      {codexDiscovery ? (
                        <>
                          <div>{t('codexDiscoverySource')}: <span className="font-medium text-ds-ink">{
                            codexDiscovery.source
                              ? t(`codexDiscoverySource_${codexDiscovery.source.replaceAll('-', '_')}`)
                              : t('codexDiscoveryUnknown')
                          }</span></div>
                          <div>{t('codexDiscoveryVersion')}: <span className="font-mono text-ds-ink">{codexDiscovery.version ?? t('codexDiscoveryUnknown')}</span></div>
                          <div>{t('codexDiscoveryAppServer')}: <span className="font-medium text-ds-ink">{
                            codexDiscovery.protocol?.supported
                              ? t('codexDiscoverySupported')
                              : t('codexDiscoveryUnsupported')
                          }</span></div>
                          {codexDiscovery.executablePath ? (
                            <code className="break-all text-[11px] text-ds-faint sm:col-span-2">{codexDiscovery.executablePath}</code>
                          ) : null}
                          {codexDiscovery.failure ? (
                            <div className="text-amber-800 dark:text-amber-200 sm:col-span-2">{
                              tCommon(runtimeErrorTranslationKey(codexDiscovery.failure.code) ?? 'runtimeActionFailed')
                            }</div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </details>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('codexCommand')}
                    <input
                      className={textInputClass}
                      value={codex.command}
                      placeholder={t('codexCommandPlaceholder')}
                      onChange={(event) =>
                        updateCodexRuntime({ command: event.target.value })
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('codexDefaultModel')}
                    <select
                      className={selectControlClass}
                      value={codex.model}
                      onChange={(event) => {
                        const model = event.target.value
                        const nextModel = selectedCodexCatalogModel(model, codexModelCatalog)
                        updateCodexRuntime({
                          model,
                          ...(nextModel && !nextModel.reasoningEfforts.some(({ id }) => id === codex.reasoningEffort)
                            ? { reasoningEffort: nextModel.reasoningEfforts.find(({ isDefault }) => isDefault)?.id ?? codex.reasoningEffort }
                            : {}),
                          ...(nextModel && codex.serviceTier && !nextModel.serviceTiers.some(({ id }) => id === codex.serviceTier)
                            ? { serviceTier: '' }
                            : {})
                        })
                      }}
                    >
                      <option value="">{t('codexModelAuto')}</option>
                      {codex.model && !catalogModels.some(({ id }) => id === codex.model) ? (
                        <option value={codex.model} disabled>{codex.model}</option>
                      ) : null}
                      {catalogModels.map((model) => (
                        <option key={model.id} value={model.id}>{model.displayName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('codexDefaultReasoningEffort')}
                    <select
                      className={selectControlClass}
                      value={codex.reasoningEffort}
                      disabled={!selectedCatalogModel}
                      onChange={(event) => updateCodexRuntime({ reasoningEffort: event.target.value })}
                    >
                      {codex.reasoningEffort && !reasoningOptions.some(({ id }) => id === codex.reasoningEffort) ? (
                        <option value={codex.reasoningEffort} disabled>{codex.reasoningEffort}</option>
                      ) : null}
                      {reasoningOptions.map((effort) => (
                        <option
                          key={effort.id}
                          value={effort.id}
                          disabled={!selectedReasoningIds.has(effort.id)}
                        >
                          {effort.id}
                        </option>
                      ))}
                    </select>
                    {selectedCatalogModel && !selectedReasoningIds.has(codex.reasoningEffort) ? (
                      <span className="font-normal text-amber-700 dark:text-amber-200">{t('codexReasoningUnsupported')}</span>
                    ) : null}
                  </label>
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('codexDefaultServiceTier')}
                    <select
                      className={selectControlClass}
                      value={codex.serviceTier}
                      disabled={!selectedCatalogModel}
                      onChange={(event) => updateCodexRuntime({ serviceTier: event.target.value })}
                    >
                      <option value="">{t('codexServiceTierAuto')}</option>
                      {codex.serviceTier && !serviceTierOptions.some(({ id }) => id === codex.serviceTier) ? (
                        <option value={codex.serviceTier} disabled>{codex.serviceTier}</option>
                      ) : null}
                      {serviceTierOptions.map((tier) => (
                        <option
                          key={tier.id}
                          value={tier.id}
                          disabled={!selectedServiceTierIds.has(tier.id)}
                        >
                          {tier.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <RuntimePermissionFields
                    t={t}
                    selectControlClass={selectControlClass}
                    approvalPolicy={codex.approvalPolicy}
                    sandboxMode={codex.sandboxMode}
                    onChange={(patch) => updateCodexRuntime(patch)}
                  />
                </div>
                {!codexModelCatalog?.available ? (
                  <div className="text-[12px] text-ds-faint">{t('codexModelCatalogUnavailable')}</div>
                ) : null}
                <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                  {t('codexExtraArgs')}
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
            wideControl
            control={
              <div className="grid gap-3 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('claudeCommand')}
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
                    allowAutoApproval
                    onChange={(patch) => updateClaudeRuntime(patch)}
                  />
                </div>
                <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                  {t('claudeExtraArgs')}
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
                <details
                  className="rounded-lg border border-ds-border-muted bg-ds-card/55 px-3 py-2 text-[12px] text-ds-muted"
                  data-runtime-details="claude"
                >
                  <summary className="cursor-pointer font-medium text-ds-ink">{t('runtimeDetails')}</summary>
                  <p className="mt-2">{t('claudeManagedConfigDesc')}</p>
                </details>
              </div>
            }
          />
          <SettingRow
            title={t('dshRuntime')}
            wideControl
            control={
              <div className="grid gap-3 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
                <div className="grid gap-3 rounded-xl border border-ds-border-muted bg-ds-card/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`inline-flex rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${
                      dshDiscovery?.available
                        ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                        : 'border-amber-400/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                    }`}>
                      {dshDiscovery?.available
                        ? t('dshDiscoveryAvailable')
                        : t('dshDiscoveryUnavailable')}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={dshDiscoveryChecking}
                        onClick={() => void detectDsh()}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:opacity-55"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${dshDiscoveryChecking ? 'animate-spin' : ''}`} />
                        {t('dshDiscoveryRedetect')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void chooseDshRuntimeExecutable(
                          () => window.sciforge.pickFile({
                            title: t('dshDiscoveryChoose'),
                            filters: [
                              { name: t('dshDiscoveryApplications'), extensions: ['app'] },
                              { name: t('dshDiscoveryAllFiles'), extensions: ['*'] }
                            ]
                          }),
                          updateDshRuntime,
                          (path) => runtimeProvider.normalizeExecutablePath('dsh', path)
                        )}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        {t('dshDiscoveryChoose')}
                      </button>
                      {dshRecoveryOptions.installGuideUrl ? (
                        <button
                          type="button"
                          onClick={() => void window.sciforge.openExternal(dshRecoveryOptions.installGuideUrl!)}
                          className="rounded-xl px-3 py-2 text-[12.5px] font-medium text-accent transition hover:bg-ds-hover"
                        >
                          {t('dshDiscoveryInstall')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <details
                    className="rounded-lg border border-ds-border-muted bg-ds-main/35 px-3 py-2 text-[12px] text-ds-muted"
                    data-runtime-details="dsh"
                  >
                    <summary className="cursor-pointer font-medium text-ds-ink">{t('runtimeDetails')}</summary>
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      <p className="sm:col-span-2">{t('dshManagedConfigDesc')}</p>
                      {dshDiscovery ? (
                        <>
                          <div>{t('dshDiscoveryVersion')}: <span className="font-mono text-ds-ink">{dshDiscovery.version ?? t('dshDiscoveryUnknown')}</span></div>
                          <div>{t('runtimeDiscoveryDetectedFrom')}: <span className="font-medium text-ds-ink">{
                            dshDiscovery.source
                              ? t(`runtimeDiscoverySource_${dshDiscovery.source.replaceAll('-', '_')}`)
                              : t('dshDiscoveryUnknown')
                          }</span></div>
                          {dshDiscovery.deploymentIntegrity ? (
                            <div className="sm:col-span-2">{t(
                              dshDiscovery.deploymentIntegrity === 'pinned'
                                ? 'runtimeDeploymentIntegrityPinned'
                                : 'runtimeDeploymentIntegrityDerived'
                            )}</div>
                          ) : null}
                          <div>{t('dshDiscoverySession')}: <span className="font-medium text-ds-ink">{
                            dshDiscovery.protocol?.supported
                              ? t('dshDiscoverySupported')
                              : t('dshDiscoveryUnsupported')
                          }</span></div>
                          {dshDiscovery.executablePath ? (
                            <code className="break-all text-[11px] text-ds-faint sm:col-span-2">{dshDiscovery.executablePath}</code>
                          ) : null}
                          {dshDiscovery.failure ? (
                            <div className="text-amber-800 dark:text-amber-200 sm:col-span-2">{
                              tCommon(runtimeErrorTranslationKey(dshDiscovery.failure.code) ?? 'runtimeActionFailed')
                            }</div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </details>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('dshExecutablePath')}
                    <input
                      className={textInputClass}
                      value={dsh.executablePath}
                      placeholder={t('dshExecutablePathPlaceholder')}
                      onChange={(event) =>
                        updateDshRuntime({ executablePath: event.target.value })
                      }
                    />
                  </label>
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('dshSelectedModel')}
                    <select
                      className={selectControlClass}
                      value={dsh.selectedModel}
                      onChange={(event) =>
                        updateDshRuntime({ selectedModel: event.target.value })
                      }
                    >
                      <option value="">{t('dshModelAuto')}</option>
                      {dsh.selectedModel && !DSH_MODEL_OPTIONS.some((id) => id === dsh.selectedModel) ? (
                        <option value={dsh.selectedModel} disabled>{dsh.selectedModel}</option>
                      ) : null}
                      {DSH_MODEL_OPTIONS.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                    {t('dshReasoningEffort')}
                    <select
                      className={selectControlClass}
                      value={dsh.reasoningEffort}
                      onChange={(event) =>
                        updateDshRuntime({ reasoningEffort: event.target.value })
                      }
                    >
                      <option value="">{t('dshReasoningAuto')}</option>
                      {dsh.reasoningEffort && !DSH_REASONING_EFFORT_OPTIONS.some((id) => id === dsh.reasoningEffort) ? (
                        <option value={dsh.reasoningEffort} disabled>{dsh.reasoningEffort}</option>
                      ) : null}
                      {DSH_REASONING_EFFORT_OPTIONS.map((effort) => (
                        <option key={effort} value={effort}>{effort}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2 text-[12px] font-semibold text-ds-muted">
                    <span className="grid gap-0.5">
                      {t('dshCommandExecution')}
                      <span className="text-[11px] font-normal">{t('dshCommandExecutionDesc')}</span>
                    </span>
                    <Toggle
                      checked={dsh.commandExecution}
                      onChange={(commandExecution) => updateDshRuntime({ commandExecution })}
                    />
                  </label>
                </div>
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
                value={listSettingsText(form.skills.extraDirs)}
                onChange={(event) =>
                  update({
                    skills: {
                      extraDirs: splitSettingsList(event.target.value)
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
  allowAutoApproval = false,
  onChange
}: {
  t: (key: string) => string
  selectControlClass: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  allowAutoApproval?: boolean
  onChange: (patch: {
    approvalPolicy?: ApprovalPolicy
    sandboxMode?: SandboxMode
  }) => void
}): ReactElement {
  const permissionLevel = permissionLevelFromRuntime(approvalPolicy, sandboxMode)
  return (
    <>
      <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted sm:col-span-2">
        {t('permissionLevel')}
        <select
          className={selectControlClass}
          value={permissionLevel}
          onChange={(event) => {
            const level = event.target.value as AgentPermissionLevel
            onChange(runtimePatchForPermissionLevel(level, allowAutoApproval ? 'auto' : 'never'))
          }}
        >
          <option value="request-approval">{t('permissionRequestApproval')}</option>
          <option value="assisted-approval">{t('permissionAssistedApproval')}</option>
          <option value="full-access">{t('permissionFullAccess')}</option>
        </select>
      </label>
      <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
        {t('approvalPolicy')}
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
      <p className="text-[12px] text-ds-muted sm:col-span-2">
        {t('runtimePermissionReconnectHint')}
      </p>
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
                ['claude', t('agentRuntimeClaude')],
                ['dsh', t('agentRuntimeDsh')]
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
