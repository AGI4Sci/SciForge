import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  CircleAlert,
  Loader2,
  LogIn,
  LogOut,
  MonitorCheck,
  MonitorX,
  RefreshCw,
  Settings2,
  UserRound
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  ACCOUNT_DANGER_BUTTON_CLASS,
  ACCOUNT_GHOST_BUTTON_CLASS,
  ACCOUNT_INPUT_CLASS,
  ACCOUNT_PRIMARY_BUTTON_CLASS,
  ACCOUNT_SECONDARY_BUTTON_CLASS
} from './account-ui.js'
import { CLOUD_DEVICE_STATUS_MESSAGE } from './cloud-status.js'
import { desktopIdentityErrorCodeSchema, type IdentityCloudConfiguration } from '../contract.js'
import type { IdentityRendererProjection } from './projection.js'

const CLOUD_ERROR_MESSAGE = Object.freeze({
  OIDC_PROVIDER_UNAVAILABLE: 'cloudErrorProviderUnavailable',
  OIDC_LOGIN_FAILED: 'cloudErrorLoginFailed',
  OIDC_SESSION_EXPIRED: 'cloudErrorSessionExpired',
  OIDC_CONFIGURATION_ERROR: 'cloudErrorConfiguration',
  SCIFORGE_CLOUD_UNAVAILABLE: 'cloudErrorProviderUnavailable',
  SCIFORGE_CLOUD_AUTH_FAILED: 'cloudErrorLoginFailed',
  SCIFORGE_CLOUD_RESPONSE_INVALID: 'cloudErrorGeneric'
} as const)

const OIDC_STAGE_MESSAGE = Object.freeze({
  discovery: 'cloudErrorStageDiscovery',
  'token exchange': 'cloudErrorStageTokenExchange',
  'signing keys': 'cloudErrorStageSigningKeys'
} as const)

// Match the backend's fixed diagnostic envelope, then display only known codes.
// Never copy provider text, URLs, token values, or arbitrary error fields to the UI.
const OIDC_TRANSPORT_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER', 'TimeoutError', 'AbortError'
])

function oidcDiagnostic(error: Readonly<{ code?: string; message: string }> | undefined) {
  const parsed = desktopIdentityErrorCodeSchema.safeParse(error?.code)
  if (!parsed.success || !parsed.data.startsWith('OIDC_')) return null
  const match = error && error.message.length <= 1000
    ? /^Cannot reach the SciForge login service \((discovery|token exchange|signing keys): ([^\r\n]*)\)\.$/.exec(error.message)
    : null
  const codes = match
    ? [...new Set([...match[2].matchAll(/\[([A-Za-z_]+)\]/g)]
      .map((entry) => entry[1]).filter((code) => OIDC_TRANSPORT_CODES.has(code)))].slice(0, 3)
    : []
  return {
    code: parsed.data,
    stage: match ? OIDC_STAGE_MESSAGE[match[1] as keyof typeof OIDC_STAGE_MESSAGE] : null,
    transportCodes: codes
  }
}

export function CloudIdentitySection(props: Readonly<{
  projection: IdentityRendererProjection
  localAccountSelected: boolean
}>): React.JSX.Element {
  const { t } = useTranslation('identity')
  const snapshot = useSyncExternalStore(
    props.projection.subscribe,
    props.projection.getSnapshot
  )
  const cloud = snapshot.cloud
  const diagnostic = oidcDiagnostic(cloud?.error)
  const [pendingAction, setPendingAction] = useState<'login' | 'other' | null>(null)
  const busy = snapshot.cloudLoading || pendingAction !== null
  const activeDeviceId = cloud?.device.state === 'active'
    ? cloud.device.device.deviceId
    : null
  const run = (operation: () => Promise<void>, login = false): void => {
    setPendingAction(login ? 'login' : 'other')
    void operation().catch(() => undefined).finally(() => setPendingAction(null))
  }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [configuration, setConfiguration] = useState<IdentityCloudConfiguration | null>(null)
  const [issuerInput, setIssuerInput] = useState('')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsSaved, setSettingsSaved] = useState(false)

  useEffect(() => {
    const inspect = props.projection.inspectCloudConfiguration
    if (typeof inspect !== 'function') return
    let active = true
    void inspect.call(props.projection)
      .then((value) => {
        if (!active) return
        setConfiguration(value)
        setIssuerInput((current) => current || value.oidcIssuer || '')
        setBaseUrlInput((current) => current || value.cloudBaseUrl || '')
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [props.projection])

  const openSettings = (): void => {
    setSettingsOpen(true)
    setSettingsError(null)
    setSettingsSaved(false)
    setSettingsBusy(true)
    const inspect = props.projection.inspectCloudConfiguration
    if (typeof inspect !== 'function') {
      setSettingsBusy(false)
      return
    }
    void inspect.call(props.projection)
      .then((value) => {
        setConfiguration(value)
        setIssuerInput(value.oidcIssuer ?? '')
        setBaseUrlInput(value.cloudBaseUrl ?? '')
      })
      .catch((error: unknown) => {
        setSettingsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setSettingsBusy(false))
  }
  const saveSettings = (): void => {
    setSettingsBusy(true)
    setSettingsError(null)
    setSettingsSaved(false)
    void props.projection.configureCloud({
      oidcIssuer: issuerInput.trim() || null,
      cloudBaseUrl: baseUrlInput.trim() || null
    })
      .then((value) => {
        setConfiguration(value)
        setIssuerInput(value.oidcIssuer ?? '')
        setBaseUrlInput(value.cloudBaseUrl ?? '')
        setSettingsSaved(true)
      })
      .catch((error: unknown) => {
        setSettingsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setSettingsBusy(false))
  }
  const missingFields = (configuration?.missing ?? []).map((field) => t(
    field === 'oidcIssuer' ? 'cloudSettingsFieldOidcIssuer' : 'cloudSettingsFieldCloudBaseUrl'
  ))
  const configurationSource = configuration?.source.oidcIssuer === 'settings' ||
    configuration?.source.cloudBaseUrl === 'settings'
    ? 'cloudSettingsSourceSettings'
    : configuration
      ? 'cloudSettingsSourceEnvironment'
      : null

  return (
    <section className="mt-5 border-t border-border pt-5" aria-labelledby="cloud-identity-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="cloud-identity-title" className="text-ds-lg font-semibold">
            {t('cloudTitle')}
          </h3>
          <p className="mt-1 text-ds-sm text-muted-foreground">{t('cloudNotice')}</p>
        </div>
        {busy ? (
          <Loader2
            className="h-4 w-4 animate-spin text-muted-foreground"
            aria-label={t('loading')}
          />
        ) : null}
      </div>

      {!cloud ? (
        <p className="mt-3 text-ds-lg text-muted-foreground">{t('cloudLoading')}</p>
      ) : cloud.identity.state === 'signed-out' ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-ds-lg text-muted-foreground">
            <UserRound className="h-4 w-4" strokeWidth={1.8} />
            <span>{t('cloudSignedOut')}</span>
          </div>
          {!props.localAccountSelected ? (
            <p className="flex items-start gap-2 text-ds-sm text-amber-700 dark:text-amber-300">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span>{t('cloudLocalAccountRequired')}</span>
            </p>
          ) : null}
          <button
            type="button"
            className={ACCOUNT_PRIMARY_BUTTON_CLASS}
            disabled={busy || !props.localAccountSelected}
            onClick={() => run(() => props.projection.loginCloud(), true)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            <span>{t(pendingAction === 'login' ? 'cloudSigningIn' : 'cloudSignIn')}</span>
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserRound className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-ds-lg font-medium">{cloud.identity.user.displayName}</p>
              {cloud.identity.user.email ? (
                <p className="truncate text-ds-sm text-muted-foreground">{cloud.identity.user.email}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2 text-ds-lg">
            {cloud.device.state === 'active' ? (
              <MonitorCheck className="h-4 w-4 text-emerald-600" strokeWidth={1.8} />
            ) : cloud.device.state === 'revoked' ? (
              <MonitorX className="h-4 w-4 text-destructive" strokeWidth={1.8} />
            ) : cloud.device.state === 'enrolling' ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : (
              <CircleAlert className="h-4 w-4 text-amber-600" strokeWidth={1.8} />
            )}
            <span>{t(CLOUD_DEVICE_STATUS_MESSAGE[cloud.device.state])}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {activeDeviceId ? (
              <button
                type="button"
                className={ACCOUNT_SECONDARY_BUTTON_CLASS}
                disabled={busy}
                onClick={() => run(() => props.projection.revokeCloudDevice(activeDeviceId))}
              >
                <MonitorX className="h-4 w-4" />
                <span>{t('cloudRevokeDevice')}</span>
              </button>
            ) : (
              <button
                type="button"
                className={ACCOUNT_SECONDARY_BUTTON_CLASS}
                disabled={busy || cloud.device.state === 'enrolling'}
                onClick={() => run(() => props.projection.enrollCloudDevice())}
              >
                <MonitorCheck className="h-4 w-4" />
                <span>{t('cloudEnrollDevice')}</span>
              </button>
            )}
            <button
              type="button"
              className={ACCOUNT_SECONDARY_BUTTON_CLASS}
              disabled={busy}
              onClick={() => run(() => props.projection.reauthenticateCloud(), true)}
            >
              <RefreshCw className="h-4 w-4" />
              <span>{t('cloudReauthenticate')}</span>
            </button>
            <button
              type="button"
              className={ACCOUNT_DANGER_BUTTON_CLASS}
              disabled={busy}
              onClick={() => run(() => props.projection.logoutCloud())}
            >
              <LogOut className="h-4 w-4" />
              <span>{t('cloudSignOut')}</span>
            </button>
          </div>
        </div>
      )}

      {pendingAction === 'login' ? (
        <p role="status" className="mt-3 text-ds-sm text-muted-foreground">
          {t('cloudSignInProgress')}
        </p>
      ) : null}
      {!busy && cloud?.error ? (
        <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-ds-sm text-destructive">
          {cloud.error.code && cloud.error.code in CLOUD_ERROR_MESSAGE
            ? t(CLOUD_ERROR_MESSAGE[cloud.error.code as keyof typeof CLOUD_ERROR_MESSAGE])
            : cloud.error.code?.startsWith('OIDC_')
              ? t('cloudErrorGeneric')
              : cloud.error.message}
        </p>
      ) : null}
      {!busy && diagnostic ? (
        <details key={`${diagnostic.code}:${diagnostic.stage}:${diagnostic.transportCodes.join(',')}`} className="mt-2 text-ds-sm text-muted-foreground">
          <summary className="cursor-pointer">{t('cloudErrorDetails')}</summary>
          <dl className="mt-2 space-y-1 break-words">
            <div><dt className="inline font-medium">{t('cloudErrorCode')}: </dt><dd className="inline">{diagnostic.code}</dd></div>
            {diagnostic.stage ? (
              <div><dt className="inline font-medium">{t('cloudErrorStage')}: </dt><dd className="inline">{t(diagnostic.stage)}</dd></div>
            ) : null}
            {diagnostic.transportCodes.length > 0 ? (
              <div><dt className="inline font-medium">{t('cloudErrorTransportCode')}: </dt><dd className="inline">{diagnostic.transportCodes.join(', ')}</dd></div>
            ) : null}
          </dl>
        </details>
      ) : null}
      {cloud?.error?.code === 'OIDC_CONFIGURATION_ERROR' && missingFields.length > 0 ? (
        <p className="mt-1 text-ds-sm text-destructive">
          {t('cloudSettingsMissing', { fields: missingFields.join(' / ') })}
        </p>
      ) : null}

      {!settingsOpen ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={ACCOUNT_GHOST_BUTTON_CLASS}
            aria-expanded="false"
            onClick={openSettings}
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.8} />
            <span>{t('cloudSettingsOpen')}</span>
          </button>
          {configurationSource ? (
            <span className="text-ds-2xs text-muted-foreground">{t(configurationSource)}</span>
          ) : null}
        </div>
      ) : null}

      {settingsOpen ? (
        <form
          className="mt-3 space-y-3 rounded-xl border border-ds-border bg-ds-card-muted p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (settingsBusy) return
            saveSettings()
          }}
        >
          <div>
            <h4 className="text-ds-md font-semibold text-ds-ink">{t('cloudSettingsTitle')}</h4>
            <p className="mt-1 text-ds-sm leading-5 text-ds-muted">{t('cloudSettingsDescription')}</p>
          </div>
          {missingFields.length > 0 ? (
            <p className="text-ds-sm text-[color:var(--ds-warning)]">
              {t('cloudSettingsMissing', { fields: missingFields.join(' / ') })}
            </p>
          ) : null}
          {configuration?.invalid.length ? (
            <p className="text-ds-sm text-destructive">{t('cloudSettingsInvalid')}</p>
          ) : null}
          <div className="space-y-1">
            <label className="block text-ds-sm font-medium text-ds-ink" htmlFor="identity-cloud-issuer">
              {t('cloudSettingsOidcIssuer')}
            </label>
            <input
              id="identity-cloud-issuer"
              className={ACCOUNT_INPUT_CLASS}
              value={issuerInput}
              maxLength={2_048}
              disabled={settingsBusy}
              placeholder="https://login.example.com/realms/SciForge"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setIssuerInput(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-ds-sm font-medium text-ds-ink" htmlFor="identity-cloud-base-url">
              {t('cloudSettingsCloudBaseUrl')}
            </label>
            <input
              id="identity-cloud-base-url"
              className={ACCOUNT_INPUT_CLASS}
              value={baseUrlInput}
              maxLength={2_048}
              disabled={settingsBusy}
              placeholder="https://cloud.example.com"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setBaseUrlInput(event.target.value)}
            />
          </div>
          {configuration?.storage === 'unavailable' ? (
            <p className="text-ds-sm text-destructive">{t('cloudSettingsStorageUnavailable')}</p>
          ) : null}
          {settingsError ? (
            <p role="alert" className="whitespace-pre-wrap break-words text-ds-sm text-destructive">
              {settingsError}
            </p>
          ) : null}
          {settingsSaved ? (
            <p className="text-ds-sm text-emerald-700 dark:text-emerald-300">
              {t('cloudSettingsSaved')}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={ACCOUNT_SECONDARY_BUTTON_CLASS}
              disabled={settingsBusy}
              onClick={() => setSettingsOpen(false)}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              className={ACCOUNT_PRIMARY_BUTTON_CLASS}
              disabled={settingsBusy || configuration?.storage === 'unavailable'}
            >
              {settingsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span>{t('save')}</span>
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
