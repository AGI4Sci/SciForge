import { useEffect, useRef, useSyncExternalStore } from 'react'
import { ChevronRight, Cloud, Loader2, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cloudAccountStatus, type CloudStatusTone } from './cloud-status.js'
import type { IdentityRendererProjection } from './projection.js'
import {
  formatCompactTokens,
  formatUsageCost,
  type AccountUsageProjection
} from './usage.js'

const TONE_CLASS: Readonly<Record<CloudStatusTone, string>> = Object.freeze({
  muted: 'text-ds-faint',
  positive: 'text-ds-success',
  warning: 'text-[color:var(--ds-warning)]',
  critical: 'text-ds-danger'
})

const SIDEBAR_ROW_CLASS =
  'ds-button-plain flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-[var(--ds-sidebar-row-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export type AccountSidebarSectionProps = Readonly<{
  projection: IdentityRendererProjection
  usage: AccountUsageProjection
  className?: string
  onOpenAccount: () => void
  onOpenCloud: () => void
}>

/**
 * Always-visible account summary in the Workbench sidebar: who owns this
 * Desktop, the Cloud sign-in/device state, and today's token usage. The
 * section owns no sign-in or account mutation; both rows open the canonical
 * account overlay through the host's generic global-overlay extension point.
 */
export function AccountSidebarSection(
  props: AccountSidebarSectionProps
): React.JSX.Element {
  const { t, i18n } = useTranslation('identity')
  const snapshot = useSyncExternalStore(
    props.projection.subscribe,
    props.projection.getSnapshot
  )
  const usage = useSyncExternalStore(
    props.usage.subscribe,
    props.usage.getSnapshot
  )
  const locale = i18n?.language
  const available = snapshot.state?.status === 'available' ? snapshot.state : null
  const accountName = snapshot.cloud?.identity.state === 'signed-in' &&
      available?.currentAccount?.cloudIdentity?.cloudUserId === snapshot.cloud.identity.user.userId
    ? snapshot.cloud.identity.user.displayName
    : available?.currentAccount?.username ?? null
  const cloud = cloudAccountStatus(snapshot.cloud, snapshot.cloudLoading)
  const cloudName = snapshot.cloud?.identity.state === 'signed-in'
    ? snapshot.cloud.identity.user.displayName
    : null
  const cloudToneClass = TONE_CLASS[cloud.tone]
  const accountLabel = accountName ??
    (snapshot.state?.status === 'unavailable'
      ? t('unavailable')
      : snapshot.state
        ? t('accountSidebarNoAccount')
        : t('loading'))
  const identityLoadRequested = useRef(false)

  useEffect(() => {
    if (identityLoadRequested.current || snapshot.state || snapshot.loading) return
    identityLoadRequested.current = true
    void props.projection.load()
  }, [props.projection, snapshot.loading, snapshot.state])

  useEffect(() => {
    if (props.usage.getSnapshot().status === 'idle') {
      void props.usage.load()
    }
  }, [props.usage])

  return (
    <section
      className={`${props.className ?? ''} space-y-1 px-1.5`}
      aria-label={t('accountSidebarLabel')}
    >
      <button
        type="button"
        className={SIDEBAR_ROW_CLASS}
        aria-label={t('accountSidebarOpen')}
        onClick={props.onOpenAccount}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <UserRound className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-ds-sm font-medium text-ds-ink">
            {accountLabel}
          </strong>
          {accountName ? (
            <small className="block truncate text-ds-2xs text-ds-faint">
              {t('accountTitle')}
            </small>
          ) : snapshot.state?.status === 'available' ? (
            <small className="block truncate text-ds-2xs text-ds-faint">
              {t('accountSidebarCreateAccount')}
            </small>
          ) : null}
        </span>
        <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" aria-hidden="true" />
      </button>

      <button
        type="button"
        className={SIDEBAR_ROW_CLASS}
        aria-label={t('accountSidebarCloudOpen')}
        onClick={props.onOpenCloud}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ds-surface-subtle">
          {snapshot.cloudLoading ? (
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-ds-faint"
              aria-hidden="true"
            />
          ) : (
            <Cloud
              className={`h-3.5 w-3.5 ${cloudToneClass}`}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-ds-sm font-medium text-ds-ink">
            {cloudName ?? t(cloud.messageKey)}
          </strong>
          {cloudName ? (
            <small className={`block truncate text-ds-2xs ${cloudToneClass}`}>
              {t(cloud.messageKey)}
            </small>
          ) : null}
        </span>
        <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" aria-hidden="true" />
      </button>

      <div
        className="px-2 py-1.5 text-ds-2xs leading-4 text-ds-faint"
        data-account-usage={usage.status}
      >
        {usage.status === 'ready' && usage.today && usage.recent ? (
          <>
            <p className="truncate">
              {t('accountSidebarUsageToday', {
                tokens: formatCompactTokens(usage.today.totalTokens, locale),
                cost: formatUsageCost(usage.today.costUsd, locale, usage.today.costCny)
              })}
            </p>
            <p className="truncate">
              {t('accountSidebarUsageRecent', {
                days: usage.recentDays,
                tokens: formatCompactTokens(usage.recent.totalTokens, locale),
                cost: formatUsageCost(usage.recent.costUsd, locale, usage.recent.costCny)
              })}
            </p>
          </>
        ) : (
          <p className="truncate">
            {t(usage.status === 'error'
              ? 'accountSidebarUsageError'
              : usage.status === 'unsupported'
                ? 'accountSidebarUsageUnavailable'
                : 'accountSidebarUsageLoading')}
          </p>
        )}
      </div>
    </section>
  )
}
