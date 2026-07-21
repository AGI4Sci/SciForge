import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  MODEL_ROUTER_PROTOCOL_PREFERENCES,
  getModelRouterSettings,
  type AgentRuntimeId,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ModelRouterProtocolPreference
} from '@shared/app-settings'
import type { ModelAccessStatus } from '@shared/sciforge-api'
import type { AgentRuntimeAuxiliaryOperation } from '@shared/agent-runtime-contract'
import {
  CODING_PLAN_ADAPTERS,
  type CodingPlanAdapterId
} from '@shared/coding-plan-adapters'
import { CheckCircle2, ExternalLink, Eye, EyeOff, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { openSafeExternalUrl } from '../lib/open-external'

type Translate = (key: string, values?: Record<string, unknown>) => string
type AccessMode = 'api' | 'coding-plan'
type StatusTone = 'idle' | 'busy' | 'success' | 'error'

type AccessStatus = {
  tone: StatusTone
  message: string
}

type ServiceStatus = ModelAccessStatus

type CodingPlanAccount = {
  authenticated: boolean
  email?: string
  planType?: string
}

type CodingPlanLogin = {
  loginId: string
  authUrl?: string
  verificationUrl?: string
  userCode?: string
}

type CodingPlanAuxiliaryOperation = Extract<
  AgentRuntimeAuxiliaryOperation,
  | 'getCodingPlanAccount'
  | 'startCodingPlanLogin'
  | 'waitForCodingPlanLogin'
  | 'logoutCodingPlanAccount'
  | 'getCodingPlanRateLimits'
>

type PlanAdapterPresentation = {
  id: string
  runtimeId: AgentRuntimeId
  labelKey: string
  descriptionKey: string
  operations: {
    getAccount: CodingPlanAuxiliaryOperation
    startLogin: CodingPlanAuxiliaryOperation
    waitForLogin: CodingPlanAuxiliaryOperation
    logout: CodingPlanAuxiliaryOperation
  }
}

const PLAN_ADAPTER_PRESENTATIONS: Record<
  CodingPlanAdapterId,
  Omit<PlanAdapterPresentation, 'id' | 'runtimeId'>
> = {
  codex: {
    labelKey: 'modelAccessPlanCodex',
    descriptionKey: 'modelAccessPlanCodexDesc',
    operations: {
      getAccount: 'getCodingPlanAccount',
      startLogin: 'startCodingPlanLogin',
      waitForLogin: 'waitForCodingPlanLogin',
      logout: 'logoutCodingPlanAccount'
    }
  }
}

const PLAN_ADAPTERS: readonly PlanAdapterPresentation[] = CODING_PLAN_ADAPTERS.flatMap((adapter) => {
  const presentation = PLAN_ADAPTER_PRESENTATIONS[adapter.id]
  return presentation ? [{ ...adapter, ...presentation }] : []
})

export function buildModelAccessSelectionPatch(input: {
  mode: AccessMode
  planAdapterId: string
  planRuntimeId?: AgentRuntimeId
}): AppSettingsPatch {
  return {
    modelAccess: {
      mode: input.mode,
      planAdapterId: input.planAdapterId
    },
    ...(input.mode === 'coding-plan' && input.planRuntimeId
      ? { activeAgentRuntime: input.planRuntimeId }
      : {})
  }
}

export function modelAccessStatusMatchesSelection(
  status: ModelAccessStatus,
  mode: AccessMode | null,
  adapterId: string | null
): boolean {
  if (mode === 'api') return status.mode === 'api' && status.service === 'model-router'
  if (mode === 'coding-plan') {
    return status.mode === 'coding-plan'
      && status.service === 'plan-gateway'
      && status.adapterId === adapterId
  }
  return false
}

export function modelAccessStatusReady(status: ModelAccessStatus): boolean {
  const credentialReady = status.credentialState === 'configured'
    || status.credentialState === 'authenticated'
  return status.health === 'healthy' && credentialReady && status.traceCaptureReady
}

function unavailableModelAccessStatus(
  mode: AccessMode | null,
  adapterId: string | null,
  action: string
): ModelAccessStatus {
  return {
    setupRequired: false,
    mode,
    service: mode === 'api' ? 'model-router' : mode === 'coding-plan' ? 'plan-gateway' : null,
    health: 'unavailable',
    adapterId: mode === 'coding-plan' ? adapterId : null,
    credentialState: 'unknown',
    protocol: null,
    protocolState: mode === 'api' ? 'pending-first-request' : 'unknown',
    traceCaptureReady: false,
    action
  }
}

export type GenericApiCheckResult =
  | { kind: 'invalid'; validation: 'missing' | 'invalid-url' }
  | { kind: 'pending-save' }
  | { kind: 'service'; status: ModelAccessStatus }

export async function checkGenericApiAccess(input: {
  member: {
    baseUrl: string
    apiKey: string
    model: string
    protocol?: ModelRouterProtocolPreference
  }
  serviceProbeEnabled: boolean
  readStatus: () => Promise<ModelAccessStatus>
}): Promise<GenericApiCheckResult> {
  const validation = validateGenericApiMember(input.member)
  if (validation !== 'ready') return { kind: 'invalid', validation }
  if (!input.serviceProbeEnabled) return { kind: 'pending-save' }
  return { kind: 'service', status: await input.readStatus() }
}

export function sameGenericApiMember(
  left: { baseUrl: string; apiKey: string; model: string; protocol?: ModelRouterProtocolPreference },
  right: { baseUrl: string; apiKey: string; model: string; protocol?: ModelRouterProtocolPreference }
): boolean {
  return left.baseUrl === right.baseUrl
    && left.apiKey === right.apiKey
    && left.model === right.model
    && (left.protocol ?? 'auto') === (right.protocol ?? 'auto')
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function unwrapResult(value: unknown): unknown {
  const result = record(value)
  if (result.ok === false) {
    throw new Error(
      nonEmptyString(result.message) ??
      nonEmptyString(result.error) ??
      'Coding Plan operation failed.'
    )
  }
  return result.value ?? value
}

export function normalizeCodingPlanAccount(value: unknown): CodingPlanAccount {
  const result = record(unwrapResult(value))
  const account = record(result.account ?? result)
  const type = nonEmptyString(account.type)
  const email = nonEmptyString(account.email)
  const planType = nonEmptyString(account.planType) ?? nonEmptyString(result.planType)
  const explicitAuthentication = typeof result.authenticated === 'boolean'
    ? result.authenticated
    : undefined
  return {
    authenticated: explicitAuthentication ?? (
      account.authenticated === true ||
      type === 'chatgpt' ||
      Boolean(email || planType)
    ),
    ...(email ? { email } : {}),
    ...(planType ? { planType } : {})
  }
}

export function validateGenericApiMember(input: {
  baseUrl: string
  apiKey: string
  model: string
}): 'missing' | 'invalid-url' | 'ready' {
  if (!input.baseUrl.trim() || !input.apiKey.trim() || !input.model.trim()) return 'missing'
  try {
    const parsed = new URL(input.baseUrl.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? 'ready' : 'invalid-url'
  } catch {
    return 'invalid-url'
  }
}

export type ModelAccessSetupValidation =
  | 'ready'
  | 'missing-mode'
  | 'invalid-api'
  | 'missing-plan'
  | 'plan-login-required'

export function validateModelAccessSetup(
  form: AppSettingsV1,
  planAuthenticated: boolean
): ModelAccessSetupValidation {
  const access = form.modelAccess
  if (access?.mode !== 'api' && access?.mode !== 'coding-plan') return 'missing-mode'
  if (access.mode === 'api') {
    return validateGenericApiMember(
      getModelRouterSettings(form).profiles.default.textReasoner
    ) === 'ready'
      ? 'ready'
      : 'invalid-api'
  }
  if (!access.planAdapterId.trim()) return 'missing-plan'
  return planAuthenticated ? 'ready' : 'plan-login-required'
}

function normalizeLogin(value: unknown): CodingPlanLogin {
  const login = record(unwrapResult(value))
  const loginId = nonEmptyString(login.loginId)
  if (!loginId) throw new Error('Coding Plan login did not return a login identifier.')
  return {
    loginId,
    ...(nonEmptyString(login.authUrl) ? { authUrl: nonEmptyString(login.authUrl) } : {}),
    ...(nonEmptyString(login.verificationUrl)
      ? { verificationUrl: nonEmptyString(login.verificationUrl) }
      : {}),
    ...(nonEmptyString(login.userCode) ? { userCode: nonEmptyString(login.userCode) } : {})
  }
}

async function callPlanOperation(
  adapter: PlanAdapterPresentation,
  operation: CodingPlanAuxiliaryOperation,
  payload?: Record<string, unknown>
): Promise<unknown> {
  const auxiliary = window.sciforge?.agentRuntime?.auxiliary
  if (typeof auxiliary !== 'function') {
    throw new Error('Coding Plan account bridge is unavailable.')
  }
  return auxiliary({
    runtimeId: adapter.runtimeId,
    operation,
    ...(payload ? { payload } : {})
  })
}

export async function runCodingPlanLoginSequence(input: {
  adapterId: string
  method: 'browser' | 'device'
  invoke?: (operation: CodingPlanAuxiliaryOperation, payload?: Record<string, unknown>) => Promise<unknown>
  openUrl?: (url: string) => Promise<unknown>
  onLoginStarted?: (login: CodingPlanLogin) => void
}): Promise<{ account: CodingPlanAccount; login: CodingPlanLogin }> {
  const adapter = PLAN_ADAPTERS.find((candidate) => candidate.id === input.adapterId)
  if (!adapter) throw new Error(`Unsupported Coding Plan adapter: ${input.adapterId}`)
  const invoke = input.invoke ?? ((operation, payload) => callPlanOperation(adapter, operation, payload))
  const openUrl = input.openUrl ?? openSafeExternalUrl
  const login = normalizeLogin(await invoke(adapter.operations.startLogin, { method: input.method }))
  input.onLoginStarted?.(login)
  const loginUrl = login.authUrl ?? login.verificationUrl
  if (loginUrl) await openUrl(loginUrl)
  const completion = record(unwrapResult(await invoke(
    adapter.operations.waitForLogin,
    { loginId: login.loginId }
  )))
  if (completion.success === false) {
    throw new Error(nonEmptyString(completion.error) ?? 'Coding Plan sign-in was not completed.')
  }
  const account = completion.account
    ? normalizeCodingPlanAccount(completion.account)
    : normalizeCodingPlanAccount(await invoke(adapter.operations.getAccount, { refreshToken: true }))
  return { account, login }
}

export function GenericApiMemberFields({
  member,
  onChange,
  t,
  compact = false,
  testId,
  baseUrlPlaceholder,
  modelPlaceholder,
  showProtocol = false
}: {
  member: { baseUrl: string; apiKey: string; model: string; protocol?: ModelRouterProtocolPreference }
  onChange: (patch: {
    baseUrl?: string
    apiKey?: string
    model?: string
    protocol?: ModelRouterProtocolPreference
  }) => void
  t: Translate
  compact?: boolean
  testId?: string
  baseUrlPlaceholder?: string
  modelPlaceholder?: string
  showProtocol?: boolean
}): ReactElement {
  const [secretVisible, setSecretVisible] = useState(false)
  const fieldClass = compact
    ? 'w-full rounded-xl border border-slate-300/75 bg-white/88 px-4 py-3 text-[15px] text-slate-800 outline-none transition focus:border-[#1388ff]/70 focus:ring-2 focus:ring-[#1388ff]/15 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-[#3aa0ff]/70 dark:focus:ring-[#3aa0ff]/15 dark:placeholder:text-slate-500'
    : 'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

  return (
    <div className="grid gap-3" data-generic-api-member={testId ?? true}>
      <label className="grid gap-1.5 text-[12px] font-medium text-ds-muted">
        <span>{t('modelRouterRoleBaseUrl')}</span>
        <input
          className={fieldClass}
          value={member.baseUrl}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
          placeholder={baseUrlPlaceholder ?? t('modelRouterTextReasonerBaseUrlPlaceholder')}
          spellCheck={false}
        />
      </label>
      {showProtocol ? (
        <label className="grid gap-1.5 text-[12px] font-medium text-ds-muted">
          <span>{t('modelRouterRoleProtocol')}</span>
          <select
            className={fieldClass}
            value={member.protocol ?? 'auto'}
            onChange={(event) => onChange({
              protocol: event.target.value as ModelRouterProtocolPreference
            })}
          >
            {MODEL_ROUTER_PROTOCOL_PREFERENCES.map((protocol) => (
              <option key={protocol} value={protocol}>
                {t(`modelRouterProtocol_${protocol}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="grid gap-1.5 text-[12px] font-medium text-ds-muted">
        <span>{t('modelRouterRoleApiKey')}</span>
        <span className="relative block">
          <input
            className={`${fieldClass} pr-11 font-mono`}
            type={secretVisible ? 'text' : 'password'}
            value={member.apiKey}
            onChange={(event) => onChange({ apiKey: event.target.value })}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setSecretVisible((visible) => !visible)}
            aria-label={t(secretVisible ? 'hideSecret' : 'showSecret')}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ds-faint hover:bg-ds-hover hover:text-ds-muted"
          >
            {secretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </span>
      </label>
      <label className="grid gap-1.5 text-[12px] font-medium text-ds-muted">
        <span>{t('modelRouterRoleModel')}</span>
        <input
          className={`${fieldClass} font-mono`}
          value={member.model}
          onChange={(event) => onChange({ model: event.target.value })}
          placeholder={modelPlaceholder ?? t('modelRouterTextReasonerModelPlaceholder')}
          spellCheck={false}
        />
      </label>
    </div>
  )
}

export function ModelAccessSettings({
  form,
  update,
  t,
  compact = false,
  onPlanAccountChange,
  serviceProbeEnabled = false
}: {
  form: AppSettingsV1
  update: (patch: AppSettingsPatch) => void
  t: Translate
  compact?: boolean
  onPlanAccountChange?: (account: CodingPlanAccount | null) => void
  serviceProbeEnabled?: boolean
}): ReactElement {
  const accessMode: AccessMode | null =
    form.modelAccess?.mode === 'api' || form.modelAccess?.mode === 'coding-plan'
      ? form.modelAccess.mode
      : null
  const configuredAdapterId = form.modelAccess?.planAdapterId ?? ''
  const selectedAdapter = useMemo(
    () => PLAN_ADAPTERS.find((adapter) => adapter.id === configuredAdapterId),
    [configuredAdapterId]
  )
  const textMember = getModelRouterSettings(form).profiles.default.textReasoner
  const latestTextMember = useRef(textMember)
  latestTextMember.current = textMember
  const [status, setStatus] = useState<AccessStatus>({ tone: 'idle', message: '' })
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null)
  const [account, setAccount] = useState<CodingPlanAccount | null>(null)
  const [deviceLogin, setDeviceLogin] = useState<Pick<CodingPlanLogin, 'verificationUrl' | 'userCode'> | null>(null)

  const setMode = (mode: AccessMode): void => {
    const adapter = selectedAdapter ?? PLAN_ADAPTERS[0]
    setStatus({ tone: 'idle', message: '' })
    setServiceStatus(null)
    setDeviceLogin(null)
    if (mode !== 'coding-plan') onPlanAccountChange?.(null)
    update(buildModelAccessSelectionPatch({
      mode,
      planAdapterId: mode === 'coding-plan' ? adapter.id : configuredAdapterId,
      ...(mode === 'coding-plan' ? { planRuntimeId: adapter.runtimeId } : {})
    }))
  }

  const updateApiMember = (patch: {
    baseUrl?: string
    apiKey?: string
    model?: string
    protocol?: ModelRouterProtocolPreference
  }): void => {
    setStatus({ tone: 'idle', message: '' })
    setServiceStatus(null)
    update({ modelRouter: { profiles: { default: { textReasoner: patch } } } })
  }

  const refreshServiceStatus = async (quiet = false): Promise<ModelAccessStatus['health']> => {
    if (!quiet) setStatus({ tone: 'busy', message: t('modelAccessStatusChecking') })
    if (typeof window.sciforge?.getModelAccessStatus !== 'function') {
      setServiceStatus(unavailableModelAccessStatus(
        accessMode,
        selectedAdapter?.id ?? null,
        t('modelAccessStatusUnavailable')
      ))
      return 'unavailable'
    }
    try {
      const next = await window.sciforge.getModelAccessStatus()
      if (!modelAccessStatusMatchesSelection(next, accessMode, selectedAdapter?.id ?? null)) {
        setServiceStatus(null)
        setStatus({ tone: 'idle', message: t('modelAccessStatusPendingSave') })
        return 'not_configured'
      }
      setServiceStatus(next)
      setStatus({
        tone: modelAccessStatusReady(next) ? 'success' : 'idle',
        message: ''
      })
      return next.health
    } catch (error) {
      setServiceStatus(unavailableModelAccessStatus(
        accessMode,
        selectedAdapter?.id ?? null,
        t('modelAccessStatusError', {
          message: error instanceof Error ? error.message : String(error)
        })
      ))
      return 'error'
    }
  }

  const refreshAccount = async (quiet = false): Promise<void> => {
    if (!selectedAdapter) {
      setAccount(null)
      onPlanAccountChange?.(null)
      setStatus({ tone: 'error', message: t('modelAccessPlanUnsupported') })
      return
    }
    if (!quiet) setStatus({ tone: 'busy', message: t('modelAccessStatusChecking') })
    try {
      const next = normalizeCodingPlanAccount(await callPlanOperation(
        selectedAdapter,
        selectedAdapter.operations.getAccount,
        { refreshToken: true }
      ))
      setAccount(next)
      onPlanAccountChange?.(next)
      setStatus({
        tone: next.authenticated ? 'success' : 'idle',
        message: next.authenticated
          ? t('modelAccessPlanReady')
          : t('modelAccessPlanLoginRequired')
      })
    } catch (error) {
      setAccount(null)
      onPlanAccountChange?.(null)
      setStatus({
        tone: 'error',
        message: t('modelAccessPlanUnavailable', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }

  useEffect(() => {
    if (accessMode !== 'coding-plan') return
    void Promise.all([refreshAccount(true), refreshServiceStatus(true)])
  // The adapter identifier is the stable boundary; refreshAccount intentionally stays local.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessMode, selectedAdapter?.id])

  const checkApi = async (): Promise<void> => {
    const checkedMember = { ...textMember }
    setStatus({ tone: 'busy', message: t('modelAccessStatusChecking') })
    try {
      const result = await checkGenericApiAccess({
        member: checkedMember,
        serviceProbeEnabled,
        readStatus: async () => {
          if (typeof window.sciforge?.getModelAccessStatus !== 'function') {
            throw new Error(t('modelAccessStatusUnavailable'))
          }
          return window.sciforge.getModelAccessStatus()
        }
      })
      if (!sameGenericApiMember(checkedMember, latestTextMember.current)) return
      if (result.kind === 'invalid') {
        setStatus({
          tone: 'error',
          message: result.validation === 'invalid-url'
            ? t('modelAccessApiInvalidUrl')
            : t('modelAccessApiMissing')
        })
        return
      }
      if (result.kind === 'pending-save') {
        setServiceStatus(null)
        setStatus({ tone: 'idle', message: t('modelAccessApiFieldsComplete') })
        return
      }
      if (!modelAccessStatusMatchesSelection(result.status, 'api', null)) {
        setServiceStatus(null)
        setStatus({ tone: 'idle', message: t('modelAccessApiFieldsComplete') })
        return
      }
      setServiceStatus(result.status)
      setStatus({
        tone: modelAccessStatusReady(result.status) ? 'success' : 'idle',
        message: ''
      })
    } catch (error) {
      if (!sameGenericApiMember(checkedMember, latestTextMember.current)) return
      setServiceStatus(unavailableModelAccessStatus(
        'api',
        null,
        t('modelAccessStatusError', {
          message: error instanceof Error ? error.message : String(error)
        })
      ))
      setStatus({ tone: 'error', message: t('modelAccessApiCheckFailed') })
    }
  }

  const startLogin = async (method: 'browser' | 'device'): Promise<void> => {
    if (!selectedAdapter) return
    setStatus({ tone: 'busy', message: t('modelAccessPlanLoginStarting') })
    setDeviceLogin(null)
    try {
      const { account: completedAccount } = await runCodingPlanLoginSequence({
        adapterId: selectedAdapter.id,
        method,
        onLoginStarted: (login) => {
          if (login.verificationUrl || login.userCode) {
            setDeviceLogin({
              ...(login.verificationUrl ? { verificationUrl: login.verificationUrl } : {}),
              ...(login.userCode ? { userCode: login.userCode } : {})
            })
          }
          setStatus({ tone: 'busy', message: t('modelAccessPlanLoginWaiting') })
        }
      })
      setAccount(completedAccount)
      onPlanAccountChange?.(completedAccount)
      setDeviceLogin(null)
      setStatus({ tone: 'success', message: t('modelAccessPlanReady') })
      await refreshServiceStatus(true)
    } catch (error) {
      setStatus({
        tone: 'error',
        message: t('modelAccessPlanLoginError', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }

  const logout = async (): Promise<void> => {
    if (!selectedAdapter) return
    setStatus({ tone: 'busy', message: t('modelAccessPlanLoggingOut') })
    try {
      unwrapResult(await callPlanOperation(selectedAdapter, selectedAdapter.operations.logout))
      setAccount({ authenticated: false })
      onPlanAccountChange?.({ authenticated: false })
      setStatus({ tone: 'idle', message: t('modelAccessPlanLoggedOut') })
    } catch (error) {
      setStatus({
        tone: 'error',
        message: t('modelAccessPlanLogoutError', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }

  const selectClass = compact
    ? 'w-full rounded-xl border border-slate-300/75 bg-white/88 px-4 py-3 text-[15px] text-slate-800 outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100'
    : 'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
  const choiceClass = (active: boolean): string => [
    'rounded-xl border px-3 py-3 text-left transition',
    active
      ? 'border-accent/50 bg-accent/10 text-ds-ink'
      : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover'
  ].join(' ')
  const accountStatusClass = status.tone === 'error'
    ? 'border-red-500/25 bg-red-500/[0.08] text-red-700 dark:text-red-200'
    : status.tone === 'success'
      ? 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-200'
      : 'border-ds-border bg-ds-main/60 text-ds-muted'
  const serviceStatusClass = serviceStatus && modelAccessStatusReady(serviceStatus)
    ? 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-200'
    : serviceStatus
      ? 'border-red-500/25 bg-red-500/[0.08] text-red-700 dark:text-red-200'
      : 'border-ds-border bg-ds-main/60 text-ds-muted'

  return (
    <div className="grid gap-4" data-model-access data-access-mode={accessMode}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label={t('modelAccessMode')}>
        <button type="button" className={choiceClass(accessMode === 'api')} onClick={() => setMode('api')}>
          <span className="block text-sm font-semibold">{t('modelAccessApi')}</span>
          <span className="mt-1 block text-[12px] leading-5 opacity-80">{t('modelAccessApiDesc')}</span>
        </button>
        <button
          type="button"
          className={choiceClass(accessMode === 'coding-plan')}
          onClick={() => setMode('coding-plan')}
        >
          <span className="block text-sm font-semibold">{t('modelAccessCodingPlan')}</span>
          <span className="mt-1 block text-[12px] leading-5 opacity-80">{t('modelAccessCodingPlanDesc')}</span>
        </button>
      </div>

      {accessMode === 'api' ? (
        <div className="grid gap-3" data-api-access-form>
          <GenericApiMemberFields
            member={textMember}
            onChange={updateApiMember}
            t={t}
            compact={compact}
            testId="primary"
            showProtocol
          />
          <button
            type="button"
            onClick={() => void checkApi()}
            disabled={status.tone === 'busy'}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {t('modelAccessCheck')}
          </button>
        </div>
      ) : accessMode === 'coding-plan' ? (
        <div className="grid gap-3" data-coding-plan-access>
          <label className="grid gap-1.5 text-[12px] font-medium text-ds-muted">
            <span>{t('modelAccessPlan')}</span>
            <select
              className={selectClass}
              value={selectedAdapter?.id ?? ''}
              onChange={(event) => {
                setAccount(null)
                onPlanAccountChange?.(null)
                setStatus({ tone: 'idle', message: '' })
                const adapter = PLAN_ADAPTERS.find((candidate) => candidate.id === event.target.value)
                update(buildModelAccessSelectionPatch({
                  mode: 'coding-plan',
                  planAdapterId: event.target.value,
                  ...(adapter ? { planRuntimeId: adapter.runtimeId } : {})
                }))
              }}
            >
              {!selectedAdapter ? <option value="" disabled>{t('modelAccessPlanChoose')}</option> : null}
              {PLAN_ADAPTERS.map((adapter) => (
                <option key={adapter.id} value={adapter.id}>{t(adapter.labelKey)}</option>
              ))}
            </select>
          </label>
          {selectedAdapter ? (
            <p className="text-[12px] leading-5 text-ds-muted">{t(selectedAdapter.descriptionKey)}</p>
          ) : null}

          {account?.authenticated ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-ds-ink">
                {t('modelAccessPlanSignedIn', {
                  account: account.email ?? t('modelAccessPlanAccount'),
                  plan: account.planType ?? t('modelAccessPlanUnknownTier')
                })}
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                disabled={!selectedAdapter || status.tone === 'busy'}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                {t('modelAccessPlanLogout')}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void startLogin('browser')}
                disabled={!selectedAdapter || status.tone === 'busy'}
                className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                <LogIn className="h-4 w-4" />
                {t('modelAccessPlanLoginBrowser')}
              </button>
              <button
                type="button"
                onClick={() => void startLogin('device')}
                disabled={!selectedAdapter || status.tone === 'busy'}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-50"
              >
                {t('modelAccessPlanLoginDevice')}
              </button>
            </div>
          )}

          {deviceLogin ? (
            <div className="rounded-xl border border-ds-border bg-ds-main/60 px-3 py-2 text-[12px] leading-5 text-ds-muted">
              {deviceLogin.userCode ? (
                <p>{t('modelAccessPlanDeviceCode')} <code className="font-mono text-ds-ink">{deviceLogin.userCode}</code></p>
              ) : null}
              {deviceLogin.verificationUrl ? (
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 text-accent hover:underline"
                  onClick={() => void openSafeExternalUrl(deviceLogin.verificationUrl)}
                >
                  {t('modelAccessPlanOpenLogin')} <ExternalLink className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void Promise.all([refreshAccount(), refreshServiceStatus(true)])}
            disabled={!selectedAdapter || status.tone === 'busy'}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${status.tone === 'busy' ? 'animate-spin' : ''}`} />
            {t('modelAccessRefreshStatus')}
          </button>
        </div>
      ) : (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-[12px] leading-5 text-amber-800 dark:text-amber-200">
          {t('modelAccessChooseMode')}
        </p>
      )}

      {accessMode ? (
        <div className="grid gap-2" data-model-access-status>
          <div
            className={`rounded-xl border px-3 py-2 text-[12px] leading-5 ${serviceStatus ? serviceStatusClass : accountStatusClass}`}
            data-unified-model-access-status
          >
            <span className="font-semibold">{t('modelAccessUnifiedStatus')}</span>
            {serviceStatus ? (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt>{t('modelAccessServiceHealth')}</dt>
                <dd>{t(`modelAccessHealth_${serviceStatus.health}`)}</dd>
                <dt>{t('modelAccessCredentialStatus')}</dt>
                <dd>{t(`modelAccessCredential_${serviceStatus.credentialState}`)}</dd>
                <dt>{t('modelAccessProtocolStatus')}</dt>
                <dd>{serviceStatus.protocol
                  ? `${t(`modelAccessProtocol_${serviceStatus.protocol}`)} · ${t(`modelAccessProtocolState_${serviceStatus.protocolState}`)}`
                  : t(`modelAccessProtocolState_${serviceStatus.protocolState}`)}</dd>
                <dt>{t('modelAccessTraceStatus')}</dt>
                <dd>{t(serviceStatus.traceCaptureReady
                  ? 'modelAccessTraceReady'
                  : 'modelAccessTraceUnavailable')}</dd>
              </dl>
            ) : null}
            <p className="mt-1">
              <span className="font-semibold">{t('modelAccessCorrectiveAction')}</span>{' '}
              {(status.tone === 'busy' || status.tone === 'error' ? status.message : '')
                || serviceStatus?.action
                || status.message
                || t(accessMode === 'api' ? 'modelAccessApiStatusIdle' : 'modelAccessPlanStatusIdle')}
            </p>
          </div>
        </div>
      ) : (
        <div className={`rounded-xl border px-3 py-2 text-[12px] leading-5 ${accountStatusClass}`} data-model-access-status>
          {t('modelAccessStatusUnconfigured')}
        </div>
      )}
    </div>
  )
}
