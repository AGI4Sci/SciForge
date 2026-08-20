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
  const [username, setUsername] = useState('')
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
    setUsername('')
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
      if (viewState.result.status.state !== 'disconnected') {
        setUsername(viewState.result.status.externalAccount.account)
      }
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
    const account = username.trim()
    if (!account || !password || operation) return
    const request = ++requestSequence.current
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setOperation('bind')
    setNotice(undefined)
    try {
      const result = await client.bind(providerInstanceRef, account, password, {
        signal: controller.signal
      })
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
      setUsername(account)
      setConnection(result.status)
      setConfirmingDisconnect(false)
      onConnectionChanged()
    } catch {
      if (request !== requestSequence.current) return
      setNotice(genericMutationNotice)
    } finally {
      if (activeRequest.current === controller) activeRequest.current = undefined
      if (request === requestSequence.current) {
        setPassword('')
        setOperation(undefined)
      }
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
      setPassword('')
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

          <dl className="opencontent-enrollment__account">
            <div>
              <dt>Account name</dt>
              <dd>{connection.externalAccount.name}</dd>
            </div>
            <div>
              <dt>OpenContent account</dt>
              <dd>{connection.externalAccount.account}</dd>
            </div>
          </dl>

          <p className="opencontent-enrollment__privacy">
            This connection belongs to the current Local Account on this device.
          </p>

          {confirmingDisconnect ? (
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
          )}

          {notice ? <p className="opencontent-enrollment__error" role="alert">{notice.message}</p> : null}
        </div>
      </section>
    )
  }

  return (
    <CredentialForm
      className={rootClassName}
      reconnecting={connection.state === 'reauthentication_required'}
      username={username}
      password={password}
      operation={operation}
      notice={notice}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onSubmit={submit}
    />
  )
}

type CredentialFormProps = Readonly<{
  className: string
  reconnecting: boolean
  username: string
  password: string
  operation: 'bind' | 'unbind' | undefined
  notice: EnrollmentNotice | undefined
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}>

function CredentialForm({
  className,
  reconnecting,
  username,
  password,
  operation,
  notice,
  onUsernameChange,
  onPasswordChange,
  onSubmit
}: CredentialFormProps) {
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
              ? 'Update the credentials for the account already linked to this source.'
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

      <form className="opencontent-enrollment__form" onSubmit={(event) => void onSubmit(event)}>
        <label htmlFor={accountId}>
          <span>OpenContent account</span>
          <input
            id={accountId}
            name="username"
            autoComplete="username"
            aria-describedby={describedBy}
            aria-invalid={notice?.fieldError || undefined}
            disabled={Boolean(operation)}
            maxLength={256}
            spellCheck="false"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
          />
        </label>
        <label htmlFor={passwordId}>
          <span>Password</span>
          <input
            ref={passwordInput}
            id={passwordId}
            name="password"
            autoComplete="current-password"
            aria-describedby={describedBy}
            aria-invalid={notice?.fieldError || undefined}
            disabled={Boolean(operation)}
            maxLength={1024}
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </label>

        <p id={privacyId} className="opencontent-enrollment__privacy">
          Your password is checked once. SciForge stores only an encrypted access token for this Local Account on this device.
        </p>

        {notice ? (
          <p id={noticeId} className="opencontent-enrollment__error" role="alert">
            {notice.message}
          </p>
        ) : null}

        <button
          type="submit"
          className="opencontent-enrollment__button opencontent-enrollment__button--primary"
          disabled={Boolean(operation) || !username.trim() || !password}
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

function noticeFor(error: OpenContentEnrollmentError): EnrollmentNotice {
  switch (error.code) {
    case 'invalid_provider_instance':
      return Object.freeze({
        message: 'This content source is no longer available. Select OpenContent again.',
        retry: false
      })
    case 'invalid_credentials':
      return Object.freeze({
        message: 'The OpenContent account or password was not accepted. Check both and try again.',
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
