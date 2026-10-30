import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { DomainExtensionRendererContribution } from '@shared/domain-extensions'

type PluginPanelMessage = Readonly<{
  type?: unknown
  requestId?: unknown
  payload?: unknown
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

export function developmentRendererPanelId(
  contribution: Pick<DomainExtensionRendererContribution, 'pluginId' | 'contributionId'>
): string {
  return `development:${contribution.pluginId}:${contribution.contributionId}`
}

type Props = Readonly<{
  contribution: DomainExtensionRendererContribution
  active: boolean
  className?: string
}>

/**
 * Hosts development UI in an opaque-origin sandbox. Only the small message
 * protocol below crosses the iframe boundary; the plugin never receives the
 * Electron bridge or the parent window object.
 */
export function DevelopmentPluginPanelHost({ contribution, active, className = '' }: Props): ReactElement {
  const { t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const { pluginId, contributionId, generation, version, stateVersion, entryUrl } = contribution
  const generationKey = `${contribution.pluginId}:${contribution.contributionId}:${contribution.generation}:${contribution.version}`
  const frameKey = `${generationKey}:${retry}`

  useEffect(() => {
    setReady(false)
    setFailed(false)
    const iframe = iframeRef.current
    if (!iframe) return undefined
    let disposed = false
    let readyReceived = false
    const sendInit = (): void => {
      iframe.contentWindow?.postMessage({
        type: 'host.init',
        pluginId, contributionId, generation, version, stateVersion
      }, '*')
    }
    const sendInventory = async (requestId: string): Promise<void> => {
      try {
        const inventory = await window.sciforge.extensions.list({ pluginId, contributionId, generation, version })
        if (disposed) return
        const response: InventoryResponse = { type: 'inventory.result', requestId, ok: true, inventory }
        iframe.contentWindow?.postMessage(response, '*')
      } catch (error) {
        if (disposed) return
        const code = error && typeof error === 'object' && 'code' in error &&
          (error.code === 'PLUGIN_INVENTORY_ACCESS_REVOKED' || error.code === 'PLUGIN_INVENTORY_UNAVAILABLE')
          ? error.code
          : 'PLUGIN_INVENTORY_UNAVAILABLE'
        const response: InventoryResponse = {
          type: 'inventory.result', requestId, ok: false,
          error: { code, message: code === 'PLUGIN_INVENTORY_ACCESS_REVOKED'
            ? 'Plugin inventory access is no longer valid.' : 'Plugin inventory is unavailable.' }
        }
        iframe.contentWindow?.postMessage(response, '*')
      }
    }
    const onMessage = (event: MessageEvent<PluginPanelMessage>): void => {
      if (event.source !== iframe.contentWindow) return
      const type = typeof event.data?.type === 'string' ? event.data.type : ''
      if (type === 'inventory.list') {
        const requestId = event.data?.requestId
        if (typeof requestId === 'string' && requestId.length > 0) void sendInventory(requestId)
        return
      }
      if (type === 'ready') {
        // Plugins may acknowledge host.init with ready. Accept it once so the
        // two messages cannot trigger an endless ready -> init -> ready loop.
        if (readyReceived) return
        readyReceived = true
        setReady(true)
        setFailed(false)
        sendInit()
        return
      }
      if (type === 'ping') {
        iframe.contentWindow?.postMessage({ type: 'pong', requestId: event.data?.requestId }, '*')
      }
    }
    window.addEventListener('message', onMessage)
    iframe.addEventListener('load', sendInit)
    // Retry after load in case the frame's first ready preceded our listener.
    sendInit()
    return () => {
      disposed = true
      window.removeEventListener('message', onMessage)
      iframe.removeEventListener('load', sendInit)
      iframe.contentWindow?.postMessage({ type: 'dispose' }, '*')
    }
  }, [pluginId, contributionId, generation, version, stateVersion, entryUrl, frameKey])

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
