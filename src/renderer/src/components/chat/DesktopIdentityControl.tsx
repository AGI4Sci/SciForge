import { type ReactElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
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
import type {
  DesktopDeviceStatus,
  DesktopIdentityStatus
} from '@shared/desktop-identity'

type MenuPosition = {
  right: number
  top: number
}

export function DesktopIdentityControl(): ReactElement {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<DesktopIdentityStatus>({ state: 'signed-out' })
  const [deviceStatus, setDeviceStatus] = useState<DesktopDeviceStatus>({ state: 'signed-out' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let identityEventSeen = false
    let deviceEventSeen = false
    if (typeof window.sciforge?.identity?.getStatus !== 'function') return
    const applyIdentityStatus = (next: DesktopIdentityStatus): void => {
      if (cancelled) return
      setStatus(next)
      if (next.state === 'signed-out') {
        setDeviceStatus({ state: 'signed-out' })
        setMenuOpen(false)
      }
    }
    const stopIdentity = typeof window.sciforge.identity.onStatusChanged === 'function'
      ? window.sciforge.identity.onStatusChanged((next) => {
          identityEventSeen = true
          applyIdentityStatus(next)
        })
      : () => undefined
    const stopDevice = typeof window.sciforge.identity.onDeviceStatusChanged === 'function'
      ? window.sciforge.identity.onDeviceStatusChanged((next) => {
          deviceEventSeen = true
          if (!cancelled) setDeviceStatus(next)
        })
      : () => undefined
    void window.sciforge.identity.getStatus()
      .then((next) => {
        if (cancelled || identityEventSeen) return
        applyIdentityStatus(next)
        if (next.state === 'signed-in') {
          void window.sciforge.identity.getDeviceStatus().then((device) => {
            if (!cancelled && !deviceEventSeen) {
              setDeviceStatus(device)
            }
          }).catch(() => undefined)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      stopDevice()
      stopIdentity()
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null)
      return
    }

    const updatePosition = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenuPosition({
        right: Math.max(8, window.innerWidth - rect.right),
        top: rect.bottom + 8
      })
    }
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    updatePosition()
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const login = async (): Promise<void> => {
    if (busy || typeof window.sciforge?.identity?.login !== 'function') return
    setBusy(true)
    setError(null)
    try {
      const result = await window.sciforge.identity.login()
      setStatus(result.status)
      if (!result.ok) setError(result.error.message)
      if (result.ok && result.status.state === 'signed-in') {
        const deviceResult = await window.sciforge.identity.enrollDevice()
        setDeviceStatus(deviceResult.status)
        if (!deviceResult.ok) setError(deviceResult.message)
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : t('desktopIdentityLoginFailed'))
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    if (busy || typeof window.sciforge?.identity?.logout !== 'function') return
    setBusy(true)
    setError(null)
    try {
      const result = await window.sciforge.identity.logout()
      setStatus(result.status)
      setDeviceStatus({ state: 'signed-out' })
      setMenuOpen(false)
      if (!result.ok) setError(result.error.message)
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : t('desktopIdentityLogoutFailed'))
    } finally {
      setBusy(false)
    }
  }

  const reauthenticate = async (): Promise<void> => {
    if (busy || typeof window.sciforge?.identity?.reauthenticate !== 'function') return
    setBusy(true)
    setError(null)
    try {
      const result = await window.sciforge.identity.reauthenticate()
      setStatus(result.status)
      if (!result.ok) setError(result.error.message)
    } catch (reauthenticationError) {
      setError(
        reauthenticationError instanceof Error
          ? reauthenticationError.message
          : t('desktopIdentityReauthenticationFailed')
      )
    } finally {
      setBusy(false)
    }
  }

  const enrollDevice = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.sciforge.identity.enrollDevice()
      setDeviceStatus(result.status)
      if (!result.ok) setError(result.message)
    } catch (deviceError) {
      setError(deviceError instanceof Error ? deviceError.message : t('desktopDeviceRegistrationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const revokeCurrentDevice = async (): Promise<void> => {
    if (busy || deviceStatus.state !== 'active') return
    setBusy(true)
    setError(null)
    try {
      const result = await window.sciforge.identity.revokeDevice(deviceStatus.device.deviceId)
      setDeviceStatus(result.status)
      if (!result.ok) setError(result.message)
    } catch (deviceError) {
      setError(deviceError instanceof Error ? deviceError.message : t('desktopDeviceRevokeFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (status.state === 'signed-out') {
    const label = error ? t('desktopIdentityLoginRetry') : t('desktopIdentityLogin')
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={() => void login()}
        disabled={busy}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition disabled:cursor-wait disabled:opacity-65 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
          error
            ? 'border-red-300 bg-red-50/90 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/45 dark:text-red-200'
            : 'border-ds-border-muted bg-white/55 text-ds-muted hover:border-ds-border-strong hover:bg-white/75 hover:text-ds-ink dark:bg-white/6 dark:hover:bg-white/10'
        }`}
        aria-label={label}
        title={error ?? t('desktopIdentityLoginTitle')}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : error ? (
          <CircleAlert className="h-4 w-4" strokeWidth={1.9} />
        ) : (
          <LogIn className="h-4 w-4" strokeWidth={1.9} />
        )}
        <span>{busy ? t('desktopIdentitySigningIn') : label}</span>
      </button>
    )
  }

  const user = status.user
  const menu = menuOpen && menuPosition ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('desktopIdentityAccountMenu')}
      style={{ right: menuPosition.right, top: menuPosition.top }}
      className="ds-card-strong fixed z-[1001] w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-ds-border p-3 shadow-[0_18px_52px_rgba(15,23,42,0.18)] backdrop-blur-xl dark:shadow-[0_22px_58px_rgba(0,0,0,0.38)]"
    >
      <div className="flex min-w-0 items-center gap-3 border-b border-ds-border-muted pb-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
          <UserRound className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-ds-ink">{user.displayName}</div>
          {user.email ? <div className="truncate text-[12px] text-ds-faint">{user.email}</div> : null}
        </div>
      </div>
      <div className="border-b border-ds-border-muted py-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-ds-muted">
          {deviceStatus.state === 'active' ? (
            <MonitorCheck className="h-4 w-4 text-emerald-600" strokeWidth={1.8} />
          ) : deviceStatus.state === 'revoked' ? (
            <MonitorX className="h-4 w-4 text-red-600" strokeWidth={1.8} />
          ) : deviceStatus.state === 'enrolling' ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          ) : (
            <CircleAlert className="h-4 w-4 text-amber-600" strokeWidth={1.8} />
          )}
          <span>
            {deviceStatus.state === 'active'
              ? t('desktopDeviceConnected')
              : deviceStatus.state === 'revoked'
                ? t('desktopDeviceRevoked')
                : deviceStatus.state === 'enrolling'
                  ? t('desktopDeviceRegistering')
                  : t('desktopDeviceNotConnected')}
          </span>
        </div>
        {deviceStatus.state === 'active' ? (
          <button
            type="button"
            onClick={() => void revokeCurrentDevice()}
            disabled={busy}
            className="mt-2 flex items-center gap-2 text-[12px] font-medium text-red-600 transition hover:text-red-700 disabled:opacity-60"
          >
            <MonitorX className="h-3.5 w-3.5" strokeWidth={1.8} />
            <span>{t('desktopDeviceRevoke')}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enrollDevice()}
            disabled={busy || deviceStatus.state === 'enrolling'}
            className="mt-2 flex items-center gap-2 text-[12px] font-medium text-accent transition hover:opacity-80 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} strokeWidth={1.8} />
            <span>{t('desktopDeviceRegister')}</span>
          </button>
        )}
        {error ? (
          <p role="alert" className="mt-2 whitespace-pre-wrap break-words text-[11px] text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => void reauthenticate()}
        disabled={busy}
        className="mt-2 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} strokeWidth={1.8} />
        <span>{t('desktopIdentityReauthenticate')}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => void logout()}
        disabled={busy}
        className="mt-2 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <LogOut className="h-4 w-4" strokeWidth={1.8} />
        )}
        <span>{t('desktopIdentityLogout')}</span>
      </button>
    </div>
  ) : null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="inline-flex h-8 max-w-[12rem] shrink-0 items-center gap-1.5 rounded-full border border-emerald-300/80 bg-emerald-50/90 px-2.5 text-[12.5px] font-semibold text-emerald-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-900/45"
        aria-label={t('desktopIdentitySignedInAs', { name: user.displayName })}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        title={t('desktopIdentitySignedInAs', { name: user.displayName })}
      >
        <UserRound className="h-4 w-4 shrink-0" strokeWidth={1.9} />
        <span className="min-w-0 truncate">{user.displayName}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" strokeWidth={1.9} />
      </button>
      {typeof document === 'undefined' ? menu : createPortal(menu, document.body)}
    </>
  )
}
