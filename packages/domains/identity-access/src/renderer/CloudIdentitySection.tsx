import { useSyncExternalStore } from 'react'
import {
  CircleAlert,
  Loader2,
  LogIn,
  LogOut,
  MonitorCheck,
  MonitorX,
  RefreshCw,
  UserRound
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IdentityRendererProjection } from './projection.js'

const DEVICE_STATUS_MESSAGE = Object.freeze({
  'signed-out': 'cloudDeviceNotEnrolled',
  'not-enrolled': 'cloudDeviceNotEnrolled',
  enrolling: 'cloudDeviceEnrolling',
  active: 'cloudDeviceActive',
  revoked: 'cloudDeviceRevoked',
  error: 'cloudDeviceError'
} as const)

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
  const busy = snapshot.cloudLoading
  const activeDeviceId = cloud?.device.state === 'active'
    ? cloud.device.device.deviceId
    : null
  const run = (operation: () => Promise<void>): void => {
    void operation().catch(() => undefined)
  }

  return (
    <section className="mt-5 border-t border-border pt-5" aria-labelledby="cloud-identity-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="cloud-identity-title" className="text-sm font-semibold">
            {t('cloudTitle')}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('cloudNotice')}</p>
        </div>
        {busy ? (
          <Loader2
            className="h-4 w-4 animate-spin text-muted-foreground"
            aria-label={t('loading')}
          />
        ) : null}
      </div>

      {!cloud ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('cloudLoading')}</p>
      ) : cloud.identity.state === 'signed-out' ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserRound className="h-4 w-4" strokeWidth={1.8} />
            <span>{t('cloudSignedOut')}</span>
          </div>
          {!props.localAccountSelected ? (
            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span>{t('cloudLocalAccountRequired')}</span>
            </p>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || !props.localAccountSelected}
            onClick={() => run(() => props.projection.loginCloud())}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            <span>{t('cloudSignIn')}</span>
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserRound className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{cloud.identity.user.displayName}</p>
              {cloud.identity.user.email ? (
                <p className="truncate text-xs text-muted-foreground">{cloud.identity.user.email}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            {cloud.device.state === 'active' ? (
              <MonitorCheck className="h-4 w-4 text-emerald-600" strokeWidth={1.8} />
            ) : cloud.device.state === 'revoked' ? (
              <MonitorX className="h-4 w-4 text-destructive" strokeWidth={1.8} />
            ) : cloud.device.state === 'enrolling' ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : (
              <CircleAlert className="h-4 w-4 text-amber-600" strokeWidth={1.8} />
            )}
            <span>{t(DEVICE_STATUS_MESSAGE[cloud.device.state])}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {activeDeviceId ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-50"
                disabled={busy}
                onClick={() => run(() => props.projection.revokeCloudDevice(activeDeviceId))}
              >
                <MonitorX className="h-4 w-4" />
                <span>{t('cloudRevokeDevice')}</span>
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
                disabled={busy || cloud.device.state === 'enrolling'}
                onClick={() => run(() => props.projection.enrollCloudDevice())}
              >
                <MonitorCheck className="h-4 w-4" />
                <span>{t('cloudEnrollDevice')}</span>
              </button>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => run(() => props.projection.reauthenticateCloud())}
            >
              <RefreshCw className="h-4 w-4" />
              <span>{t('cloudReauthenticate')}</span>
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => run(() => props.projection.logoutCloud())}
            >
              <LogOut className="h-4 w-4" />
              <span>{t('cloudSignOut')}</span>
            </button>
          </div>
        </div>
      )}

      {cloud?.error ? (
        <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-xs text-destructive">
          {cloud.error.message}
        </p>
      ) : null}
    </section>
  )
}
