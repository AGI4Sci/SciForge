import { useCallback, useEffect, useState, type FormEvent } from 'react'

import type { OpenContentConnectionStatus } from '../contract.js'
import type { OpenContentConnectionRendererClient } from './client.js'

export type OpenContentConnectionPanelProps = Readonly<{
  client: OpenContentConnectionRendererClient
  className?: string
  onCollapse?: () => void
}>

export function OpenContentConnectionPanel({
  client,
  className,
  onCollapse
}: OpenContentConnectionPanelProps) {
  const [connection, setConnection] = useState<OpenContentConnectionStatus>()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      setConnection(await client.status())
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setBusy(false)
    }
  }, [client])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true)
    setError('')
    try {
      const next = await client.bind(username, password)
      setConnection(next)
      setPassword('')
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setPassword('')
      setBusy(false)
    }
  }

  const unbind = async () => {
    setBusy(true)
    setError('')
    try {
      await client.unbind()
      setConnection({ state: 'disconnected' })
      setPassword('')
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={className ?? 'flex h-full flex-col gap-4 overflow-auto p-4'}>
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">OpenContent Connection</h2>
          <p className="text-xs text-muted-foreground">
            This binding belongs only to the current Local Account on this device.
          </p>
        </div>
        {onCollapse ? (
          <button type="button" className="rounded border px-2 py-1 text-xs" onClick={onCollapse}>
            Close
          </button>
        ) : null}
      </header>

      {connection?.state !== 'disconnected' ? (
        <div className="rounded border p-3 text-sm">
          <div className="font-medium">{connection?.externalAccount.name}</div>
          <div className="text-xs text-muted-foreground">{connection?.externalAccount.account}</div>
          <div className="mt-2 text-xs">
            {connection?.state === 'connected' ? 'Connected' : 'Reauthentication required'}
          </div>
          <button
            type="button"
            className="mt-3 rounded border px-3 py-1.5 text-sm"
            disabled={busy}
            onClick={() => void unbind()}
          >
            Unbind on this device
          </button>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <label className="flex flex-col gap-1 text-sm">
            OpenContent account
            <input
              autoComplete="username"
              className="rounded border bg-transparent px-3 py-2"
              disabled={busy}
              maxLength={256}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              autoComplete="current-password"
              className="rounded border bg-transparent px-3 py-2"
              disabled={busy}
              maxLength={1024}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            SciForge validates the credentials once and stores only the encrypted provider token.
          </p>
          <button
            type="submit"
            className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? 'Connecting…' : 'Connect existing account'}
          </button>
        </form>
      )}

      {connection?.state === 'reauthentication_required' ? (
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => setConnection({ state: 'disconnected' })}
        >
          Enter credentials again
        </button>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!connection && busy ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
    </section>
  )
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'OpenContent connection failed.'
}
