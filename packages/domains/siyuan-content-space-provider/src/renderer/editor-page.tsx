import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

import type { DomainRendererWorkbenchMainAreaRenderContext } from '@sciforge/domain-sdk/renderer'

import type { SiYuanEditorViewport, SiYuanServiceStatus } from '../editor-contract.js'
import { useNativeSiYuanPresentation } from './native-siyuan-presentation.js'

export type SiYuanEditorConfiguration = { url: string }
export type SiYuanServiceControls = Readonly<{
  status: () => Promise<SiYuanServiceStatus>
  configure: (token: string | null) => Promise<SiYuanServiceStatus>
}>

const STORAGE_KEY = 'sciforge.siyuan.editor'
const OPENING = '正在连接思源服务…（若该服务启用了访问授权码，请在内嵌页面中解锁一次）'

const tokenSummary = (service: SiYuanServiceStatus | undefined): string => {
  if (!service) return '读取中…'
  if (service.token === 'stored') return '已配置（保存在本机加密存储）'
  if (service.token === 'environment') return '来自环境变量 SIYUAN_API_TOKEN'
  if (service.tokenStorage === 'unavailable') return '未配置（本机安全存储不可用，只能使用 SIYUAN_API_TOKEN）'
  return '未配置'
}

function readConfiguration(): SiYuanEditorConfiguration {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<SiYuanEditorConfiguration>
    return { url: typeof value.url === 'string' ? value.url : '' }
  } catch {
    return { url: '' }
  }
}

function validate(configuration: SiYuanEditorConfiguration): void {
  // An empty address is allowed: the main process falls back to the service
  // configured for the installation, and reports a clear error when neither exists.
  if (!configuration.url.trim()) return
  const parsed = new URL(configuration.url)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 地址。')
  }
}

/**
 * The dockable SiYuan page owns both the embedded editor and its own
 * configuration, because the Host leaves the whole surface to the package.
 * The editor itself is a native child view presented by the main process.
 */
export function SiYuanEditorPage({ context, open, present, service }: Readonly<{
  context: DomainRendererWorkbenchMainAreaRenderContext<ReactElement | null>
  open: (input: SiYuanEditorConfiguration) => Promise<string>
  present: (input: Readonly<{ url: string | null; viewport: SiYuanEditorViewport }>) => Promise<unknown>
  service: SiYuanServiceControls
}>): ReactElement {
  const [configuration, setConfiguration] = useState(readConfiguration)
  const [draft, setDraft] = useState(configuration)
  const [tokenDraft, setTokenDraft] = useState('')
  const [serviceStatus, setServiceStatus] = useState<SiYuanServiceStatus>()
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelError, setPanelError] = useState<string>()
  const [url, setUrl] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const viewport = useRef<HTMLDivElement | null>(null)

  const onReady = useCallback((): void => { setReady(true); setError(undefined) }, [])
  const onError = useCallback((message: string): void => { setReady(false); setError(message) }, [])
  useNativeSiYuanPresentation({
    active: context.active, url, viewportRef: viewport, present, onReady, onError
  })

  useEffect(() => {
    if (!context.active) return
    let cancelled = false
    setOpening(true)
    setReady(false)
    setError(undefined)
    void open(configuration).then((next) => {
      if (!cancelled) setUrl(next)
    }).catch((failure: unknown) => {
      if (cancelled) return
      setError(failure instanceof Error ? failure.message : String(failure))
    }).finally(() => { if (!cancelled) setOpening(false) })
    return () => { cancelled = true }
  }, [context.active, configuration, attempt, open])

  // Dropping the url first detaches the native view, so a reload always loads
  // the resolved address again instead of reusing the previous page.
  const reload = useCallback((): void => {
    setUrl(null)
    setReady(false)
    setError(undefined)
    setAttempt((value) => value + 1)
  }, [])

  // The token state lives in the main process, so the page re-reads it whenever
  // it is about to show the configuration it belongs to.
  useEffect(() => {
    if (!panelOpen) return
    let cancelled = false
    void service.status().then((next) => { if (!cancelled) setServiceStatus(next) })
      .catch((failure: unknown) => {
        if (!cancelled) setPanelError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => { cancelled = true }
  }, [panelOpen, service])

  const save = useCallback((): void => {
    try {
      validate(draft)
      const next = { url: draft.url.trim() }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setConfiguration(next)
      setPanelOpen(false)
      setUrl(null)
      setReady(false)
      setError(undefined)
      setAttempt((value) => value + 1)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [draft])

  /** Saving runs in two steps so a rejected token never leaves the address
   * changed without a matching credential: store, then persist the address. */
  const saveSettings = useCallback(async (): Promise<void> => {
    setPanelError(undefined)
    try {
      validate(draft)
      const token = tokenDraft.trim()
      if (token) {
        setServiceStatus(await service.configure(token))
        setTokenDraft('')
      }
      save()
    } catch (failure) {
      setPanelError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [draft, save, service, tokenDraft])

  const clearToken = useCallback(async (): Promise<void> => {
    setPanelError(undefined)
    try {
      setServiceStatus(await service.configure(null))
    } catch (failure) {
      setPanelError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [service])

  const message = error ?? (opening || !ready ? OPENING : undefined)
  const address = url ?? (configuration.url.trim() || '未配置服务地址')
  return (
    <section className={`${context.className} flex-col`} aria-label="思源笔记">
      <header
        className="flex h-9 shrink-0 items-center gap-2 border-b border-ds-border pr-3"
        style={{ paddingLeft: 'var(--ds-main-area-leading-inset, 0px)' }}
      >
        <span className="mr-auto truncate text-xs text-ds-muted">思源笔记 · {address}</span>
        <button type="button" className="ds-no-drag rounded border border-ds-border px-2 py-1 text-xs"
          onClick={reload}>重新加载</button>
        <button type="button" className="ds-no-drag rounded border border-ds-border px-2 py-1 text-xs"
          aria-expanded={panelOpen}
          onClick={() => {
            setDraft(configuration)
            setTokenDraft('')
            setPanelError(undefined)
            setPanelOpen((value) => !value)
          }}>设置</button>
      </header>
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div ref={viewport} className="flex min-h-0 min-w-0 flex-1" data-siyuan-editor-slot="" />
        {message ? <div data-siyuan-scaffold="" role="presentation"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ds-bg p-6 text-center text-sm text-ds-muted">
          <p role={error ? 'alert' : 'status'}>{message}</p>
          {error ? <div className="flex gap-2">
            <button type="button" className="ds-no-drag rounded border border-ds-border px-3 py-2"
              onClick={reload}>重试</button>
            <button type="button" className="ds-no-drag rounded border border-ds-border px-3 py-2"
              onClick={() => { setDraft(configuration); setPanelOpen(true) }}>打开设置</button>
          </div> : null}
        </div> : null}
        {panelOpen ? <div role="dialog" aria-label="思源笔记设置"
          className="absolute inset-0 space-y-4 overflow-auto bg-ds-bg p-6">
          <h2 className="text-lg font-semibold">思源笔记</h2>
          <p className="text-sm text-ds-muted">
            Agent 成功结束一轮回复后，会把该轮的目标与结论自动归档到所配置的思源笔记本；中间进度、失败和取消的轮次不会归档。
          </p>
          <label className="block text-sm">服务地址
            <input className="mt-2 block w-full rounded border border-ds-border bg-ds-bg px-3 py-2"
              placeholder="http://192.168.1.10:6806"
              value={draft.url}
              onChange={(event) => setDraft({ url: event.target.value })} />
          </label>
          <p className="text-sm text-ds-muted">
            填写可访问的思源服务地址（局域网或 HTTPS）。SciForge 不再随附思源内核，请确保该服务已启动；
            留空则使用安装时配置的默认地址。若该服务要求 API 令牌，可设置环境变量 SIYUAN_API_TOKEN。
          </p>
          <label className="block text-sm">API 令牌
            <input className="mt-2 block w-full rounded border border-ds-border bg-ds-bg px-3 py-2"
              type="password" autoComplete="off" placeholder="仅在该服务启用鉴权时填写"
              aria-label="API 令牌"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)} />
          </label>
          <p className="text-sm text-ds-muted">
            令牌：{tokenSummary(serviceStatus)}。令牌只写入本机加密存储，不会回显到这个页面、日志或对话里；
            留空保存则保持当前令牌不变。若服务端启用了访问授权码，还需要在内嵌页面里解锁一次。
          </p>
          {serviceStatus?.token === 'stored' ? <div>
            <button type="button" className="ds-no-drag rounded border border-ds-border px-3 py-2 text-sm"
              onClick={() => { void clearToken() }}>清除已保存令牌</button>
          </div> : null}
          {panelError ? <p role="alert" className="text-sm text-red-600">{panelError}</p> : null}
          <div className="flex gap-2">
            <button type="button" className="ds-no-drag rounded bg-ds-accent px-4 py-2 text-sm text-white"
              onClick={() => { void saveSettings() }}>保存设置</button>
            <button type="button" className="ds-no-drag rounded border border-ds-border px-4 py-2 text-sm"
              onClick={() => setPanelOpen(false)}>取消</button>
          </div>
        </div> : null}
      </div>
    </section>
  )
}
