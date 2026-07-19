import type { ComponentPropsWithRef, MouseEvent, ReactElement } from 'react'
import { Streamdown, type AnimateOptions, type StreamdownProps } from 'streamdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'streamdown/styles.css'
import { normalizeMarkdownMathDelimiters } from '@shared/write-markdown-math'
import {
  isFileReferenceHref,
  parseFileReferenceHref,
  rehypeFileReferences
} from '../../lib/file-references'
import { useValidatedFileReference } from '../../lib/file-reference-validation'
import { openSafeExternalUrl } from '../../lib/open-external'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { useChatStore } from '../../store/chat-store'
import { StreamdownCode } from './StreamdownCode'
import { AssistantMarkdownImage } from './message-timeline-media'

/**
 * Tuned for faster, cleaner single-line streaming:
 * - keep per-character reveal for short CJK/plain text
 * - use a quick fade instead of blur
 * - reduce stagger so chunks don't "crawl" across the screen
 */
const STREAMING_ANIMATED: AnimateOptions = {
  sep: 'char',
  duration: 120,
  stagger: 8,
  easing: 'ease-out',
  animation: 'fadeIn'
}

const rehypePlugins = [
  rehypeFileReferences,
  rehypeKatex
] satisfies StreamdownProps['rehypePlugins']

const remarkPlugins = [remarkMath, remarkGfm] satisfies StreamdownProps['remarkPlugins']

const components = {
  code: StreamdownCode,
  a: StreamdownLink,
  img: AssistantMarkdownImage
} satisfies StreamdownProps['components']

// Table action controls can trigger React update-depth loops on long final answers.
export const STREAMDOWN_CONTROLS = {
  table: false
} satisfies StreamdownProps['controls']

type StreamdownLinkProps = ComponentPropsWithRef<'a'> & { node?: unknown }

function StreamdownLink({
  href,
  children,
  className,
  title
}: StreamdownLinkProps): ReactElement {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const fileTarget = parseFileReferenceHref(href)
  const fileReferenceHref = isFileReferenceHref(href)
  const validation = useValidatedFileReference(fileTarget, workspaceRoot)
  const isExternal = href ? /^(https?:|mailto:)/i.test(href) : false
  const cleanClassName = className?.replace(/\bds-file-reference-link\b/g, '').trim()

  if (fileReferenceHref && !fileTarget) {
    return (
      <span className={cleanClassName} title={title}>
        {children}
      </span>
    )
  }

  if (fileTarget && validation.status !== 'valid') {
    return (
      <span className={cleanClassName} title={title}>
        {children}
      </span>
    )
  }

  const resolvedFileTarget =
    fileTarget && validation.status === 'valid'
      ? { ...fileTarget, path: validation.path, kind: validation.kind }
      : null

  const openInEditor = (target: NonNullable<typeof resolvedFileTarget>): void => {
    void openWorkspacePathInEditor(target, workspaceRoot).then((result) => {
      if (!result.ok) {
        void window.sciforge?.logError?.('editor-open', 'Failed to open file reference', {
          message: result.message,
          target
        })?.catch(() => undefined)
      }
    })
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (resolvedFileTarget) {
      event.preventDefault()
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        openInEditor(resolvedFileTarget)
        return
      }
      previewWorkspaceFile({ ...resolvedFileTarget, workspaceRoot })
      return
    }

    if (isExternal && href) {
      event.preventDefault()
      void openSafeExternalUrl(href).catch(() => undefined)
    }
  }

  const handleDoubleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!resolvedFileTarget) return
    event.preventDefault()
    openInEditor(resolvedFileTarget)
  }

  return (
    <a
      href={href}
      title={title}
      className={[
        resolvedFileTarget ? 'ds-file-reference-link' : '',
        cleanClassName
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {children}
    </a>
  )
}

const BLOCK_MARKDOWN_REGEX =
  /(^|\n)\s{0,3}(#{1,6}\s|[-+*]\s|\d+\.\s|>\s|```|~~~)|(^|\n)\|.+\|/m

const INLINE_STRUCTURED_MARKDOWN_REGEX =
  /`[^`\n]+`|!\[[^\]]*]\([^)\n]+\)|\[[^\]]+]\([^)\n]+\)/
const MULTILINE_TEXT_REGEX = /\r?\n/
const MAX_ANIMATED_STREAMING_CHARS = 600

export function shouldAnimateStreamingText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.length > MAX_ANIMATED_STREAMING_CHARS) return false
  if (MULTILINE_TEXT_REGEX.test(trimmed)) return false
  return !(
    BLOCK_MARKDOWN_REGEX.test(trimmed) ||
    INLINE_STRUCTURED_MARKDOWN_REGEX.test(trimmed)
  )
}

type Props = {
  /** Markdown source */
  text: string
  /**
   * When true (live SSE chunking), uses Streamdown `streaming` mode with a
   * fast char-level fade so the output feels responsive without the heavy blur.
   */
  streaming: boolean
  className?: string
}

export function StreamdownAssistant({ text, streaming, className }: Props): ReactElement {
  const animated = streaming && shouldAnimateStreamingText(text) ? STREAMING_ANIMATED : false
  const isAnimating = animated !== false
  const normalizedText = normalizeMarkdownMathDelimiters(text)

  return (
    <Streamdown
      className={className}
      mode={streaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={streaming}
      isAnimating={isAnimating}
      animated={animated}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      controls={STREAMDOWN_CONTROLS}
      components={components}
    >
      {normalizedText}
    </Streamdown>
  )
}
