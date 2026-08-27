import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type DetailedHTMLProps,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { PluggableList } from 'unified'
import { useTranslation } from 'react-i18next'
import {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath,
  resolveWriteMarkdownWorkspaceLinkPath,
  transformWriteMarkdownLinkUrl,
  transformWriteMarkdownMediaUrl
} from '@shared/write-markdown-resource'
import { normalizeMarkdownMathDelimiters } from '@shared/write-markdown-math'
import {
  highlightCodeHtml,
  renderFallbackCodeHtml
} from '../../lib/code-highlighting'
import { openSafeExternalUrl } from '../../lib/open-external'
import {
  openPathInSystemEditor,
  watchForSystemEditorReturn
} from '../../lib/system-editor'
import { ImagePreviewLightbox } from '../ImagePreviewLightbox'
import {
  getCachedMarkdownWorkspaceImage,
  loadCachedMarkdownWorkspaceImage,
  markdownWorkspaceImageCacheKey,
  type WriteMarkdownWorkspaceImageLoader
} from './write-markdown-image-cache'

export {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath,
  resolveWriteMarkdownWorkspaceLinkPath
} from '@shared/write-markdown-resource'
export type { WriteMarkdownWorkspaceImageLoader } from './write-markdown-image-cache'

type Props = {
  content: string
  isMarkdown: boolean
  filePath?: string | null
  workspaceRoot?: string | null
  previewErrorMessage?: string
  loadWorkspaceImage?: WriteMarkdownWorkspaceImageLoader
  onOpenWorkspaceLink?: WriteMarkdownWorkspaceLinkOpener
}

export type WriteMarkdownWorkspaceLinkOpener = (input: {
  path: string
  workspaceRoot: string
}) => void

type CodeProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  node?: MarkdownCodeNode
}

type MarkdownPoint = {
  line?: number
  column?: number
}

type MarkdownPosition = {
  start?: MarkdownPoint
  end?: MarkdownPoint
}

type MarkdownCodeNode = {
  tagName?: string
  position?: MarkdownPosition
}

type CodeBlockExpansionContextValue = {
  expandedCodeBlocks: Record<string, boolean>
  filePath?: string | null
  setCodeBlockExpanded: (key: string, expanded: boolean) => void
}

const CodeBlockExpansionContext = createContext<CodeBlockExpansionContextValue | null>(null)

const rehypePlugins = [
  rehypeKatex
] as unknown as PluggableList

const remarkPlugins = [remarkMath, remarkGfm] as unknown as PluggableList

const LANGUAGE_REGEX = /language-([^\s]+)/
const TRAILING_NEWLINES_REGEX = /\n+$/
const COLLAPSE_HEIGHT = 200
const COPY_RESET_MS = 2000
let mermaidInitialized = false
const MERMAID_CACHE_LIMIT = 100
const mermaidSvgCache = new Map<string, string>()
const mermaidRenderPromises = new Map<string, Promise<string>>()

type MarkdownImagePreview = {
  src: string
  alt: string
  path?: string
  workspaceRoot?: string
  cacheKey?: string
}

type MarkdownImageRefreshRequest = {
  cacheKey: string
  revision: number
}

type MarkdownImageRefreshContextValue = {
  request: MarkdownImageRefreshRequest | null
  onResolved: (image: MarkdownImagePreview) => void
  onSettled: (cacheKey: string) => void
}

const MarkdownImageRefreshContext = createContext<MarkdownImageRefreshContextValue | null>(null)

function writeMarkdownUrlTransform(value: string, key: string): string {
  if (key === 'src') return transformWriteMarkdownMediaUrl(value)
  if (key === 'href') return transformWriteMarkdownLinkUrl(value)
  return value
}

function plainTextFallback(content: string): ReactElement {
  return (
    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13.5px] leading-6 text-ds-ink">
      {content}
    </pre>
  )
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    const props = node.props as { children?: ReactNode }
    return extractText(props.children)
  }
  return ''
}

function copyTextFallback(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  return ok
}

type MermaidRenderState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string }

function cacheMermaidSvg(cacheKey: string, svg: string): void {
  mermaidSvgCache.delete(cacheKey)
  mermaidSvgCache.set(cacheKey, svg)
  while (mermaidSvgCache.size > MERMAID_CACHE_LIMIT) {
    const oldestKey = mermaidSvgCache.keys().next().value
    if (typeof oldestKey !== 'string') break
    mermaidSvgCache.delete(oldestKey)
  }
}

function renderMermaidDiagram(code: string, cacheKey: string): Promise<string> {
  const cached = mermaidSvgCache.get(cacheKey)
  if (cached) return Promise.resolve(cached)
  const pending = mermaidRenderPromises.get(cacheKey)
  if (pending) return pending

  const renderPromise = import('mermaid').then(async ({ default: mermaid }) => {
    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'neutral'
      })
      mermaidInitialized = true
    }
    const renderId = `write-mermaid-${stableStringHash(cacheKey)}`
    const { svg } = await mermaid.render(renderId, code)
    cacheMermaidSvg(cacheKey, svg)
    return svg
  }).finally(() => {
    mermaidRenderPromises.delete(cacheKey)
  })
  mermaidRenderPromises.set(cacheKey, renderPromise)
  return renderPromise
}

function MermaidDiagram({ code, cacheKey }: { code: string; cacheKey: string }): ReactElement {
  const { t } = useTranslation('common')
  const trimmedCode = useMemo(() => code.replace(TRAILING_NEWLINES_REGEX, '').trim(), [code])
  const [state, setState] = useState<MermaidRenderState>(() => {
    const cached = mermaidSvgCache.get(cacheKey)
    return cached ? { status: 'ready', svg: cached } : { status: 'loading' }
  })

  useEffect(() => {
    let cancelled = false
    const cached = mermaidSvgCache.get(cacheKey)
    if (cached) {
      setState((current) => current.status === 'ready' && current.svg === cached
        ? current
        : { status: 'ready', svg: cached })
      return
    }
    setState((current) => current.status === 'loading' ? current : { status: 'loading' })
    void renderMermaidDiagram(trimmedCode, cacheKey).then(
      (svg) => {
        if (!cancelled) setState({ status: 'ready', svg })
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [cacheKey, trimmedCode])

  if (state.status === 'ready') {
    return (
      <div
        className="write-mermaid-diagram"
        role="img"
        aria-label={t('mermaidDiagramLabel')}
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  }
  if (state.status === 'error') {
    return (
      <div className="write-mermaid-error" role="alert">
        <div>{t('mermaidDiagramError')}</div>
        <div className="mt-1 font-mono text-[11px] opacity-80">{state.message}</div>
      </div>
    )
  }
  return <div className="write-mermaid-loading">{t('mermaidDiagramLoading')}</div>
}

function PreviewCodeBlock({
  code,
  language,
  expanded: controlledExpanded,
  onExpandedChange
}: {
  code: string
  language: string
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const trimmedCode = useMemo(() => code.replace(TRAILING_NEWLINES_REGEX, ''), [code])
  const [html, setHtml] = useState(() => renderFallbackCodeHtml(trimmedCode))
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [expandable, setExpandable] = useState(false)
  const [localExpanded, setLocalExpanded] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const copyResetRef = useRef<number | null>(null)
  const expandableRef = useRef(false)
  const expanded = controlledExpanded ?? localExpanded
  const setExpanded = onExpandedChange ?? setLocalExpanded

  useEffect(() => {
    let cancelled = false
    const fallbackHtml = renderFallbackCodeHtml(trimmedCode)
    setHtml((current) => current === fallbackHtml ? current : fallbackHtml)

    void highlightCodeHtml(trimmedCode, language).then((nextHtml) => {
      if (!cancelled) {
        setHtml((current) => current === nextHtml ? current : nextHtml)
      }
    })

    return () => {
      cancelled = true
    }
  }, [trimmedCode, language])

  useEffect(() => {
    const element = bodyRef.current
    if (!element) return

    const update = (): void => {
      const nextExpandable = element.scrollHeight > COLLAPSE_HEIGHT
      if (expandableRef.current === nextExpandable) return
      expandableRef.current = nextExpandable
      setExpandable(nextExpandable)
    }

    update()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => update())
    observer.observe(element)
    return () => observer.disconnect()
  }, [html, trimmedCode])

  useEffect(() => {
    if (controlledExpanded === undefined) setLocalExpanded(false)
  }, [controlledExpanded, trimmedCode, language])

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    },
    []
  )

  const handleCopy = async (): Promise<void> => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(trimmedCode)
      } else if (!copyTextFallback(trimmedCode)) {
        throw new Error('copy-failed')
      }
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopyFailed(true)
      return
    }
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    copyResetRef.current = window.setTimeout(() => {
      setCopied(false)
      setCopyFailed(false)
    }, COPY_RESET_MS)
  }

  return (
    <div className="ds-code-block" data-language={language}>
      <div className="ds-code-block-header">
        <span className="ds-code-block-language">{language || 'text'}</span>
        <div className="ds-code-block-actions">
          <button
            type="button"
            className="ds-code-block-action"
            title={copied ? t('copySuccess') : copyFailed ? t('copyFailed') : t('copyMessage')}
            aria-label={copied ? t('copySuccess') : copyFailed ? t('copyFailed') : t('copyMessage')}
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2.1} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />
            )}
          </button>
          {expandable ? (
            <button
              type="button"
              className="ds-code-block-action"
              title={expanded ? 'Collapse code' : 'Expand code'}
              aria-label={expanded ? 'Collapse code' : 'Expand code'}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.9} />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.9} />
              )}
            </button>
          ) : null}
        </div>
      </div>

      <div className={`ds-code-block-body ${expandable && !expanded ? 'is-collapsed' : ''}`}>
        <div
          ref={bodyRef}
          className="ds-code-block-html"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {expandable && !expanded ? (
          <button
            type="button"
            className="ds-code-block-fade"
            aria-label="Expand code"
            onClick={() => setExpanded(true)}
          />
        ) : null}
      </div>
    </div>
  )
}

function PreviewCode({ className, children, node, ...props }: CodeProps): ReactNode {
  const expansionContext = useContext(CodeBlockExpansionContext)
  const text = extractText(children)
  const isInline = node?.tagName !== 'code' || (!LANGUAGE_REGEX.test(className ?? '') && !text.includes('\n'))

  if (isInline) {
    return (
      <code
        className={className ? `ds-code-inline ${className}` : 'ds-code-inline'}
        {...props}
      >
        {children}
      </code>
    )
  }

  const match = className?.match(LANGUAGE_REGEX)
  const language = match?.[1] ?? ''
  if (language.toLocaleLowerCase() === 'mermaid') {
    const cacheKey = getCodeBlockExpansionKey(text, language, node, expansionContext?.filePath)
    return <MermaidDiagram code={text} cacheKey={cacheKey} />
  }
  if (!expansionContext) {
    return <PreviewCodeBlock code={text} language={language} />
  }

  const expansionKey = getCodeBlockExpansionKey(text, language, node, expansionContext?.filePath)
  return (
    <PreviewCodeBlock
      code={text}
      language={language}
      expanded={expansionContext.expandedCodeBlocks[expansionKey] ?? false}
      onExpandedChange={(expanded) => expansionContext.setCodeBlockExpanded(expansionKey, expanded)}
    />
  )
}

type ResolvedMarkdownImageProps = {
  src?: string
  alt?: string | null
  node?: unknown
  filePath?: string | null
  workspaceRoot?: string | null
  loadWorkspaceImage?: WriteMarkdownWorkspaceImageLoader
  onOpenPreview?: (image: MarkdownImagePreview) => void
} & Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'alt'>

type ResolvedMarkdownImageState = {
  resourceKey: string
  resolvedSrc?: string
  loadFailed: boolean
}

function ResolvedMarkdownImage({
  src,
  alt,
  node: _node,
  filePath,
  workspaceRoot,
  loadWorkspaceImage,
  onOpenPreview,
  ...props
}: ResolvedMarkdownImageProps): ReactElement {
  const { t } = useTranslation('common')
  const imageRefresh = useContext(MarkdownImageRefreshContext)
  const localPath = resolveWriteMarkdownResourcePath(src, filePath)
  const externalSrc = resolveWriteMarkdownResource(src, filePath)
  const root = workspaceRoot?.trim() ?? ''
  const cacheKey = localPath && root
    ? markdownWorkspaceImageCacheKey(root, localPath)
    : ''
  const resourceKey = localPath
    ? `workspace:${cacheKey || localPath}`
    : `embedded:${externalSrc ?? src ?? ''}`
  const cachedSrc = cacheKey
    ? getCachedMarkdownWorkspaceImage(cacheKey)
    : externalSrc
  const [imageState, setImageState] = useState<ResolvedMarkdownImageState>(() => ({
    resourceKey,
    ...(cachedSrc ? { resolvedSrc: cachedSrc } : {}),
    loadFailed: false
  }))
  const resolvedSrc = imageState.resourceKey === resourceKey
    ? imageState.resolvedSrc
    : cachedSrc
  const loadFailed = imageState.resourceKey === resourceKey && imageState.loadFailed
  const refreshRevision = cacheKey && imageRefresh?.request?.cacheKey === cacheKey
    ? imageRefresh.request.revision
    : 0
  const onImageResolved = imageRefresh?.onResolved
  const onImageRefreshSettled = imageRefresh?.onSettled
  const altText = alt ?? ''

  useEffect(() => {
    let cancelled = false

    if (!localPath) {
      setImageState({
        resourceKey,
        ...(externalSrc ? { resolvedSrc: externalSrc } : {}),
        loadFailed: false
      })
      return
    }

    if (!root || !loadWorkspaceImage) {
      setImageState({
        resourceKey,
        loadFailed: true
      })
      return
    }

    const availableSrc = getCachedMarkdownWorkspaceImage(cacheKey)
    setImageState({
      resourceKey,
      ...(availableSrc ? { resolvedSrc: availableSrc } : {}),
      loadFailed: false
    })

    void loadCachedMarkdownWorkspaceImage({
      cacheKey,
      path: localPath,
      workspaceRoot: root,
      loadWorkspaceImage
    }).then((dataUrl) => {
      if (cancelled) return
      if (dataUrl) {
        onImageResolved?.({
          src: dataUrl,
          alt: altText,
          path: localPath,
          workspaceRoot: root,
          cacheKey
        })
      }
      setImageState((current) => {
        if (current.resourceKey !== resourceKey) return current
        if (dataUrl) {
          return {
            resourceKey,
            resolvedSrc: dataUrl,
            loadFailed: false
          }
        }
        if (current.resolvedSrc) return current
        return {
          resourceKey,
          loadFailed: true
        }
      })
      onImageRefreshSettled?.(cacheKey)
    })

    return () => {
      cancelled = true
    }
  }, [
    altText,
    cacheKey,
    externalSrc,
    loadWorkspaceImage,
    localPath,
    onImageRefreshSettled,
    onImageResolved,
    refreshRevision,
    resourceKey,
    root
  ])

  if (loadFailed) {
    return (
      <span className="inline-flex max-w-full items-center rounded-lg border border-red-200/70 bg-red-50/80 px-2 py-1 text-[12px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
        {alt || src || 'Image could not be loaded'}
      </span>
    )
  }

  const image = (
    <img
      {...props}
      alt={altText}
      {...(resolvedSrc ? { src: resolvedSrc } : {})}
    />
  )

  if (!resolvedSrc || !onOpenPreview) return image

  return (
    <button
      type="button"
      className="write-markdown-image-button"
      aria-label={t('imagePreviewOpen', {
        name: altText || t('imagePreviewTitle')
      })}
      title={t('imagePreviewOpen', {
        name: altText || t('imagePreviewTitle')
      })}
      onClick={() => onOpenPreview({
        src: resolvedSrc,
        alt: altText,
        ...(localPath && root && cacheKey
          ? {
              path: localPath,
              workspaceRoot: root,
              cacheKey
            }
          : {})
      })}
    >
      {image}
    </button>
  )
}

type PreviewBoundaryProps = {
  content: string
  filePath?: string | null
  previewErrorMessage: string
  children: ReactNode
}

type PreviewBoundaryState = {
  error: string | null
}

class PreviewErrorBoundary extends Component<PreviewBoundaryProps, PreviewBoundaryState> {
  state: PreviewBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): PreviewBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override componentDidUpdate(previousProps: PreviewBoundaryProps): void {
    if (
      this.state.error &&
      (previousProps.content !== this.props.content || previousProps.filePath !== this.props.filePath)
    ) {
      this.setState({ error: null })
    }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-full px-6 py-6">
        <div className="mb-4 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-[13px] leading-5 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100">
          {this.props.previewErrorMessage}
        </div>
        {plainTextFallback(this.props.content)}
      </div>
    )
  }
}

function WriteMarkdownPreviewContent({
  content,
  isMarkdown,
  filePath,
  workspaceRoot,
  loadWorkspaceImage,
  onOpenWorkspaceLink
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [expandedCodeBlocks, setExpandedCodeBlocks] = useState<Record<string, boolean>>({})
  const [imagePreview, setImagePreview] = useState<MarkdownImagePreview | null>(null)
  const [imageRefreshRequest, setImageRefreshRequest] = useState<MarkdownImageRefreshRequest | null>(null)
  const [systemEditRefreshingCacheKey, setSystemEditRefreshingCacheKey] = useState<string | null>(null)
  const systemEditorReturnCleanupRef = useRef<(() => void) | null>(null)
  const setCodeBlockExpanded = useCallback((key: string, expanded: boolean): void => {
    setExpandedCodeBlocks((current) => {
      if (current[key] === expanded) return current
      return {
        ...current,
        [key]: expanded
      }
    })
  }, [])
  const stopWatchingSystemEditorReturn = useCallback((): void => {
    systemEditorReturnCleanupRef.current?.()
    systemEditorReturnCleanupRef.current = null
  }, [])
  const openImagePreview = useCallback((image: MarkdownImagePreview): void => {
    stopWatchingSystemEditorReturn()
    setImagePreview(image)
    setSystemEditRefreshingCacheKey(null)
  }, [stopWatchingSystemEditorReturn])
  const closeImagePreview = useCallback((): void => {
    stopWatchingSystemEditorReturn()
    setImagePreview(null)
    setSystemEditRefreshingCacheKey(null)
  }, [stopWatchingSystemEditorReturn])
  const refreshSystemEditedImage = useCallback((image: MarkdownImagePreview): void => {
    if (!image.cacheKey) return
    const cacheKey = image.cacheKey
    setSystemEditRefreshingCacheKey(cacheKey)
    setImageRefreshRequest((current) => ({
      cacheKey,
      revision: current?.cacheKey === cacheKey ? current.revision + 1 : 1
    }))
  }, [])
  const handleResolvedImage = useCallback((image: MarkdownImagePreview): void => {
    if (!image.cacheKey) return
    setImagePreview((current) => {
      if (!current || current.cacheKey !== image.cacheKey) return current
      return { ...current, src: image.src }
    })
  }, [])
  const handleImageRefreshSettled = useCallback((cacheKey: string): void => {
    setSystemEditRefreshingCacheKey((current) => current === cacheKey ? null : current)
  }, [])
  const imageRefreshContext = useMemo<MarkdownImageRefreshContextValue>(() => ({
    request: imageRefreshRequest,
    onResolved: handleResolvedImage,
    onSettled: handleImageRefreshSettled
  }), [handleImageRefreshSettled, handleResolvedImage, imageRefreshRequest])
  const openImageInSystemEditor = useCallback(async (): Promise<void> => {
    const target = imagePreview
    if (!target?.path || !target.workspaceRoot || !target.cacheKey) {
      throw new Error(t('imagePreviewSystemEditorUnavailable'))
    }
    const openEditorPath = window.sciforge?.openEditorPath
    if (typeof openEditorPath !== 'function') {
      throw new Error(t('imagePreviewSystemEditorUnavailable'))
    }

    stopWatchingSystemEditorReturn()
    systemEditorReturnCleanupRef.current = watchForSystemEditorReturn({
      windowTarget: window,
      documentTarget: document,
      isDocumentHidden: () => document.visibilityState === 'hidden',
      onReturn: () => refreshSystemEditedImage(target)
    })

    try {
      await openPathInSystemEditor({
        openPath: openEditorPath,
        path: target.path,
        workspaceRoot: target.workspaceRoot
      })
    } catch (error) {
      stopWatchingSystemEditorReturn()
      throw error
    }
  }, [imagePreview, refreshSystemEditedImage, stopWatchingSystemEditorReturn, t])
  const codeBlockExpansionContext = useMemo<CodeBlockExpansionContextValue>(() => ({
    expandedCodeBlocks,
    filePath,
    setCodeBlockExpanded
  }), [expandedCodeBlocks, filePath, setCodeBlockExpanded])

  useEffect(() => {
    setExpandedCodeBlocks({})
    closeImagePreview()
  }, [closeImagePreview, filePath])

  useEffect(() => () => stopWatchingSystemEditorReturn(), [stopWatchingSystemEditorReturn])

  const markdownContent = useMemo(() => normalizeMarkdownMathDelimiters(content), [content])
  const markdownComponents = useMemo(() => ({
    a: ({ href, children, ...props }: ComponentPropsWithoutRef<'a'>): ReactNode => (
      <a
        {...props}
        href={href}
        onClick={(event) => {
          if (!href) return
          const localPath = resolveWriteMarkdownWorkspaceLinkPath(href, filePath, workspaceRoot)
          const root = workspaceRoot?.trim()
          if (localPath && root && onOpenWorkspaceLink) {
            event.preventDefault()
            onOpenWorkspaceLink({ path: localPath, workspaceRoot: root })
            return
          }
          if (href.startsWith('#')) return
          event.preventDefault()
          void openSafeExternalUrl(href).catch(() => undefined)
        }}
      >
        {children}
      </a>
    ),
    img: ({ src, alt, ...props }: ComponentPropsWithoutRef<'img'>): ReactNode => (
      <ResolvedMarkdownImage
        {...props}
        src={src}
        alt={alt}
        filePath={filePath}
        workspaceRoot={workspaceRoot}
        loadWorkspaceImage={loadWorkspaceImage}
        onOpenPreview={openImagePreview}
      />
    ),
    code: ({ className, children, node, ...props }: CodeProps): ReactNode => (
      <PreviewCode
        className={className}
        node={node}
        {...props}
      >
        {children}
      </PreviewCode>
    )
  }), [filePath, loadWorkspaceImage, onOpenWorkspaceLink, openImagePreview, workspaceRoot])

  if (!isMarkdown) return plainTextFallback(content)
  return (
    <>
      <div className="ds-markdown write-markdown-preview min-h-full text-ds-ink">
        <MarkdownImageRefreshContext.Provider value={imageRefreshContext}>
          <CodeBlockExpansionContext.Provider value={codeBlockExpansionContext}>
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              urlTransform={writeMarkdownUrlTransform}
              components={markdownComponents}
            >
              {markdownContent}
            </ReactMarkdown>
          </CodeBlockExpansionContext.Provider>
        </MarkdownImageRefreshContext.Provider>
      </div>
      <ImagePreviewLightbox
        open={Boolean(imagePreview)}
        src={imagePreview?.src ?? ''}
        alt={imagePreview?.alt ?? ''}
        title={imagePreview?.alt}
        onEdit={imagePreview?.path && imagePreview.workspaceRoot && imagePreview.cacheKey
          ? openImageInSystemEditor
          : undefined}
        editDisabled={systemEditRefreshingCacheKey === imagePreview?.cacheKey}
        editLabel={t('imagePreviewOpenSystemEditor')}
        statusMessage={systemEditRefreshingCacheKey === imagePreview?.cacheKey
          ? t('imagePreviewRefreshingAfterEdit')
          : undefined}
        onClose={closeImagePreview}
      />
    </>
  )
}

function getCodeBlockExpansionKey(
  code: string,
  language: string,
  node?: MarkdownCodeNode,
  filePath?: string | null
): string {
  const position = node?.position
  const start = position?.start
  const end = position?.end
  const positionKey = [
    start?.line ?? 0,
    start?.column ?? 0,
    end?.line ?? 0,
    end?.column ?? 0
  ].join(':')
  return [
    filePath ?? '',
    language || 'text',
    positionKey,
    stableStringHash(`${language}\n${code}`)
  ].join('|')
}

function stableStringHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export const WriteMarkdownPreview = memo(function WriteMarkdownPreview(props: Props): ReactElement {
  return (
    <PreviewErrorBoundary
      content={props.content}
      filePath={props.filePath}
      previewErrorMessage={props.previewErrorMessage ?? 'Markdown preview failed, showing source text instead.'}
    >
      <WriteMarkdownPreviewContent {...props} />
    </PreviewErrorBoundary>
  )
})
