import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
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
import { harden } from 'rehype-harden'
import type { PluggableList } from 'unified'
import { useTranslation } from 'react-i18next'
import {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath,
  transformWriteMarkdownLinkUrl,
  transformWriteMarkdownMediaUrl
} from '@shared/write-markdown-resource'
import {
  SAFE_EMBEDDED_MEDIA_PROTOCOLS,
  SAFE_EXTERNAL_PROTOCOLS,
  normalizeSafeEmbeddedMediaUrl
} from '@shared/external-url-policy'
import { normalizeMarkdownMathDelimiters } from '@shared/write-markdown-math'
import {
  highlightCodeHtml,
  renderFallbackCodeHtml
} from '../../lib/code-highlighting'
import { FILE_REFERENCE_SCHEMES } from '../../lib/file-references'
import { openSafeExternalUrl } from '../../lib/open-external'

export {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath
} from '@shared/write-markdown-resource'

type Props = {
  content: string
  isMarkdown: boolean
  filePath?: string | null
  workspaceRoot?: string | null
  previewErrorMessage?: string
  loadWorkspaceImage?: WriteMarkdownWorkspaceImageLoader
}

export type WriteMarkdownWorkspaceImageLoader = (input: {
  path: string
  workspaceRoot: string
}) => Promise<{
  ok: true
  dataUrl: string
} | {
  ok: false
  message?: string
}>

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

export const writeMarkdownHardenOptions = {
  defaultOrigin: 'https://sciforge.local',
  allowedLinkPrefixes: [...SAFE_EXTERNAL_PROTOCOLS, ...FILE_REFERENCE_SCHEMES],
  allowedImagePrefixes: [...SAFE_EMBEDDED_MEDIA_PROTOCOLS]
}

const rehypePlugins = [
  rehypeKatex,
  [
    harden,
    writeMarkdownHardenOptions
  ]
] as unknown as PluggableList

const remarkPlugins = [remarkMath, remarkGfm] as unknown as PluggableList

const LANGUAGE_REGEX = /language-([^\s]+)/
const TRAILING_NEWLINES_REGEX = /\n+$/
const COLLAPSE_HEIGHT = 200
const COPY_RESET_MS = 2000

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
  filePath?: string | null
  workspaceRoot?: string | null
  loadWorkspaceImage?: WriteMarkdownWorkspaceImageLoader
} & Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'alt'>

function ResolvedMarkdownImage({
  src,
  alt,
  filePath,
  workspaceRoot,
  loadWorkspaceImage,
  ...props
}: ResolvedMarkdownImageProps): ReactElement {
  const [resolvedSrc, setResolvedSrc] = useState(() => resolveWriteMarkdownResource(src, filePath))
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadFailed(false)
    const localPath = resolveWriteMarkdownResourcePath(src, filePath)
    const externalSrc = resolveWriteMarkdownResource(src, filePath)
    setResolvedSrc(localPath ? undefined : externalSrc)

    if (!localPath) return
    const root = workspaceRoot?.trim()
    if (!root || !loadWorkspaceImage) {
      setLoadFailed(true)
      return
    }

    void loadWorkspaceImage({ path: localPath, workspaceRoot: root })
      .then((result) => {
        if (cancelled) return
        const safeDataUrl = result.ok ? normalizeSafeEmbeddedMediaUrl(result.dataUrl) : null
        if (safeDataUrl) {
          setResolvedSrc(safeDataUrl)
        } else {
          setLoadFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [src, filePath, workspaceRoot, loadWorkspaceImage])

  if (loadFailed) {
    return (
      <span className="inline-flex max-w-full items-center rounded-lg border border-red-200/70 bg-red-50/80 px-2 py-1 text-[12px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
        {alt || src || 'Image could not be loaded'}
      </span>
    )
  }

  return (
    <img
      {...props}
      alt={alt ?? ''}
      {...(resolvedSrc ? { src: resolvedSrc } : {})}
    />
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

function WriteMarkdownPreviewContent({ content, isMarkdown, filePath, workspaceRoot, loadWorkspaceImage }: Props): ReactElement {
  const [expandedCodeBlocks, setExpandedCodeBlocks] = useState<Record<string, boolean>>({})
  const setCodeBlockExpanded = useCallback((key: string, expanded: boolean): void => {
    setExpandedCodeBlocks((current) => {
      if (current[key] === expanded) return current
      return {
        ...current,
        [key]: expanded
      }
    })
  }, [])
  const codeBlockExpansionContext = useMemo<CodeBlockExpansionContextValue>(() => ({
    expandedCodeBlocks,
    filePath,
    setCodeBlockExpanded
  }), [expandedCodeBlocks, filePath, setCodeBlockExpanded])

  useEffect(() => {
    setExpandedCodeBlocks({})
  }, [filePath])

  const markdownContent = useMemo(() => normalizeMarkdownMathDelimiters(content), [content])
  const markdownComponents = useMemo(() => ({
    a: ({ href, children, ...props }: ComponentPropsWithoutRef<'a'>): ReactNode => (
      <a
        {...props}
        href={href}
        onClick={(event) => {
          if (!href) return
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
  }), [filePath, loadWorkspaceImage, workspaceRoot])

  if (!isMarkdown) return plainTextFallback(content)
  return (
    <div className="ds-markdown write-markdown-preview min-h-full text-ds-ink">
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
    </div>
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

export function WriteMarkdownPreview(props: Props): ReactElement {
  return (
    <PreviewErrorBoundary
      content={props.content}
      filePath={props.filePath}
      previewErrorMessage={props.previewErrorMessage ?? 'Markdown preview failed, showing source text instead.'}
    >
      <WriteMarkdownPreviewContent {...props} />
    </PreviewErrorBoundary>
  )
}
