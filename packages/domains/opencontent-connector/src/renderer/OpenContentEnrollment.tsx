import {
  useEffect,
  useId,
  useRef,
  useState
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
  const [checking, setChecking] = useState(true)
  const [operation, setOperation] = useState<'bind' | 'unbind'>()
  const [notice, setNotice] = useState<EnrollmentNotice>()
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  useEffect(() => {
    requestSequence.current += 1
    activeRequest.current?.abort()
    activeRequest.current = undefined
    setConnection(undefined)
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

  const connect = async () => {
    if (operation) return
    const request = ++requestSequence.current
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setOperation('bind')
    setNotice(undefined)
    try {
      const result = await client.bind(providerInstanceRef, {
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
      onConnect={connect}
    />
  )
}

type EnrollmentActionProps = Readonly<{
  className: string
  reconnecting: boolean
  operation: 'bind' | 'unbind' | undefined
  notice: EnrollmentNotice | undefined
  onConnect: () => Promise<void>
}>

function EnrollmentAction({
  className,
  reconnecting,
  operation,
  notice,
  onConnect
}: EnrollmentActionProps) {
  const submitLabel = reconnecting ? 'Reconnect account' : 'Connect account'

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

      <div className="opencontent-enrollment__enrollment-action">
        <p className="opencontent-enrollment__privacy">
          Account authentication is collected by the private operating-system prompt. Nothing is entered in this window.
        </p>

        {notice ? (
          <p className="opencontent-enrollment__error" role="alert">
            {notice.message}
          </p>
        ) : null}

        <button
          type="button"
          className="opencontent-enrollment__button opencontent-enrollment__button--primary"
          disabled={Boolean(operation)}
          onClick={() => void onConnect()}
        >
          {operation === 'bind' ? 'Connecting…' : submitLabel}
        </button>
      </div>
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
        retry: true
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
    case 'native_enrollment_unavailable':
      return Object.freeze({
        message: 'Secure account enrollment is unavailable in this SciForge build.',
        retry: false
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
