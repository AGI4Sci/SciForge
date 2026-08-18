import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { IDENTITY_RESET_CONFIRMATION } from '../contract.js'
import type { IdentityRendererProjection } from './projection.js'

export function IdentityAccountOverlay(props: Readonly<{
  projection: IdentityRendererProjection
  firstRun: boolean
  onClose: () => void
}>): React.JSX.Element {
  const { t } = useTranslation('identity')
  const snapshot = useSyncExternalStore(props.projection.subscribe, props.projection.getSnapshot)
  const [username, setUsername] = useState('')
  const [renameUserId, setRenameUserId] = useState<string | null>(null)
  const [resetText, setResetText] = useState('')
  const [backupPath, setBackupPath] = useState<string | null>(null)
  const availableState = snapshot.state?.status === 'available' ? snapshot.state : null

  useEffect(() => {
    void props.projection.load()
  }, [props.projection])

  const run = (operation: () => Promise<unknown>): void => {
    void operation().catch(() => undefined)
  }
  const closeFirstRun = (): void => {
    if (props.firstRun) run(() => props.projection.dismissFirstPrompt())
    props.onClose()
  }

  return (
    <div
      className={props.firstRun
        ? 'pointer-events-none fixed inset-0 z-[100] flex items-start justify-end p-4 pt-16'
        : 'fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4'}
      role="presentation"
    >
      <section
        className={`${props.firstRun ? 'pointer-events-auto' : ''} max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl border border-border bg-background p-5 shadow-2xl`}
        role="dialog"
        aria-modal={props.firstRun ? 'false' : 'true'}
        aria-labelledby="identity-account-title"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="identity-account-title" className="text-base font-semibold">{t('accountTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('optionalNotice')}</p>
          </div>
          <button type="button" className="rounded px-2 py-1 text-sm hover:bg-muted" onClick={closeFirstRun}>
            {props.firstRun ? t('dismiss') : t('close')}
          </button>
        </div>

        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          {t('assuranceNotice')}
        </p>

        {snapshot.state?.status === 'unavailable' ? (
          <div className="mt-5 space-y-3">
            <h3 className="font-medium">{t('recoveryTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('recoveryNotice')}</p>
            <input
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              value={resetText}
              aria-label={t('resetConfirmation')}
              placeholder={t('resetConfirmation')}
              onChange={(event) => setResetText(event.target.value)}
            />
            <button
              type="button"
              className="rounded bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50"
              disabled={snapshot.loading || resetText !== IDENTITY_RESET_CONFIRMATION}
              onClick={() => run(async () => {
                setBackupPath(await props.projection.backupAndReset(resetText))
                setResetText('')
              })}
            >
              {t('reset')}
            </button>
            {backupPath ? <p className="break-all text-xs">{t('backupCreated', { path: backupPath })}</p> : null}
          </div>
        ) : (
          <>
            <form
              className="mt-5 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (!username.trim() || !globalThis.confirm(t('createConfirmation'))) return
                run(async () => {
                  await props.projection.createAccount(username)
                  setUsername('')
                })
              }}
            >
              <label className="sr-only" htmlFor="identity-new-username">{t('username')}</label>
              <input
                id="identity-new-username"
                className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm"
                value={username}
                maxLength={128}
                placeholder={t('username')}
                onChange={(event) => setUsername(event.target.value)}
              />
              <button type="submit" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">
                {t('create')}
              </button>
            </form>

            <ul className="mt-4 space-y-2">
              {snapshot.accounts.map((account) => (
                <li key={account.userId} className="flex items-center gap-2 rounded border border-border p-2">
                  {renameUserId === account.userId ? (
                    <input
                      className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
                      defaultValue={account.username}
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        const next = event.currentTarget.value
                        run(async () => {
                          await props.projection.renameAccount(account.userId, next)
                          setRenameUserId(null)
                        })
                      }}
                    />
                  ) : <span className="min-w-0 flex-1 truncate text-sm">{account.username}</span>}
                  {availableState?.currentAccount?.userId === account.userId ? (
                    <span className="text-xs text-muted-foreground">✓</span>
                  ) : (
                    <button type="button" className="rounded px-2 py-1 text-xs hover:bg-muted" onClick={() => run(() => props.projection.selectAccount(account.userId))}>
                      {t('select')}
                    </button>
                  )}
                  <button type="button" className="rounded px-2 py-1 text-xs hover:bg-muted" onClick={() => setRenameUserId(account.userId)}>
                    {t('rename')}
                  </button>
                </li>
              ))}
            </ul>

            {availableState?.currentAccount ? (
              <button type="button" className="mt-4 rounded border border-border px-3 py-2 text-sm" onClick={() => run(() => props.projection.exitAccount())}>
                {t('exit')}
              </button>
            ) : null}
          </>
        )}

        {snapshot.loading ? <p className="mt-3 text-xs text-muted-foreground">{t('loading')}</p> : null}
        {snapshot.error ? <p role="alert" className="mt-3 text-sm text-destructive">{snapshot.error}</p> : null}
      </section>
    </div>
  )
}
