import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

import type { DomainRendererWorkbenchMainAreaRenderContext } from '@sciforge/domain-sdk/renderer'

import type { SiYuanEditorViewport } from '../editor-contract.js'
import { useNativeSiYuanPresentation } from './native-siyuan-presentation.js'

export type SiYuanEditorConfiguration = { url: string }

const STORAGE_KEY = 'sciforge.siyuan.editor'
const OPENING = '正在连接思源服务…（若该服务启用了访问授权码，请在内嵌页面中解锁一次）'

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
 * The SiYuan main-area page owns both the embedded editor and its own
 * configuration, because the Host leaves the whole surface to the package.
 * The editor itself is a native child view presented by the main process.
 */
export function SiYuanEditorPage({ context, open, present }: Readonly<{
  context: DomainRendererWorkbenchMainAreaRenderContext<ReactElement | null>
  open: (input: SiYuanEditorConfiguration) => Promise<string>
  present: (input: Readonly<{ url: string | null; viewport: SiYuanEditorViewport }>) => Promise<unknown>
}>): ReactElement {
  const [configuration, setConfiguration] = useState(readConfiguration)
  const [draft, setDraft] = useState(configuration)
  const [panelOpen, setPanelOpen] = useState(false)
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
          onClick={() => { setDraft(configuration); setPanelOpen((value) => !value) }}>设置</button>
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
          {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
          <div className="flex gap-2">
            <button type="button" className="ds-no-drag rounded bg-ds-accent px-4 py-2 text-sm text-white"
              onClick={save}>保存设置</button>
            <button type="button" className="ds-no-drag rounded border border-ds-border px-4 py-2 text-sm"
              onClick={() => setPanelOpen(false)}>取消</button>
          </div>
        </div> : null}
      </div>
    </section>
  )
}