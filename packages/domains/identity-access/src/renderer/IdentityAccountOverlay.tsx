import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Check,
  LogOut,
  Plus,
  Trash2,
  TriangleAlert,
  UserRound,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IDENTITY_RESET_CONFIRMATION } from '../contract.js'
import {
  ACCOUNT_DANGER_BUTTON_CLASS,
  ACCOUNT_DANGER_ICON_BUTTON_CLASS,
  ACCOUNT_GHOST_BUTTON_CLASS,
  ACCOUNT_ICON_BUTTON_CLASS,
  ACCOUNT_INPUT_CLASS,
  ACCOUNT_PRIMARY_BUTTON_CLASS,
  ACCOUNT_SECONDARY_BUTTON_CLASS,
  accountInitial
} from './account-ui.js'
import { CloudIdentitySection } from './CloudIdentitySection.js'
import type { IdentityRendererProjection } from './projection.js'

export function IdentityAccountOverlay(props: Readonly<{
  projection: IdentityRendererProjection
  firstRun: boolean
  focusSection?: 'cloud' | null
  onClose: () => void
}>): React.JSX.Element {
  const { t } = useTranslation('identity')
  const snapshot = useSyncExternalStore(props.projection.subscribe, props.projection.getSnapshot)
  const [username, setUsername] = useState('')
  const [pendingUsername, setPendingUsername] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [renameUserId, setRenameUserId] = useState<string | null>(null)
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null)
  const [resetText, setResetText] = useState('')
  const [backupPath, setBackupPath] = useState<string | null>(null)
  const creatingAccount = useRef(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const cloudSection = useRef<HTMLDivElement>(null)
  const availableState = snapshot.state?.status === 'available' ? snapshot.state : null
  const closeLabel = props.firstRun ? t('dismiss') : t('close')

  useEffect(() => {
    void props.projection.load()
  }, [props.projection])

  useEffect(() => {
    if (props.focusSection !== 'cloud') return
    const target = cloudSection.current
    target?.scrollIntoView?.({ block: 'start' })
    target?.focus()
  }, [props.focusSection])

  // Move keyboard focus into the dialog on open. The first-run prompt is a
  // non-modal notice, so it must not steal focus from the workbench.
  useEffect(() => {
    if (props.firstRun || props.focusSection === 'cloud') return
    closeButton.current?.focus()
  }, [props.firstRun, props.focusSection])

  const run = (operation: () => Promise<unknown>): void => {
    void operation().catch(() => undefined)
  }
  const closeFirstRun = (): void => {
    if (props.firstRun) run(() => props.projection.dismissFirstPrompt())
    props.onClose()
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    closeFirstRun()
  }

  return (
    <div
      className={props.firstRun
        ? 'pointer-events-none fixed inset-0 z-[100] flex items-start justify-end p-4 pt-16'
        : 'fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4'}
      role="presentation"
    >
      <section
        className={`${props.firstRun ? 'pointer-events-auto' : ''} flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card text-ds-ink shadow-panel`}
        role="dialog" data-native-view-occluder="true"
        aria-modal={props.firstRun ? 'false' : 'true'}
        aria-labelledby="identity-account-title"
        aria-describedby="identity-account-subtitle"
        onKeyDown={onKeyDown}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-ds-border px-5 py-4">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
          >
            <UserRound className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="identity-account-title" className="truncate text-ds-xl font-semibold text-ds-ink">
              {t('accountTitle')}
            </h2>
            <p id="identity-account-subtitle" className="mt-0.5 text-ds-sm leading-5 text-ds-muted">
              {t('optionalNotice')}
            </p>
          </div>
          <button
            ref={closeButton}
            type="button"
            className={ACCOUNT_ICON_BUTTON_CLASS}
            aria-label={closeLabel}
            title={closeLabel}
            onClick={closeFirstRun}
          >
            <X className="h-4 w-4" aria-hidden="true" strokeWidth={1.8} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="flex items-start gap-2 text-ds-sm leading-5 text-ds-muted">
            <TriangleAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--ds-warning)]"
              aria-hidden="true"
              strokeWidth={1.8}
            />
            <span>{t('assuranceNotice')}</span>
          </p>

          <div className="mt-4 space-y-4">
            {snapshot.state?.status === 'unavailable' ? (
              <div className="space-y-3 rounded-xl border border-ds-border bg-ds-card-muted p-4">
                <h3 className="flex items-center gap-2 text-ds-md font-semibold text-ds-ink">
                  <TriangleAlert
                    className="h-4 w-4 shrink-0 text-[color:var(--ds-warning)]"
                    aria-hidden="true"
                    strokeWidth={1.8}
                  />
                  {t('recoveryTitle')}
                </h3>
                <p className="text-ds-sm leading-5 text-ds-muted">{t('recoveryNotice')}</p>
                <input
                  className={ACCOUNT_INPUT_CLASS}
                  value={resetText}
                  aria-label={t('resetConfirmation')}
                  placeholder={t('resetConfirmation')}
                  onChange={(event) => setResetText(event.target.value)}
                />
                <button
                  type="button"
                  className={ACCOUNT_DANGER_BUTTON_CLASS}
                  disabled={snapshot.loading || resetText !== IDENTITY_RESET_CONFIRMATION}
                  onClick={() => run(async () => {
                    setBackupPath(await props.projection.backupAndReset(resetText))
                    setResetText('')
                  })}
                >
                  {t('reset')}
                </button>
                {backupPath ? (
                  <p className="break-all text-ds-sm text-ds-muted">{t('backupCreated', { path: backupPath })}</p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!username.trim() || snapshot.loading || pendingUsername !== null) return
                    setPendingUsername(username)
                  }}
                >
                  <label className="sr-only" htmlFor="identity-new-username">{t('username')}</label>
                  <input
                    id="identity-new-username"
                    aria-describedby={!username.trim() ? 'identity-username-hint' : undefined}
                    className={`${ACCOUNT_INPUT_CLASS} min-w-0 flex-1`}
                    value={username}
                    maxLength={128}
                    disabled={snapshot.loading || pendingUsername !== null}
                    placeholder={t('username')}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                  <button
                    type="submit"
                    className={ACCOUNT_PRIMARY_BUTTON_CLASS}
                    disabled={!username.trim() || snapshot.loading || pendingUsername !== null}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
                    <span>{t('create')}</span>
                  </button>
                </form>

                {!username.trim() ? (
                  <p id="identity-username-hint" className="text-ds-sm text-ds-muted">
                    {t('usernameRequiredHint')}
                  </p>
                ) : null}

                {pendingUsername !== null ? (
                  <div
                    className="rounded-xl border border-ds-border bg-ds-card-muted p-3"
                    role="group"
                    aria-label={t('createConfirmation')}
                  >
                    <p className="text-ds-sm text-ds-muted">{t('createConfirmation')}</p>
                    <p className="mt-1 break-words text-ds-md font-medium text-ds-ink">{pendingUsername}</p>
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        className={ACCOUNT_SECONDARY_BUTTON_CLASS}
                        disabled={snapshot.loading}
                        onClick={() => setPendingUsername(null)}
                      >
                        {t('cancel')}
                      </button>
                      <button
                        type="button"
                        className={ACCOUNT_PRIMARY_BUTTON_CLASS}
                        disabled={snapshot.loading}
                        onClick={() => {
                          if (creatingAccount.current) return
                          creatingAccount.current = true
                          const confirmedUsername = pendingUsername
                          run(async () => {
                            try {
                              await props.projection.createAccount(confirmedUsername)
                              setUsername('')
                              setPendingUsername(null)
                            } finally {
                              creatingAccount.current = false
                            }
                          })
                        }}
                      >
                        {t('confirmCreation')}
                      </button>
                    </div>
                  </div>
                ) : null}

                <ul className="space-y-2" aria-label={t('accountTitle')}>
                  {snapshot.accounts.map((account) => {
                    const current = availableState?.currentAccount?.userId === account.userId
                    const renaming = renameUserId === account.userId
                    return (
                      <li
                        key={account.userId}
                        data-identity-account-row=""
                        aria-current={current ? 'true' : undefined}
                        className={`rounded-xl border bg-ds-card-muted px-3 py-2.5 transition ${current ? 'border-accent' : 'border-ds-border'}`}
                      >
                        {renaming && account.cloudIdentity ? <p className="mb-2 text-ds-xs text-ds-muted">{t('cloudRenameNotice')}</p> : null}
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-ds-2xs font-semibold uppercase ${current ? 'bg-accent-soft text-accent' : 'bg-ds-surface-subtle text-ds-muted'}`}
                          >
                            {accountInitial(account.username)}
                          </span>
                          {renaming ? (
                            <input
                              className="min-w-0 flex-1 rounded-lg border border-accent bg-ds-surface-subtle px-2 py-1 text-ds-sm text-ds-ink outline-none focus:ring-2 focus:ring-accent-soft"
                              value={renameText}
                              disabled={snapshot.loading}
                              onChange={(event) => setRenameText(event.target.value)}
                              aria-label={t('rename')}
                              autoFocus
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') { event.stopPropagation(); setRenameUserId(null); return }
                                if (event.key !== 'Enter' || snapshot.loading || event.nativeEvent.isComposing) return
                                const next = event.currentTarget.value
                                run(async () => {
                                  await props.projection.renameAccount(account.userId, next)
                                  setRenameUserId(null)
                                })
                              }}
                            />
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-ds-md font-medium text-ds-ink">
                              {account.username}
                            </span>
                          )}
                          {current ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-ds-2xs font-medium text-accent">
                              <Check className="h-3 w-3" aria-hidden="true" strokeWidth={2.4} />
                              <span>{t('currentAccount')}</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={ACCOUNT_GHOST_BUTTON_CLASS}
                              onClick={() => run(() => props.projection.selectAccount(account.userId))}
                            >
                              {t('select')}
                            </button>
                          )}
                          <button
                            type="button"
                            className={ACCOUNT_GHOST_BUTTON_CLASS}
                            disabled={snapshot.loading || (renaming && !renameText.trim())}
                            onClick={() => {
                              if (renaming) {
                                run(async () => {
                                  await props.projection.renameAccount(account.userId, renameText)
                                  setRenameUserId(null)
                                })
                              } else {
                                setRenameText(account.username)
                                setRenameUserId(account.userId)
                              }
                            }}
                          >
                            {t(renaming ? 'save' : 'rename')}
                          </button>
                          {renaming ? <button type="button" className={ACCOUNT_GHOST_BUTTON_CLASS}
                            disabled={snapshot.loading} onClick={() => setRenameUserId(null)}>{t('cancel')}</button> : null}
                          <button
                            type="button"
                            className={ACCOUNT_DANGER_ICON_BUTTON_CLASS}
                            aria-label={t('deleteAccountLabel', { username: account.username })}
                            title={t('deleteAccountLabel', { username: account.username })}
                            disabled={snapshot.loading}
                            onClick={() => setDeletingAccountId(account.userId)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.8} />
                          </button>
                        </div>
                        {deletingAccountId === account.userId ? (
                          <div
                            className="mt-2 rounded-lg border border-ds-border bg-ds-surface-subtle p-2.5"
                            role="group"
                            aria-label={t('deleteAccount')}
                          >
                            <p className="text-ds-sm leading-5 text-ds-ink">
                              {t('deleteAccountConfirm', { username: account.username })}
                            </p>
                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                type="button"
                                className={ACCOUNT_SECONDARY_BUTTON_CLASS}
                                disabled={snapshot.loading}
                                onClick={() => setDeletingAccountId(null)}
                              >
                                {t('cancel')}
                              </button>
                              <button
                                type="button"
                                className={ACCOUNT_DANGER_BUTTON_CLASS}
                                disabled={snapshot.loading}
                                onClick={() => {
                                  run(async () => {
                                    await props.projection.deleteAccount(account.userId)
                                    setDeletingAccountId(null)
                                  })
                                }}
                              >
                                {t('deleteAccountConfirmAction')}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>

                {availableState?.currentAccount ? (
                  <button
                    type="button"
                    className={ACCOUNT_GHOST_BUTTON_CLASS}
                    onClick={() => run(() => props.projection.exitAccount())}
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.8} />
                    <span>{t('exit')}</span>
                  </button>
                ) : null}
              </div>
            )}

            <div
              ref={cloudSection}
              tabIndex={-1}
              className="focus:outline-none"
              data-identity-cloud-section={props.focusSection === 'cloud' ? 'focused' : undefined}
            >
              <CloudIdentitySection
                projection={props.projection}
                localAccountSelected={Boolean(availableState?.currentAccount)}
              />
            </div>
          </div>

          {snapshot.loading ? <p className="mt-3 text-ds-2xs text-ds-muted">{t('loading')}</p> : null}
          {snapshot.error ? <p role="alert" className="mt-3 text-ds-sm text-ds-danger">{snapshot.error}</p> : null}
        </div>
      </section>
    </div>
  )
}
