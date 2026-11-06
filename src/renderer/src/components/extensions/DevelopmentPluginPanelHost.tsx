import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { DomainExtensionRendererContribution } from '@shared/domain-extensions'

type PluginPanelMessage = Readonly<{
  type?: unknown
  requestId?: unknown
  capabilityId?: unknown
  payload?: unknown
  actionId?: unknown
  input?: unknown
  approval?: unknown
}>

/** What the frame may ask the host to do besides invoking capabilities. */
export type PluginPanelHostServices = Readonly<{
  sendMessage?: (input: Readonly<{ sessionId?: string; text: string; displayText?: string }>) =>
    Promise<{ ok: true } | { ok: false; error: { message: string } }>
}>

type InventoryResponse = Readonly<{
  type: 'inventory.result'
  requestId: string
  ok: true
  inventory: Awaited<ReturnType<NonNullable<typeof window.sciforge>['extensions']['list']>>
}> | Readonly<{
  type: 'inventory.result'
  requestId: string
  ok: false
  error: { code: 'PLUGIN_INVENTORY_UNAVAILABLE' | 'PLUGIN_INVENTORY_ACCESS_REVOKED'; message: string }
}>

type CapabilityResponse = Readonly<{
  type: 'capability.result'
  requestId: string
  ok: true
  output: unknown
}> | Readonly<{
  type: 'capability.result'
  requestId: string
  ok: false
  error: { code: 'CAPABILITY_NOT_ALLOWED' | 'CAPABILITY_UNAVAILABLE' | 'CAPABILITY_REJECTED'; message: string }
}>

/** Largest frame payload accepted across the boundary (defense against a runaway plugin). */
const MAX_FRAME_INPUT_CHARS = 8 * 1024 * 1024
const CAPABILITY_TIMEOUT_MS = 120_000

export function developmentRendererPanelId(
  contribution: Pick<DomainExtensionRendererContribution, 'pluginId' | 'contributionId'>
): string {
  return `development:${contribution.pluginId}:${contribution.contributionId}`
}

type Props = Readonly<{
  contribution: DomainExtensionRendererContribution
  active: boolean
  className?: string
/** Workspace the panel operates on; `undefined` keeps capability calls closed. */
  workspaceRoot?: string
  /** Host-owned session facts the panel may read; never taken from the iframe. */
  sessionId?: string
  runtimeId?: string
  activation?: Readonly<{ contributionId: string; revision: number; payload: unknown }> | null
  /** Host-owned close action for the panel's collapse control. */
  onClose?: () => void
  /** Host services the frame may use (composer injection). Absent = unavailable. */
  services?: PluginPanelHostServices
}>

/**
 * Hosts development UI in an opaque-origin sandbox. Only the small message
 * protocol below crosses the iframe boundary; the plugin never receives the
 * Electron bridge or the parent window object.
 *
 * `capability.invoke` is a *transport* shim, not new authority: the frame may
 * only name ids from `contribution.capabilityIds` (host-computed from the
 * approved contract), and the call then takes the ordinary renderer capability
 * path — same caller, same workspace, same approval and audit rules.
 */
export function DevelopmentPluginPanelHost({ contribution, active, className = '', workspaceRoot, sessionId, runtimeId, activation, onClose, services }: Props): ReactElement {
  const { t, i18n } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const { pluginId, contributionId, generation, version, stateVersion, entryUrl } = contribution
  const frameKey = JSON.stringify([pluginId, contributionId, generation, version, entryUrl, retry])
  // Deserialized contributions may contain a new array on every inventory poll.
  const capabilitySignature = JSON.stringify([...new Set(
    Array.isArray(contribution.capabilityIds) ? contribution.capabilityIds.filter((id) => typeof id === 'string') : []
  )].sort())
  const allowed = useMemo(() => new Set<string>(JSON.parse(capabilitySignature)), [capabilitySignature])
  const callbacksRef = useRef({ onClose, services })
  const activationRef = useRef(activation)
  const readyReceivedRef = useRef(false)
  callbacksRef.current = { onClose, services }
  activationRef.current = activation
  // Activation revisions identify host-owned events, independent of object identity.
  const activationContributionId = activation?.contributionId
  const activationRevision = activation?.revision

  // A callback or presentation update may replace the listener while a request
  // is in flight. Only a frame or authority change invalidates its response.
  const responseLifetime = useRef({ active: false })
  useEffect(() => {
    const lifetime = { active: true }
    responseLifetime.current = lifetime
    return () => { lifetime.active = false }
  }, [frameKey, workspaceRoot, sessionId, runtimeId, capabilitySignature])

  useEffect(() => {
    setReady(false)
    setFailed(false)
    readyReceivedRef.current = false
    const frameWindow = iframeRef.current?.contentWindow
    // dispose permanently closes the plugin bridge: only retire a frame resource.
    return () => { frameWindow?.postMessage({ type: 'dispose' }, '*') }
  }, [frameKey])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return undefined
    const lifetime = responseLifetime.current
    const post = (message: unknown): void => { iframe.contentWindow?.postMessage(message, '*') }
    const sendInit = (): void => {
      const activation = activationRef.current
      post({
        type: 'host.init',
        pluginId, contributionId, generation, version, stateVersion,
        locale: i18n?.resolvedLanguage ?? i18n?.language ?? 'en',
        capabilityIds: [...allowed],
        ...(workspaceRoot ? { workspaceRoot } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(runtimeId ? { runtimeId } : {}),
        ...(activation ? { activation } : {})
      })
    }
    const sendInventory = async (requestId: string): Promise<void> => {
      try {
        const inventory = await window.sciforge.extensions.list({ pluginId, contributionId, generation, version })
        if (!lifetime.active) return
        const response: InventoryResponse = { type: 'inventory.result', requestId, ok: true, inventory }
        post(response)
      } catch (error) {
        if (!lifetime.active) return
        const code = error && typeof error === 'object' && 'code' in error &&
          (error.code === 'PLUGIN_INVENTORY_ACCESS_REVOKED' || error.code === 'PLUGIN_INVENTORY_UNAVAILABLE')
          ? error.code
          : 'PLUGIN_INVENTORY_UNAVAILABLE'
        const response: InventoryResponse = {
          type: 'inventory.result', requestId, ok: false,
          error: { code, message: code === 'PLUGIN_INVENTORY_ACCESS_REVOKED'
            ? 'Plugin inventory access is no longer valid.' : 'Plugin inventory is unavailable.' }
        }
        post(response)
      }
    }
    const sendCapabilityFailure = (
      requestId: string,
      code: 'CAPABILITY_NOT_ALLOWED' | 'CAPABILITY_UNAVAILABLE' | 'CAPABILITY_REJECTED',
      message: string
    ): void => {
      const response: CapabilityResponse = { type: 'capability.result', requestId, ok: false, error: { code, message } }
      post(response)
    }
    const invokeCapability = async (
      requestId: string,
      actionId: string,
      input: unknown,
      approval: unknown
    ): Promise<void> => {
      if (!allowed.has(actionId)) {
        sendCapabilityFailure(requestId, 'CAPABILITY_NOT_ALLOWED', `Capability ${actionId} is not granted to ${pluginId}.`)
        return
      }
      if (!workspaceRoot) {
        sendCapabilityFailure(requestId, 'CAPABILITY_UNAVAILABLE', 'No active workspace is bound to this panel.')
        return
      }
      let size: number
      try {
        size = JSON.stringify(input ?? null)?.length ?? 0
      } catch {
        sendCapabilityFailure(requestId, 'CAPABILITY_REJECTED', 'Capability input is not serializable.')
        return
      }
      if (size > MAX_FRAME_INPUT_CHARS) {
        sendCapabilityFailure(requestId, 'CAPABILITY_REJECTED', 'Capability input exceeds the frame limit.')
        return
      }
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS)
      try {
        if (approval !== undefined) {
          if (!approval || typeof approval !== 'object' || Array.isArray(approval)
            || Object.keys(approval).length !== 1 || (approval as { mode?: unknown }).mode !== 'confirmation') {
            sendCapabilityFailure(requestId, 'CAPABILITY_REJECTED', 'Malformed confirmation request.')
            return
          }
          if (!window.confirm(t('pluginCapabilityConfirm', { defaultValue: 'Allow this plugin operation? {{actionId}}', actionId }))) {
            sendCapabilityFailure(requestId, 'CAPABILITY_REJECTED', 'Human confirmation was denied.')
            return
          }
        }
        if (!lifetime.active) return
        const result = await window.sciforge.capabilities.invoke({
          workspaceId: workspaceRoot,
          request: { actionId, input: (input ?? {}) as never, invocationId: requestId },
          ...(approval ? { approval: { mode: 'confirmation' as const } } : {})
        })
        if (!lifetime.active) return
        post({ type: 'capability.result', requestId, ok: true, output: result.output } satisfies CapabilityResponse)
      } catch (error) {
        if (!lifetime.active) return
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'CAPABILITY_UNAVAILABLE'
        const message = error instanceof Error ? error.message : String(error)
        sendCapabilityFailure(requestId, code === 'CAPABILITY_NOT_ALLOWED' ? 'CAPABILITY_NOT_ALLOWED'
          : /denied|rejected|approval/iu.test(`${code} ${message}`) ? 'CAPABILITY_REJECTED' : 'CAPABILITY_UNAVAILABLE',
        message.slice(0, 2_000))
      } finally {
        window.clearTimeout(timer)
      }
    }
    const onMessage = (event: MessageEvent<PluginPanelMessage>): void => {
      if (event.source !== iframe.contentWindow) return
      const type = typeof event.data?.type === 'string' ? event.data.type : ''
      if (type === 'collapse') {
        callbacksRef.current.onClose?.()
        return
      }
      if (type === 'inventory.list') {
        const requestId = event.data?.requestId
        if (typeof requestId === 'string' && requestId.length > 0) void sendInventory(requestId)
        return
      }
      if (type === 'capability.invoke') {
        const requestId = event.data?.requestId
        const actionId = event.data?.actionId
        if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 128) return
        if (typeof actionId !== 'string' || actionId.length === 0 || actionId.length > 256) {
          sendCapabilityFailure(requestId, 'CAPABILITY_REJECTED', 'Capability id is malformed.')
          return
        }
        void invokeCapability(requestId, actionId, event.data?.input, event.data?.approval)
        return
      }
      if (type === 'ready') {
        // Plugins may acknowledge host.init with ready. Accept it once so the
        // two messages cannot trigger an endless ready -> init -> ready loop.
        if (readyReceivedRef.current) return
        readyReceivedRef.current = true
        setReady(true)
        setFailed(false)
        sendInit()
        return
      }
      if (type === 'workspace.pickFile') {
        const requestId = event.data?.requestId
        if (typeof requestId !== 'string' || requestId.length === 0) return
        void (async () => {
          try {
            const picked = await window.sciforge.pickFile((event.data?.input ?? {}) as never)
            if (lifetime.active) post({ type: 'workspace.pickFile.result', requestId, ok: true, result: picked })
          } catch (error) {
            if (lifetime.active) post({
              type: 'workspace.pickFile.result', requestId, ok: false,
              error: { message: error instanceof Error ? error.message : String(error) }
            })
          }
        })()
        return
      }
      if (type === 'composer.sendMessage') {
        const requestId = event.data?.requestId
        if (typeof requestId !== 'string' || requestId.length === 0) return
        const input = event.data?.input as { text?: unknown; sessionId?: unknown; displayText?: unknown } | undefined
        const sendMessage = callbacksRef.current.services?.sendMessage
        if (!sendMessage || typeof input?.text !== 'string') {
          post({ type: 'composer.result', requestId, ok: false, error: { message: 'The host composer is not available to this panel.' } })
          return
        }
        void (async () => {
          try {
            const result = await sendMessage({
              text: input.text as string,
              ...(typeof input.sessionId === 'string' ? { sessionId: input.sessionId } : sessionId ? { sessionId } : {}),
              ...(typeof input.displayText === 'string' ? { displayText: input.displayText } : {})
            })
            if (lifetime.active) post({ type: 'composer.result', requestId, ok: result.ok, ...(result.ok ? {} : { error: result.error }) })
          } catch (error) {
            if (lifetime.active) post({ type: 'composer.result', requestId, ok: false, error: { message: error instanceof Error ? error.message : String(error) } })
          }
        })()
        return
      }
      if (type === 'ping') {
        post({ type: 'pong', requestId: event.data?.requestId })
      }
    }
    window.addEventListener('message', onMessage)
    iframe.addEventListener('load', sendInit)
    // Retry after load in case the frame's first ready preceded our listener.
    sendInit()
    return () => {
      window.removeEventListener('message', onMessage)
      iframe.removeEventListener('load', sendInit)
    }
  }, [pluginId, contributionId, generation, version, stateVersion, frameKey, workspaceRoot, sessionId, runtimeId, activationContributionId, activationRevision, allowed, i18n?.resolvedLanguage, i18n?.language, t])

  useEffect(() => {
    if (!active || ready) return undefined
    const timer = window.setTimeout(() => setFailed(true), 10_000)
    return () => window.clearTimeout(timer)
  }, [active, ready, frameKey])

  return (
    <div className={`relative h-full min-h-0 w-full overflow-hidden bg-ds-sidebar ${className}`} data-plugin-panel={contribution.contributionId} data-plugin-generation={String(contribution.generation)}>
      {!ready ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-4 text-center text-xs text-ds-muted" role={failed ? 'alert' : 'status'}>
          {t(failed ? 'pluginPanelLoadFailed' : 'pluginPanelLoading')}
          {failed ? <button type="button" className="rounded border border-ds-border px-3 py-1" onClick={() => setRetry((value) => value + 1)}>{t('pluginPanelRetry')}</button> : null}
        </div>
      ) : null}
      <iframe
        key={frameKey}
        ref={iframeRef}
        title={contribution.title}
        src={entryUrl}
        sandbox="allow-scripts"
        className={`h-full w-full border-0 ${ready ? '' : 'opacity-0'}`}
        loading={active ? 'eager' : 'lazy'}
        data-plugin-frame
      />
    </div>
  )
}