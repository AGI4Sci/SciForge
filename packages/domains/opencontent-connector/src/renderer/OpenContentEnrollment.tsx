import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent
} from 'react'
import {
  Check,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  RotateCw,
  Unplug
} from 'lucide-react'

import {
  openContentConnectionResultSchema,
  type OpenContentConnectionResult,
  type OpenContentConnectionStatus,
  type OpenContentEnrollmentError
} from '../contract.js'
import type { OpenContentConnectionRendererClient } from './client.js'

import './OpenContentEnrollment.css'

type EnrollmentNotice = Readonly<{
  message: string
  retry: boolean
  fieldError?: boolean
}>

export type OpenContentEnrollmentProps = Readonly<{
  client: OpenContentConnectionRendererClient
  providerInstanceRef: string
  viewState: OpenContentEnrollmentViewState
  className?: string
  onConnectionChanged: () => void
}>

/**
 * Non-secret renderer state produced by the owning access read. It is scoped
 * to one Provider Instance and must never be persisted as connection state.
 */
export type OpenContentEnrollmentViewState = Readonly<
  | {
      phase: 'checking'
      providerInstanceRef: string
    }
  | {
      phase: 'resolved'
      providerInstanceRef: string
      result: OpenContentConnectionResult
    }
  | {
      phase: 'unavailable'
      providerInstanceRef: string
    }
>

export function isOpenContentEnrollmentViewState(
  value: unknown
): value is OpenContentEnrollmentViewState {
  if (!isRecord(value) || typeof value.providerInstanceRef !== 'string') return false
  if (value.phase === 'checking' || value.phase === 'unavailable') {
    return hasExactKeys(value, ['phase', 'providerInstanceRef'])
  }
  return value.phase === 'resolved' &&
    hasExactKeys(value, ['phase', 'providerInstanceRef', 'result']) &&
    openContentConnectionResultSchema.safeParse(value.result).success
}

/** Provider-owned fragment; its consumer owns source selection and panel chrome. */
export function OpenContentEnrollment({
  client,
  providerInstanceRef,
  viewState,
  className,
  onConnectionChanged
}: OpenContentEnrollmentProps) {
  const requestSequence = useRef(0)
  const activeRequest = useRef<AbortController | undefined>(undefined)
  const cancelDisconnect = useRef<HTMLButtonElement | null>(null)
  const disconnectConfirmationId = useId()
  const [connection, setConnection] = useState<OpenContentConnectionStatus>()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [checking, setChecking] = useState(true)
  const [operation, setOperation] = useState<'bind' | 'unbind'>()
  const [notice, setNotice] = useState<EnrollmentNotice>()
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  useEffect(() => {
    requestSequence.current += 1
    activeRequest.current?.abort()
    activeRequest.current = undefined
    setConnection(undefined)
    setAccount('')
    setPassword('')
    setNotice(undefined)
    setConfirmingDisconnect(false)
    setOperation(undefined)

    if (viewState.providerInstanceRef !== providerInstanceRef) {
      setChecking(false)
      setNotice(providerMismatchNotice)
    } else if (viewState.phase === 'checking') {
      setChecking(true)
    } else if (viewState.phase === 'unavailable') {
      setChecking(false)
      setNotice(genericStatusNotice)
    } else if (viewState.result.outcome === 'error') {
      setChecking(false)
      setNotice(noticeFor(viewState.result.error))
    } else if (!statusMatchesProvider(viewState.result.status, providerInstanceRef)) {
      setChecking(false)
      setNotice(providerMismatchNotice)
    } else {
      setChecking(false)
      setConnection(viewState.result.status)
    }

    return () => {
      requestSequence.current += 1
      activeRequest.current?.abort()
      activeRequest.current = undefined
    }
  }, [providerInstanceRef, viewState])

  useEffect(() => {
    if (confirmingDisconnect) cancelDisconnect.current?.focus()
  }, [confirmingDisconnect])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const submittedAccount = account.trim()
    if (!submittedAccount || !password || operation || activeRequest.current) return
    const credentials = {
      account: submittedAccount,
      password
    }
    setAccount('')
    setPassword('')
    const request = ++requestSequence.current
    const controller = new AbortController()
    activeRequest.current = controller
    setOperation('bind')
    setNotice(undefined)
    try {
      const binding = (() => {
        try {
          return client.bind(
            providerInstanceRef,
            credentials,
            { signal: controller.signal }
          )
        } finally {
          credentials.account = ''
          credentials.password = ''
        }
      })()
      const result = await binding
      if (request !== requestSequence.current) return
      if (result.outcome === 'error') {
        setNotice(noticeFor(result.error))
        return
      }
      if (!statusMatchesProvider(result.status, providerInstanceRef)) {
        setConnection(undefined)
        setNotice(providerMismatchNotice)
        return
      }
      setConnection(result.status)
      setConfirmingDisconnect(false)
      onConnectionChanged()
    } catch {
      if (request !== requestSequence.current) return
      setNotice(genericMutationNotice)
    } finally {
      if (activeRequest.current === controller) activeRequest.current = undefined
      if (request === requestSequence.current) setOperation(undefined)
    }
  }

  const disconnect = async () => {
    if (operation) return
    const request = ++requestSequence.current
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setOperation('unbind')
    setNotice(undefined)
    try {
      const result = await client.unbind(providerInstanceRef, {
        signal: controller.signal
      })
      if (request !== requestSequence.current) return
      if (result.outcome === 'error') {
        setNotice(noticeFor(result.error))
        return
      }
      setConnection({ state: 'disconnected' })
      setConfirmingDisconnect(false)
      onConnectionChanged()
    } catch {
      if (request !== requestSequence.current) return
      setNotice(genericMutationNotice)
    } finally {
      if (activeRequest.current === controller) activeRequest.current = undefined
      if (request === requestSequence.current) setOperation(undefined)
    }
  }

  const rootClassName = ['opencontent-enrollment', className]
    .filter(Boolean)
    .join(' ')
  const disconnectControl = confirmingDisconnect ? (
    <div
      className="opencontent-enrollment__confirmation"
      role="group"
      aria-labelledby={disconnectConfirmationId}
    >
      <div>
        <strong id={disconnectConfirmationId}>Disconnect on this device?</strong>
        <span>Your OpenContent account and remote files will not be deleted.</span>
      </div>
      <div className="opencontent-enrollment__actions">
        <button
          type="button"
          className="opencontent-enrollment__button opencontent-enrollment__button--danger"
          disabled={operation === 'unbind'}
          onClick={() => void disconnect()}
        >
          {operation === 'unbind' ? 'Disconnecting…' : 'Yes, disconnect'}
        </button>
        <button
          ref={cancelDisconnect}
          type="button"
          className="opencontent-enrollment__button opencontent-enrollment__button--quiet"
          disabled={operation === 'unbind'}
          onClick={() => setConfirmingDisconnect(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  ) : (
    <button
      type="button"
      className="opencontent-enrollment__button opencontent-enrollment__button--quiet"
      onClick={() => setConfirmingDisconnect(true)}
    >
      <Unplug aria-hidden="true" />
      Disconnect
    </button>
  )

  if (checking) {
    return (
      <section className={rootClassName} aria-busy="true">
        <div className="opencontent-enrollment__checking" role="status">
          <LoaderCircle aria-hidden="true" className="opencontent-enrollment__spinner" />
          <div>
            <strong>Checking account connection…</strong>
            <span>This usually takes only a moment.</span>
          </div>
        </div>
      </section>
    )
  }

  if (!connection) {
    return (
      <section className={rootClassName}>
        <div className="opencontent-enrollment__unavailable">
          <CircleAlert aria-hidden="true" />
          <div>
            <h3>Connection unavailable</h3>
            <p role="alert">{notice?.message ?? genericStatusNotice.message}</p>
            {notice?.retry !== false ? (
              <button
                type="button"
                className="opencontent-enrollment__button opencontent-enrollment__button--secondary"
                onClick={onConnectionChanged}
              >
                <RotateCw aria-hidden="true" />
                Try again
              </button>
            ) : null}
            {canDisconnectLocally(viewState, providerInstanceRef) ? (
              <div className="opencontent-enrollment__local-cleanup">
                {disconnectControl}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    )
  }

  if (connection.state === 'connected') {
    return (
      <section className={rootClassName}>
        <div className="opencontent-enrollment__connected">
          <div className="opencontent-enrollment__state" role="status">
            <span className="opencontent-enrollment__state-mark" aria-hidden="true">
              <Check />
            </span>
            <div>
              <h3>Account connected</h3>
              <p>Connected on this device.</p>
            </div>
          </div>

          <p className="opencontent-enrollment__privacy">
            This connection belongs to the current Local Account on this device.
          </p>

          {disconnectControl}

          {notice ? <p className="opencontent-enrollment__error" role="alert">{notice.message}</p> : null}
        </div>
      </section>
    )
  }

  return (
    <EnrollmentAction
      className={rootClassName}
      reconnecting={connection.state === 'reauthentication_required'}
      operation={operation}
      notice={notice}
      account={account}
      password={password}
      onAccountChange={setAccount}
      onPasswordChange={setPassword}
      onSubmit={submit}
    />
  )
}

type EnrollmentActionProps = Readonly<{
  className: string
  reconnecting: boolean
  operation: 'bind' | 'unbind' | undefined
  notice: EnrollmentNotice | undefined
  account: string
  password: string
  onAccountChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}>

function EnrollmentAction({
  className,
  reconnecting,
  operation,
  notice,
  account,
  password,
  onAccountChange,
  onPasswordChange,
  onSubmit
}: EnrollmentActionProps) {
  const submitLabel = reconnecting ? 'Reconnect account' : 'Connect account'
  const fieldId = useId()
  const accountId = `${fieldId}-account`
  const passwordId = `${fieldId}-password`
  const privacyId = `${fieldId}-privacy`
  const noticeId = `${fieldId}-notice`
  const passwordInput = useRef<HTMLInputElement | null>(null)
  const describedBy = notice ? `${privacyId} ${noticeId}` : privacyId

  useEffect(() => {
    if (notice?.fieldError) passwordInput.current?.focus()
  }, [notice])

  return (
    <section className={className}>
      <div className="opencontent-enrollment__intro">
        <span className="opencontent-enrollment__intro-icon" aria-hidden="true">
          <LockKeyhole />
        </span>
        <div>
          <h3>{reconnecting ? 'Reconnect OpenContent' : 'Connect OpenContent'}</h3>
          <p>
            {reconnecting
              ? 'Re-authorize the account already linked to this source.'
              : 'Link an existing account to open its libraries in Content Space.'}
          </p>
        </div>
      </div>

      {reconnecting && !notice ? (
        <p className="opencontent-enrollment__reauth" role="alert">
          Your saved session expired. Please sign in again to continue.
        </p>
      ) : null}

      {!reconnecting ? (
        <div className="opencontent-enrollment__state opencontent-enrollment__state--ready" role="status">
          <span className="opencontent-enrollment__ready-dot" aria-hidden="true" />
          <span>Ready to connect</span>
        </div>
      ) : null}

      <form
        className="opencontent-enrollment__form"
        autoComplete="off"
        onSubmit={(event) => void onSubmit(event)}
      >
        <label htmlFor={accountId}>
          <span>OpenContent account</span>
          <input
            id={accountId}
            name="account"
            autoComplete="off"
            data-visual-context-sensitive="true"
            aria-describedby={describedBy}
            aria-invalid={notice?.fieldError || undefined}
            disabled={Boolean(operation)}
            maxLength={256}
            spellCheck="false"
            value={account}
            onChange={(event) => onAccountChange(event.target.value)}
          />
        </label>
        <label htmlFor={passwordId}>
          <span>Password</span>
          <input
            ref={passwordInput}
            id={passwordId}
            name="password"
            autoComplete="off"
            data-visual-context-sensitive="true"
            aria-describedby={describedBy}
            aria-invalid={notice?.fieldError || undefined}
            disabled={Boolean(operation)}
            maxLength={4096}
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </label>

        <p id={privacyId} className="opencontent-enrollment__privacy">
          These credentials are used once to connect. SciForge stores only the encrypted Session Token for this Local Account on this device.
        </p>

        {notice ? (
          <p id={noticeId} className="opencontent-enrollment__error" role="alert">
            {notice.message}
          </p>
        ) : null}

        <button
          type="submit"
          className="opencontent-enrollment__button opencontent-enrollment__button--primary"
          disabled={Boolean(operation) || !account.trim() || !password}
        >
          {operation === 'bind' ? 'Connecting…' : submitLabel}
        </button>
      </form>
    </section>
  )
}

const genericStatusNotice: EnrollmentNotice = Object.freeze({
  message: 'We couldn’t check this OpenContent connection. Try again.',
  retry: true
})

const genericMutationNotice: EnrollmentNotice = Object.freeze({
  message: 'The connection could not be updated. Check your connection and try again.',
  retry: true
})

const providerMismatchNotice: EnrollmentNotice = Object.freeze({
  message: 'This OpenContent connection does not match the selected source. Select it again.',
  retry: false
})

function statusMatchesProvider(
  status: OpenContentConnectionStatus,
  providerInstanceRef: string
): boolean {
  return status.state === 'disconnected' ||
    status.providerInstanceRef === providerInstanceRef
}

function canDisconnectLocally(
  viewState: OpenContentEnrollmentViewState,
  providerInstanceRef: string
): boolean {
  if (viewState.providerInstanceRef !== providerInstanceRef) return false
  if (viewState.phase === 'unavailable') return true
  return viewState.phase === 'resolved' &&
    viewState.result.outcome === 'error' &&
    viewState.result.error.code !== 'invalid_provider_instance'
}

function noticeFor(error: OpenContentEnrollmentError): EnrollmentNotice {
  switch (error.code) {
    case 'invalid_provider_instance':
      return Object.freeze({
        message: 'This content source is no longer available. Select OpenContent again.',
        retry: false
      })
    case 'invalid_credentials':
      return Object.freeze({
        message: 'OpenContent did not accept the account authentication. Try again.',
        retry: true,
        fieldError: true
      })
    case 'provider_unavailable':
      return Object.freeze({
        message: 'OpenContent is temporarily unavailable. Check your connection and try again.',
        retry: true
      })
    case 'rate_limited':
      return Object.freeze({
        message: 'OpenContent is receiving too many requests. Try again in a few minutes.',
        retry: true
      })
    case 'provider_contract_violation':
      return Object.freeze({
        message: 'OpenContent returned an unexpected response. Contact support if this continues.',
        retry: true
      })
    case 'secure_storage_unavailable':
      return Object.freeze({
        message: 'Secure storage is unavailable on this device. Unlock or repair it, then try again.',
        retry: true
      })
    case 'enrollment_in_progress':
      return Object.freeze({
        message: 'Another OpenContent connection is already in progress. Try again shortly.',
        retry: true
      })
    case 'cancelled':
      return Object.freeze({
        message: 'The connection attempt was cancelled. Try again when you’re ready.',
        retry: true
      })
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
