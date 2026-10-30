import { clipboard, nativeImage, type NativeImage } from 'electron'
import juice from 'juice'
import type { Element, ElementContent, Parent, Root, RootContent } from 'hast'
import rehypeMathjax from 'rehype-mathjax/svg'
import rehypeParse from 'rehype-parse'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, {
  defaultSchema,
  type Options as RehypeSanitizeOptions
} from 'rehype-sanitize'
import rehypeShiki, { type RehypeShikiOptions } from '@shikijs/rehype'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import {
  MARKDOWN_WECHAT_FEEDBACK_LIMITS,
  markdownWechatCopyResultSchema,
  markdownWechatRenderInputSchema,
  markdownWechatSelectionInputSchema,
  type MarkdownWechatCopyCounts,
  type MarkdownWechatCopyResult,
  type MarkdownWechatRenderInput,
  type MarkdownWechatSelectionInput,
  type MarkdownWechatWarning,
  type MarkdownWechatWarningCode
} from '../../shared/markdown-wechat'
import {
  normalizeSafeEmbeddedMediaUrl,
  normalizeSafeExternalUrl
} from '../../shared/external-url-policy'
import {
  isExplicitWriteResourceUrl,
  resolveWriteMarkdownResourcePath
} from '../../shared/write-markdown-resource'
import { normalizeMarkdownMathDelimiters } from '../../shared/write-markdown-math'
import { readWorkspaceImage } from './workspace-files'

const SAFE_TEX_PACKAGES = [
  'base',
  'ams',
  'amscd',
  'bbox',
  'boldsymbol',
  'braket',
  'bussproofs',
  'cancel',
  'cases',
  'centernot',
  'color',
  'colortbl',
  'empheq',
  'enclose',
  'extpfeil',
  'gensymb',
  'mathtools',
  'mhchem',
  'newcommand',
  'tagformat',
  'textcomp',
  'textmacros',
  'unicode',
  'upgreek',
  'verb'
] as const

const SHIKI_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'cs',
  'css',
  'diff',
  'dockerfile',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'jsx',
  'kotlin',
  'lua',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'shell',
  'sql',
  'swift',
  'toml',
  'typescript',
  'tsx',
  'vue',
  'xml',
  'yaml'
] as const

const SHIKI_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  csharp: 'cs',
  docker: 'dockerfile',
  js: 'javascript',
  javascriptreact: 'jsx',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shell',
  shellscript: 'shell',
  ts: 'typescript',
  typescriptreact: 'tsx',
  yml: 'yaml',
  zsh: 'shell'
}

const SHIKI_LANGUAGE_SET = new Set<string>([
  ...SHIKI_LANGUAGES,
  ...Object.keys(SHIKI_LANGUAGE_ALIASES),
  'text',
  'txt',
  'plaintext'
])

const MATHJAX_OPTIONS = {
  svg: {
    fontCache: 'none',
    internalSpeechTitles: false
  },
  tex: {
    packages: [...SAFE_TEX_PACKAGES],
    maxBuffer: 50_000,
    maxMacros: 1_000,
    processEscapes: true,
    processEnvironments: true,
    processRefs: true,
    tags: 'ams'
  }
} as const

const SHIKI_OPTIONS: RehypeShikiOptions = {
  theme: 'github-light',
  langs: [...SHIKI_LANGUAGES],
  defaultLanguage: 'text',
  fallbackLanguage: 'text'
}

const ALLOWED_OUTPUT_TAGS = new Set([
  'a',
  'article',
  'blockquote',
  'br',
  'circle',
  'code',
  'del',
  'ellipse',
  'em',
  'g',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'img',
  'li',
  'line',
  'ol',
  'p',
  'path',
  'polygon',
  'polyline',
  'pre',
  'rect',
  'section',
  'span',
  'strong',
  'sub',
  'sup',
  'svg',
  'table',
  'tbody',
  'td',
  'text',
  'th',
  'thead',
  'title',
  'tr',
  'ul'
])

const FIXED_WECHAT_THEME = `
  article.wechat-article {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #1f2329;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;
    font-size: 16px;
    line-height: 1.75;
    letter-spacing: 0.02em;
    text-align: left;
    word-break: break-word;
  }

  article.wechat-article h1,
  article.wechat-article h2,
  article.wechat-article h3,
  article.wechat-article h4 {
    margin: 1.55em 0 0.7em;
    color: #17233d;
    font-weight: 700;
    line-height: 1.32;
  }

  article.wechat-article h1 {
    padding-bottom: 0.35em;
    border-bottom: 2px solid #576b95;
    font-size: 1.75em;
  }

  article.wechat-article h2 {
    padding-left: 0.65em;
    border-left: 4px solid #576b95;
    font-size: 1.42em;
  }

  article.wechat-article h3 {
    font-size: 1.2em;
  }

  article.wechat-article h4 {
    font-size: 1.05em;
  }

  article.wechat-article p {
    margin: 0 0 1em;
  }

  article.wechat-article a {
    color: #576b95;
    text-decoration: none;
  }

  article.wechat-article strong {
    color: #17233d;
    font-weight: 700;
  }

  article.wechat-article blockquote {
    margin: 1.15em 0;
    padding: 0.75em 1em;
    border-left: 4px solid #a6b1c7;
    background: #f6f8fa;
    color: #5b6578;
  }

  article.wechat-article ul,
  article.wechat-article ol {
    margin: 0 0 1em;
    padding-left: 1.6em;
  }

  article.wechat-article li {
    margin: 0.28em 0;
  }

  article.wechat-article .wechat-list-paragraph {
    display: inline;
    margin: 0;
  }

  article.wechat-article code {
    padding: 0.12em 0.35em;
    border-radius: 4px;
    background: #f1f3f5;
    color: #a31545;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.9em;
    line-height: 1.6;
  }

  article.wechat-article pre {
    box-sizing: border-box;
    margin: 1.1em 0;
    padding: 1em;
    border: 1px solid #e5e7eb;
    border-radius: 7px;
    background: #f6f8fa;
    color: #24292f;
    font-size: 0.9em;
    line-height: 1.65;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  article.wechat-article pre code {
    display: block;
    padding: 0;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font-size: 1em;
    white-space: pre-wrap;
  }

  article.wechat-article table {
    box-sizing: border-box;
    width: 100%;
    margin: 1.1em 0;
    border-collapse: collapse;
    color: #1f2329;
    font-size: 0.92em;
    table-layout: fixed;
  }

  article.wechat-article th,
  article.wechat-article td {
    padding: 0.58em 0.68em;
    border: 1px solid #dfe3e8;
    text-align: left;
    vertical-align: top;
    word-break: break-word;
  }

  article.wechat-article th {
    background: #f3f5f7;
    color: #17233d;
    font-weight: 700;
  }

  article.wechat-article hr {
    height: 1px;
    margin: 1.7em 0;
    border: 0;
    background: #dfe3e8;
  }

  article.wechat-article img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 1.15em auto;
  }

  article.wechat-article .wechat-image-fallback {
    display: block;
    margin: 1em 0;
    padding: 0.7em 0.85em;
    border: 1px solid #e5e7eb;
    background: #f8f9fa;
    color: #6b7280;
    font-size: 0.9em;
  }

  article.wechat-article .wechat-task-marker {
    display: inline-block;
    min-width: 1.35em;
    color: #576b95;
    font-weight: 700;
  }

  article.wechat-article .wechat-math-inline {
    display: inline;
    color: #17233d;
    line-height: inherit;
  }

  article.wechat-article .wechat-math-display {
    display: block;
    max-width: 100%;
    margin: 1.15em 0;
    color: #17233d;
    line-height: 0;
    overflow-x: auto;
    text-align: center;
  }

  article.wechat-article .wechat-math-fallback {
    display: inline-block;
    max-width: 100%;
    padding: 0.25em 0.4em;
    background: #fff5f5;
    color: #a61b1b;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
`

const INPUT_SANITIZE_SCHEMA: RehypeSanitizeOptions = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...defaultSchema.attributes?.code ?? [],
      ['className', /^language-./, 'math-inline', 'math-display']
    ]
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https', 'data']
  }
}

type WorkspaceImageReader = (
  payload: Parameters<typeof readWorkspaceImage>[0]
) => ReturnType<typeof readWorkspaceImage>

export type MarkdownWechatClipboardServiceDependencies = {
  readWorkspaceImage?: WorkspaceImageReader
  writeClipboard?: (payload: { html?: string; text: string; image?: NativeImage }) => void
  now?: () => Date
}

export type MarkdownWechatRenderResult = {
  html: string
  plainText: string
  outputBytes: number
  counts: MarkdownWechatCopyCounts
  warnings: MarkdownWechatWarning[]
}

type RenderState = {
  sourcePath: string
  workspaceRoot?: string
  warnings: MarkdownWechatWarning[]
  warningKeys: Set<string>
  formulaCount: number
  inlineFormulaCount: number
  displayFormulaCount: number
  codeBlockCount: number
  imageCount: number
  embeddedImageCount: number
  remoteImageCount: number
  localImageCache: Map<string, Promise<LocalImageResolution>>
}

type LocalImageResolution =
  | { ok: true; dataUrl: string }
  | {
      ok: false
      code: Extract<MarkdownWechatWarningCode, 'image-unavailable' | 'image-unsafe'>
      message: string
    }

function createRenderState(
  input: Pick<MarkdownWechatRenderInput, 'sourcePath' | 'workspaceRoot'>
): RenderState {
  return {
    sourcePath: input.sourcePath,
    workspaceRoot: input.workspaceRoot,
    warnings: [],
    warningKeys: new Set(),
    formulaCount: 0,
    inlineFormulaCount: 0,
    displayFormulaCount: 0,
    codeBlockCount: 0,
    imageCount: 0,
    embeddedImageCount: 0,
    remoteImageCount: 0,
    localImageCache: new Map()
  }
}

function addWarning(
  state: RenderState,
  code: MarkdownWechatWarningCode,
  message: string,
  index?: number
): void {
  if (state.warnings.length >= MARKDOWN_WECHAT_FEEDBACK_LIMITS.maxWarnings) return
  const boundedMessage = message.trim().slice(0, MARKDOWN_WECHAT_FEEDBACK_LIMITS.maxWarningMessageChars)
  const key = `${code}\u0000${boundedMessage}\u0000${index ?? ''}`
  if (!boundedMessage || state.warningKeys.has(key)) return
  state.warningKeys.add(key)
  state.warnings.push({
    code,
    message: boundedMessage,
    ...(index === undefined ? {} : { index })
  })
}

function classNames(node: Element): string[] {
  const value = node.properties?.className
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string'
      ? value.split(/\s+/).filter(Boolean)
      : []
}

function textContent(node: RootContent | Root): string {
  if (node.type === 'text') return node.value
  if (!('children' in node)) return ''
  return node.children.map((child) => textContent(child)).join('')
}

function stringProperty(node: Element, key: string): string | undefined {
  const value = node.properties?.[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function booleanProperty(node: Element, key: string): boolean {
  const value = node.properties?.[key]
  return value === true || value === '' || value === 'true'
}

function element(
  tagName: string,
  properties: Element['properties'] = {},
  children: ElementContent[] = []
): Element {
  return { type: 'element', tagName, properties, children }
}

// Tight Markdown lists have bare inline children. Give each run one paragraph
// so rich-text paste importers keep leading formulas and their prose together.
const LIST_INLINE_TAGS = new Set([
  'a', 'br', 'code', 'del', 'em', 'img', 'input', 'span', 'strong', 'sub', 'sup'
])

function wrapListInlineRuns(node: Element): void {
  const children: ElementContent[] = []
  let run: ElementContent[] = []
  const flush = (): void => {
    if (run.some((child) => child.type === 'element' || (child.type === 'text' && child.value.trim()))) {
      children.push(element('p', { className: ['wechat-list-paragraph'], style: 'display: inline; margin: 0;' }, run))
    } else {
      children.push(...run)
    }
    run = []
  }
  for (const child of node.children) {
    if (child.type === 'text' || (child.type === 'element' && LIST_INLINE_TAGS.has(child.tagName))) {
      run.push(child)
    } else {
      flush()
      children.push(child)
    }
  }
  flush()
  node.children = children
}

function prepareHastTree(tree: Root, state: RenderState): void {
  const walk = (parent: Parent): void => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index]
      if (child.type !== 'element') continue

      if (child.tagName === 'li') wrapListInlineRuns(child)

      if (child.tagName === 'h5' || child.tagName === 'h6') child.tagName = 'h4'

      if (child.tagName === 'input' && stringProperty(child, 'type') === 'checkbox') {
        parent.children[index] = element(
          'span',
          { className: ['wechat-task-marker'] },
          [{ type: 'text', value: booleanProperty(child, 'checked') ? '☑ ' : '☐ ' }]
        )
        continue
      }

      const classes = classNames(child)
      const fencedMath =
        child.tagName === 'pre' &&
        child.children[0]?.type === 'element' &&
        classNames(child.children[0]).includes('language-math')
      const displayMath = classes.includes('math-display') || fencedMath
      const inlineMath =
        classes.includes('math-inline') ||
        (child.tagName === 'code' && classes.includes('language-math'))
      if (displayMath || inlineMath) {
        state.formulaCount += 1
        if (displayMath) state.displayFormulaCount += 1
        else state.inlineFormulaCount += 1
        parent.children[index] = element(
          displayMath ? 'section' : 'span',
          {
            className: [displayMath ? 'wechat-math-display' : 'wechat-math-inline'],
            dataWechatMathDisplay: displayMath ? 'true' : 'false',
            dataWechatMathIndex: String(state.formulaCount),
            dataWechatMathSource: fencedMath && child.children[0]?.type === 'element'
              ? textContent(child.children[0])
              : textContent(child)
          },
          [child]
        )
        continue
      }

      if (
        child.tagName === 'pre' &&
        child.children[0]?.type === 'element' &&
        child.children[0].tagName === 'code'
      ) {
        state.codeBlockCount += 1
        const code = child.children[0]
        const languageClass = classNames(code)
          .find((value) => value.startsWith('language-'))
        const language = languageClass?.slice('language-'.length).toLowerCase()
        if (language && language !== 'math' && !SHIKI_LANGUAGE_SET.has(language)) {
          code.properties.className = ['language-text']
          addWarning(
            state,
            'code-language-fallback',
            `An unsupported code language was rendered as plain text.`
          )
        }
      }

      walk(child)
    }
  }
  walk(tree)
}

const PREVIEW_CODE_BLOCK_CLASS = 'ds-code-block'
const KATEX_DISPLAY_CLASS = 'katex-display'
const KATEX_CLASS = 'katex'
const MERMAID_DIAGRAM_CLASSES = ['write-mermaid-diagram'] as const
const MERMAID_FALLBACK_CLASSES = ['write-mermaid-error', 'write-mermaid-loading'] as const
const FRAGMENT_STRIP_TAGS = new Set(['button', 'style', 'foreignObject'])
const CODE_LANGUAGE_REGEX = /^[a-z0-9+#-]{1,32}$/i

// The selection fragment arrives as rendered preview HTML. Convert the
// preview-only widgets (highlighted code blocks, KaTeX output, mermaid, image
// lightbox buttons) back into canonical structures so the shared publication
// pipeline can style them exactly like a full-document copy.
function normalizeSelectionFragment(tree: Root, state: RenderState): void {
  const walk = (parent: Parent): void => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index]
      if (child.type !== 'element') continue
      const classes = classNames(child)

      if (FRAGMENT_STRIP_TAGS.has(child.tagName)) {
        parent.children.splice(index, 1, ...child.children)
        index -= 1
        continue
      }

      if (classes.includes(KATEX_DISPLAY_CLASS)) {
        const source = katexSourceTex(child)
        if (source !== null) {
          parent.children[index] = displayMathElement(source)
        } else {
          parent.children[index] = {
            type: 'text',
            value: textContent(child)
          }
          addWarning(state, 'formula-invalid', 'A formula could not be converted and was preserved as plain text.')
        }
        continue
      }

      if (classes.includes(KATEX_CLASS)) {
        const source = katexSourceTex(child)
        if (source !== null) {
          parent.children[index] = inlineMathElement(source)
        } else {
          parent.children[index] = {
            type: 'text',
            value: textContent(child)
          }
          addWarning(state, 'formula-invalid', 'A formula could not be converted and was preserved as plain text.')
        }
        continue
      }

      if (classes.includes(PREVIEW_CODE_BLOCK_CLASS)) {
        parent.children[index] = previewCodeBlockElement(child)
        continue
      }

      if (MERMAID_DIAGRAM_CLASSES.some((name) => classes.includes(name))) {
        // Keep the rendered SVG diagram but drop foreign HTML that the
        // publication preflight cannot carry.
        child.tagName = 'section'
        walk(child)
        continue
      }

      if (MERMAID_FALLBACK_CLASSES.some((name) => classes.includes(name))) {
        parent.children[index] = element('p', {}, [
          { type: 'text', value: textContent(child) }
        ])
        continue
      }

      walk(child)
    }
  }
  walk(tree)
}

function katexSourceTex(node: Element): string | null {
  const walk = (parent: Parent): string | null => {
    for (const child of parent.children) {
      if (child.type !== 'element') continue
      if (
        child.tagName === 'annotation' &&
        stringProperty(child, 'encoding') === 'application/x-tex'
      ) {
        return textContent(child).trim()
      }
      const found = walk(child)
      if (found !== null) return found
    }
    return null
  }
  return walk(node)
}

function displayMathElement(source: string): Element {
  return element('pre', {}, [
    element('code', { className: ['language-math'] }, [{ type: 'text', value: source }])
  ])
}

function inlineMathElement(source: string): Element {
  // Mirror the class shape remark-math emits so the shared pipeline detects
  // inline math the same way as a full-document render.
  return element('code', { className: ['language-math', 'math-inline'] }, [
    { type: 'text', value: source }
  ])
}

function previewCodeBlockElement(node: Element): Element {
  const language = normalizeCodeLanguage(stringProperty(node, 'dataLanguage') ?? '')
  const code = firstDescendant(node, 'code')
  const value = code ? textContent(code) : textContent(node)
  return element('pre', {}, [
    element('code', { className: [`language-${language || 'text'}`] }, [{ type: 'text', value }])
  ])
}

function firstDescendant(node: Element, tagName: string): Element | null {
  for (const child of node.children) {
    if (child.type !== 'element') continue
    if (child.tagName === tagName) return child
    const found = firstDescendant(child, tagName)
    if (found) return found
  }
  return null
}

function normalizeCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase()
  return CODE_LANGUAGE_REGEX.test(normalized) ? normalized : ''
}

const PLAIN_TEXT_BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote',
  'tr', 'table', 'ul', 'ol', 'section', 'article', 'hr'
])

function selectionPlainText(node: Root | RootContent): string {
  const parts: string[] = []
  const walk = (value: Root | RootContent): void => {
    if (value.type === 'text') {
      parts.push(value.value)
      return
    }
    if (value.type !== 'element' && value.type !== 'root') return
    const isBlock = value.type === 'element' && PLAIN_TEXT_BLOCK_TAGS.has(value.tagName)
    if (isBlock && parts.length && !parts[parts.length - 1].endsWith('\n')) {
      parts.push('\n')
    }
    if ('children' in value) {
      for (const child of value.children) walk(child)
    }
    if (isBlock) parts.push('\n')
  }
  walk(node)
  return parts.join('').replace(/\n{3,}/gu, '\n\n').trim()
}

function imageFallback(alt: string): Element {
  return element(
    'span',
    { className: ['wechat-image-fallback'] },
    [{ type: 'text', value: alt.trim() ? `图片：${alt.trim()}` : '图片无法嵌入' }]
  )
}

async function resolveLocalImage(
  state: RenderState,
  resolvedPath: string,
  readImage: WorkspaceImageReader
): Promise<LocalImageResolution> {
  const cached = state.localImageCache.get(resolvedPath)
  if (cached) return cached

  const pending = (async (): Promise<LocalImageResolution> => {
    if (!state.workspaceRoot) {
      return {
        ok: false,
        code: 'image-unavailable',
        message: 'A local image could not be embedded because the workspace root is unavailable.'
      }
    }
    const result = await readImage({
      path: resolvedPath,
      workspaceRoot: state.workspaceRoot
    })
    if (!result.ok) {
      return {
        ok: false,
        code: 'image-unavailable',
        message: 'A local image could not be read from the active workspace.'
      }
    }
    const dataUrl = normalizeSafeEmbeddedMediaUrl(result.dataUrl)
    if (!dataUrl || !dataUrl.toLowerCase().startsWith('data:image/')) {
      return {
        ok: false,
        code: 'image-unsafe',
        message: 'A local image used an unsupported or unsafe media format.'
      }
    }
    return { ok: true, dataUrl }
  })()

  state.localImageCache.set(resolvedPath, pending)
  return pending
}

async function resolveImageNode(
  node: Element,
  state: RenderState,
  readImage: WorkspaceImageReader
): Promise<Element> {
  state.imageCount += 1
  const imageIndex = state.imageCount
  const alt = stringProperty(node, 'alt') ?? ''

  const source = stringProperty(node, 'src')?.trim()
  if (!source) {
    addWarning(state, 'image-unavailable', 'An image without a usable source was omitted.', imageIndex)
    return imageFallback(alt)
  }

  const localPath = resolveWriteMarkdownResourcePath(source, state.sourcePath)
  if (localPath) {
    const resolved = await resolveLocalImage(state, localPath, readImage)
    if (!resolved.ok) {
      addWarning(state, resolved.code, resolved.message, imageIndex)
      return imageFallback(alt)
    }
    state.embeddedImageCount += 1
    node.properties.src = resolved.dataUrl
    return node
  }

  if (/^https:/i.test(source)) {
    const normalized = normalizeSafeEmbeddedMediaUrl(source)
    if (!normalized) {
      addWarning(state, 'image-unsafe', 'An unsafe remote image URL was omitted.', imageIndex)
      return imageFallback(alt)
    }
    state.remoteImageCount += 1
    node.properties.src = normalized
    addWarning(
      state,
      'remote-image-preserved',
      'A remote HTTPS image was preserved; final import depends on the destination editor.',
      imageIndex
    )
    return node
  }

  if (/^data:/i.test(source)) {
    const normalized = normalizeSafeEmbeddedMediaUrl(source)
    if (!normalized) {
      addWarning(state, 'image-unsafe', 'An unsafe embedded image was omitted.', imageIndex)
      return imageFallback(alt)
    }
    state.embeddedImageCount += 1
    node.properties.src = normalized
    return node
  }

  addWarning(
    state,
    'image-unsafe',
    isExplicitWriteResourceUrl(source)
      ? 'Only HTTPS remote images and safe raster data URLs can be published.'
      : 'A local image could not be resolved safely.',
    imageIndex
  )
  return imageFallback(alt)
}

function sanitizeLinkNode(node: Element, state: RenderState): void {
  const href = stringProperty(node, 'href')?.trim()
  if (!href) return
  if (href.startsWith('#')) return
  if (!isExplicitWriteResourceUrl(href)) {
    delete node.properties.href
    addWarning(state, 'local-link-removed', 'A workspace-local link was converted to plain text.')
    return
  }
  const normalized = normalizeSafeExternalUrl(href)
  if (!normalized) {
    delete node.properties.href
    addWarning(state, 'unsafe-link-removed', 'An unsafe link target was removed.')
    return
  }
  node.properties.href = normalized
}

async function resolveResources(
  tree: Root,
  state: RenderState,
  readImage: WorkspaceImageReader
): Promise<void> {
  const walk = async (parent: Parent): Promise<void> => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index]
      if (child.type !== 'element') continue
      if (child.tagName === 'img') {
        parent.children[index] = await resolveImageNode(child, state, readImage)
        continue
      }
      if (child.tagName === 'a') sanitizeLinkNode(child, state)
      await walk(child)
    }
  }
  await walk(tree)
}

function hasMathError(node: RootContent): boolean {
  if (node.type !== 'element') return false
  if (classNames(node).includes('mathjax-error')) return true
  if (stringProperty(node, 'dataMmlNode') === 'merror') return true
  return node.children.some((child) => hasMathError(child))
}

function hasUnsafeMathContent(node: RootContent): boolean {
  if (node.type !== 'element') return false
  for (const [key, value] of Object.entries(node.properties)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey.startsWith('on')) return true
    if (typeof value !== 'string') continue
    if (
      (lowerKey === 'style' || lowerKey === 'fill' || lowerKey === 'stroke') &&
      /(?:url\s*\(|javascript:|expression\s*\()/i.test(value)
    ) {
      return true
    }
    if (
      (lowerKey === 'href' || lowerKey === 'xlinkhref') &&
      !value.startsWith('#') &&
      !normalizeSafeExternalUrl(value)
    ) {
      return true
    }
  }
  return node.children.some((child) => hasUnsafeMathContent(child))
}

function replaceInvalidMath(tree: Root, state: RenderState): void {
  const walk = (parent: Parent): void => {
    for (const child of parent.children) {
      if (child.type !== 'element') continue
      const classes = classNames(child)
      if (
        classes.includes('wechat-math-inline') ||
        classes.includes('wechat-math-display')
      ) {
        const source = stringProperty(child, 'dataWechatMathSource') ?? ''
        const display = stringProperty(child, 'dataWechatMathDisplay') === 'true'
        const formulaIndex = Number(stringProperty(child, 'dataWechatMathIndex') ?? '0')
        if (child.children.some((node) => hasMathError(node) || hasUnsafeMathContent(node))) {
          child.children = [
            element(
              'code',
              { className: ['wechat-math-fallback'] },
              [{
                type: 'text',
                value: display ? `\\[\n${source}\n\\]` : `\\(${source}\\)`
              }]
            )
          ]
          addWarning(
            state,
            'formula-invalid',
            'A formula could not be converted and was preserved as readable TeX.',
            Number.isInteger(formulaIndex) && formulaIndex > 0 ? formulaIndex : undefined
          )
        }
      }
      walk(child)
    }
  }
  walk(tree)
}

function appendInlineStyle(node: Element, declaration: string): void {
  const current = stringProperty(node, 'style')?.trim()
  node.properties.style = current
    ? `${current.replace(/;?$/, ';')} ${declaration}`
    : declaration
}

const WECHAT_MATH_FONT_SIZE_PX = 16
const WECHAT_MATH_EX_SIZE_PX = WECHAT_MATH_FONT_SIZE_PX / 2

function mathDimensionInPixels(value: string): number | null {
  const match = /^([0-9]+(?:\.[0-9]+)?)(ex|em|px)?$/i.exec(value.trim())
  if (!match) return null
  const magnitude = Number(match[1])
  if (!Number.isFinite(magnitude) || magnitude <= 0) return null
  const unit = match[2]?.toLowerCase()
  const pixels = unit === 'ex'
    ? magnitude * WECHAT_MATH_EX_SIZE_PX
    : unit === 'em'
      ? magnitude * WECHAT_MATH_FONT_SIZE_PX
      : magnitude
  return Math.round(pixels * 1_000) / 1_000
}

function cleanAndValidateOutputTree(tree: Root): void {
  const walk = (parent: Parent, inDisplayMath = false, mathSvgDepth = 0): void => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index]
      if (child.type !== 'element') continue

      const classes = classNames(child)
      const nextInDisplayMath = inDisplayMath || classes.includes('wechat-math-display')
      const nextMathSvgDepth = mathSvgDepth + (child.tagName === 'svg' ? 1 : 0)

      if (child.tagName === 'mjx-container') {
        child.tagName = 'span'
        delete child.properties.jax
        delete child.properties.display
        if (!nextInDisplayMath) appendInlineStyle(child, 'display: inline;')
      }

      if (child.tagName === 'svg') {
        const width = stringProperty(child, 'width')
        const height = stringProperty(child, 'height')
        // Only the outer formula SVG uses publication sizing. MathJax's nested
        // SVGs are geometric viewports for stretchy glyphs; changing their
        // unitless dimensions clips the glyph. Pixel attributes keep the outer
        // SVG correctly sized even when the destination editor strips inline styles.
        if (mathSvgDepth === 0) {
          if (!nextInDisplayMath) appendInlineStyle(child, 'display: inline-block;')
          const widthPixels = width ? mathDimensionInPixels(width) : null
          const heightPixels = height ? mathDimensionInPixels(height) : null
          if (widthPixels !== null) {
            child.properties.width = String(widthPixels)
            appendInlineStyle(child, `width: ${widthPixels}px;`)
          }
          if (nextInDisplayMath) {
            appendInlineStyle(child, 'max-width: 100%; height: auto;')
          } else if (heightPixels !== null) {
            appendInlineStyle(child, `height: ${heightPixels}px;`)
          }
          if (heightPixels !== null) child.properties.height = String(heightPixels)
        }
      }

      if (!ALLOWED_OUTPUT_TAGS.has(child.tagName)) {
        throw new Error(`Publication preflight rejected the <${child.tagName}> element.`)
      }

      for (const key of Object.keys(child.properties)) {
        const lowerKey = key.toLowerCase()
        if (lowerKey === 'classname' || lowerKey === 'id' || lowerKey.startsWith('data')) {
          delete child.properties[key]
          continue
        }
        if (lowerKey.startsWith('on')) {
          throw new Error('Publication preflight rejected an event handler attribute.')
        }
      }

      const style = stringProperty(child, 'style')
      if (style) {
        if (
          /(?:url\s*\(|expression\s*\(|javascript:|@import|-moz-binding|behavior\s*:|var\s*\(|animation\s*:|position\s*:\s*(?:fixed|sticky))/i.test(style)
        ) {
          throw new Error('Publication preflight rejected an unsafe or externally dependent inline style.')
        }
      }

      for (const key of ['fill', 'stroke']) {
        const value = stringProperty(child, key)
        if (value && /(?:url\s*\(|javascript:|expression\s*\()/i.test(value)) {
          throw new Error('Publication preflight rejected an unsafe SVG presentation attribute.')
        }
      }

      const href = stringProperty(child, 'href')
      if (href && !href.startsWith('#') && !normalizeSafeExternalUrl(href)) {
        throw new Error('Publication preflight rejected an unsafe link protocol.')
      }

      if (child.tagName === 'img') {
        const source = stringProperty(child, 'src')
        const normalized = normalizeSafeEmbeddedMediaUrl(source)
        if (
          !source ||
          !normalized ||
          (!normalized.toLowerCase().startsWith('https:') &&
            !normalized.toLowerCase().startsWith('data:image/'))
        ) {
          throw new Error('Publication preflight rejected an unsafe image source.')
        }
      }

      walk(child, nextInDisplayMath, nextMathSvgDepth)
    }
  }

  walk(tree)
}

function assertSerializedOutput(html: string): void {
  const forbidden = [
    /<\s*style\b/i,
    /<\s*(?:script|iframe|object|embed|form|input|link|meta|base|use|defs)\b/i,
    /\sclass\s*=/i,
    /\son[a-z]+\s*=/i,
    /(?:src|href)\s*=\s*["'](?:file|blob|ftp):/i,
    /font-cache/i
  ]
  if (forbidden.some((pattern) => pattern.test(html))) {
    throw new Error('Publication preflight found unsupported active or externally dependent HTML.')
  }
}

function countsFromState(state: RenderState): MarkdownWechatCopyCounts {
  return {
    formulas: state.formulaCount,
    inlineFormulas: state.inlineFormulaCount,
    displayFormulas: state.displayFormulaCount,
    codeBlocks: state.codeBlockCount,
    embeddedImages: state.embeddedImageCount,
    remoteImages: state.remoteImageCount
  }
}

export async function renderMarkdownForWechat(
  rawInput: MarkdownWechatRenderInput,
  dependencies: Pick<MarkdownWechatClipboardServiceDependencies, 'readWorkspaceImage'> = {}
): Promise<MarkdownWechatRenderResult> {
  const input = markdownWechatRenderInputSchema.parse(rawInput)
  const state = createRenderState(input)
  const readImage = dependencies.readWorkspaceImage ?? ((payload) =>
    readWorkspaceImage(payload, { maxBytes: null }))
  const markdown = normalizeMarkdownMathDelimiters(input.markdown)

  const processor = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, INPUT_SANITIZE_SCHEMA)
    .use(() => (tree: Root) => {
      prepareHastTree(tree, state)
    })
    .use(() => async (tree: Root) => {
      await resolveResources(tree, state, readImage)
    })
    .use(rehypeMathjax, MATHJAX_OPTIONS)
    .use(() => (tree: Root) => {
      replaceInvalidMath(tree, state)
    })
    .use(rehypeShiki, SHIKI_OPTIONS)
    .use(rehypeStringify)

  const rendered = String(await processor.process(markdown))
  return finalizePublicationHtml(rendered, state, markdown)
}

async function finalizePublicationHtml(
  renderedFragment: string,
  state: RenderState,
  plainText: string
): Promise<MarkdownWechatRenderResult> {
  const themedFragment = [
    `<style>${FIXED_WECHAT_THEME}</style>`,
    `<article class="wechat-article">${renderedFragment}</article>`
  ].join('')
  const inlined = juice(themedFragment, {
    applyStyleTags: true,
    inlinePseudoElements: false,
    preserveFontFaces: false,
    preserveImportant: true,
    preserveKeyFrames: false,
    preserveMediaQueries: false,
    preservePseudos: false,
    removeStyleTags: true,
    resolveCSSVariables: false
  })

  const outputProcessor = unified()
    .use(rehypeParse, { fragment: true })
    .use(() => (tree: Root) => {
      cleanAndValidateOutputTree(tree)
    })
    .use(rehypeStringify)
  const html = String(await outputProcessor.process(inlined))
  assertSerializedOutput(html)

  const outputBytes = Buffer.byteLength(html, 'utf8')

  return {
    html,
    plainText,
    outputBytes,
    counts: countsFromState(state),
    warnings: state.warnings
  }
}

export async function renderMarkdownSelectionForWechat(
  rawInput: MarkdownWechatSelectionInput,
  dependencies: Pick<MarkdownWechatClipboardServiceDependencies, 'readWorkspaceImage'> = {}
): Promise<MarkdownWechatRenderResult> {
  const input = markdownWechatSelectionInputSchema.parse(rawInput)
  const state = createRenderState(input)
  const readImage = dependencies.readWorkspaceImage ?? ((payload) =>
    readWorkspaceImage(payload, { maxBytes: null }))

  const fragmentProcessor = unified()
    .use(rehypeParse, { fragment: true })
    .use(() => (tree: Root) => {
      normalizeSelectionFragment(tree, state)
    })
    .use(rehypeSanitize, INPUT_SANITIZE_SCHEMA)
    .use(() => (tree: Root) => {
      prepareHastTree(tree, state)
    })
    .use(() => async (tree: Root) => {
      await resolveResources(tree, state, readImage)
    })
  const tree = await fragmentProcessor.run(fragmentProcessor.parse(input.html))
  const plainText = selectionPlainText(tree)

  const tailProcessor = unified()
    .use(rehypeMathjax, MATHJAX_OPTIONS)
    .use(() => (root: Root) => {
      replaceInvalidMath(root, state)
    })
    .use(rehypeShiki, SHIKI_OPTIONS)
    .use(rehypeStringify)
  const rendered = tailProcessor.stringify(await tailProcessor.run(tree))
  return finalizePublicationHtml(rendered, state, plainText)
}

async function copyDocumentResult(
  rendered: MarkdownWechatRenderResult,
  text: string,
  adaptHtml: (html: string) => string,
  dependencies: MarkdownWechatClipboardServiceDependencies
): Promise<MarkdownWechatCopyResult> {
  const html = adaptHtml(rendered.html)
  const copiedAt = (dependencies.now ?? (() => new Date()))().toISOString()
  const result = markdownWechatCopyResultSchema.parse({
    copiedAt,
    outputBytes: Buffer.byteLength(html, 'utf8'),
    counts: rendered.counts,
    warnings: rendered.warnings,
    effect: 'clipboard-write'
  })

  const writeClipboard = dependencies.writeClipboard ?? ((payload) => clipboard.write(payload))
  writeClipboard({
    html,
    text
  })
  return result
}

export async function copyMarkdownForWechat(
  input: MarkdownWechatRenderInput,
  dependencies: MarkdownWechatClipboardServiceDependencies = {}
): Promise<MarkdownWechatCopyResult> {
  const rendered = await renderMarkdownForWechat(input, dependencies)
  return copyDocumentResult(rendered, input.markdown, (html) => html, dependencies)
}

async function copySelectionResult(
  rendered: MarkdownWechatRenderResult,
  adaptHtml: (html: string) => string,
  dependencies: MarkdownWechatClipboardServiceDependencies
): Promise<MarkdownWechatCopyResult> {
  const html = adaptHtml(rendered.html)
  const copiedAt = (dependencies.now ?? (() => new Date()))().toISOString()
  const result = markdownWechatCopyResultSchema.parse({
    copiedAt,
    outputBytes: Buffer.byteLength(html, 'utf8'),
    counts: rendered.counts,
    warnings: rendered.warnings,
    effect: 'clipboard-write'
  })

  const writeClipboard = dependencies.writeClipboard ?? ((payload) => clipboard.write(payload))
  writeClipboard({
    html,
    text: rendered.plainText
  })
  return result
}

export async function copyMarkdownSelectionForWechat(
  input: MarkdownWechatSelectionInput,
  dependencies: MarkdownWechatClipboardServiceDependencies = {}
): Promise<MarkdownWechatCopyResult> {
  const rendered = await renderMarkdownSelectionForWechat(input, dependencies)
  return copySelectionResult(rendered, (html) => html, dependencies)
}

/** Share safe rendering, then adapt the document structure for rich-text paste. */
export async function copyMarkdownForFeishu(
  input: MarkdownWechatRenderInput,
  dependencies: MarkdownWechatClipboardServiceDependencies = {}
): Promise<MarkdownWechatCopyResult> {
  const rendered = await renderMarkdownForWechat(input, dependencies)
  return copyDocumentResult(rendered, input.markdown, adaptPublicationHtmlForBlockEditor, dependencies)
}

export async function copyMarkdownSelectionForFeishu(
  input: MarkdownWechatSelectionInput,
  dependencies: MarkdownWechatClipboardServiceDependencies = {}
): Promise<MarkdownWechatCopyResult> {
  const rendered = await renderMarkdownSelectionForWechat(input, dependencies)
  return copySelectionResult(rendered, adaptPublicationHtmlForBlockEditor, dependencies)
}

/** Share safe rendering, then adapt the document structure for rich-text paste. */
export async function copyMarkdownForZhihu(
  input: MarkdownWechatRenderInput,
  dependencies: MarkdownWechatClipboardServiceDependencies = {}
): Promise<MarkdownWechatCopyResult> {
  const rendered = await renderMarkdownForWechat(input, dependencies)
  const imageDataUrl = await findFirstZhihuImageDataUrl(input.markdown, input, dependencies)
  const copiedAt = (dependencies.now ?? (() => new Date()))().toISOString()
  const result = markdownWechatCopyResultSchema.parse({
    copiedAt,
    outputBytes: Buffer.byteLength(input.markdown, 'utf8'),
    counts: rendered.counts,
    warnings: rendered.warnings,
    effect: 'clipboard-write'
  })
  const writeClipboard = dependencies.writeClipboard ?? ((payload) => clipboard.write(payload))
  writeClipboard({
    text: input.markdown,
    ...(imageDataUrl ? { image: nativeImage.createFromDataURL(imageDataUrl) } : {})
  })
  return result
}

export async function copyMarkdownSelectionForZhihu(
  input: MarkdownWechatSelectionInput,
  dependencies: MarkdownWechatClipboardServiceDependencies = {}
): Promise<MarkdownWechatCopyResult> {
  const rendered = await renderMarkdownSelectionForWechat(input, dependencies)
  return copySelectionResult(rendered, adaptPublicationHtmlForZhihu, dependencies)
}

async function findFirstZhihuImageDataUrl(
  markdown: string,
  input: MarkdownWechatRenderInput,
  dependencies: MarkdownWechatClipboardServiceDependencies
): Promise<string | undefined> {
  const readImage = dependencies.readWorkspaceImage ?? ((payload) =>
    readWorkspaceImage(payload, { maxBytes: null }))
  const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu
  const matches = [...markdown.matchAll(imagePattern)]
  for (const match of matches) {
    const localPath = resolveWriteMarkdownResourcePath(match[2], input.sourcePath)
    if (!localPath || !input.workspaceRoot) continue
    const result = await readImage({ path: localPath, workspaceRoot: input.workspaceRoot })
    if (result.ok && result.dataUrl.startsWith('data:image/')) return result.dataUrl
  }
  return undefined
}

// Block-based rich-text editors (Feishu docs, Zhihu articles) keep tables and
// paragraphs as document blocks instead of nesting everything inside a
// publication-specific article/section container.
function adaptPublicationHtmlForBlockEditor(html: string): string {
  const processor = unified().use(rehypeParse, { fragment: true }).use(rehypeStringify)
  const tree = processor.parse(html)
  const walk = (parent: Parent): void => {
    for (const child of parent.children) {
      if (child.type !== 'element') continue
      // Keep tables as document blocks rather than nesting the whole document
      // inside a publication-specific article/section container.
      if (child.tagName === 'article' || child.tagName === 'section') child.tagName = 'div'
      if (child.tagName === 'td' || child.tagName === 'th') {
        // Give cell inline content an explicit paragraph without wrapping
        // existing block elements or flattening links, line breaks and images.
        const children: ElementContent[] = []
        let inline: ElementContent[] = []
        const flush = (): void => {
          if (!inline.length) return
          children.push(element('p', { style: 'margin: 0;' }, inline))
          inline = []
        }
        for (const node of child.children) {
          if (node.type === 'element' && CELL_BLOCK_TAGS.has(node.tagName)) {
            flush()
            children.push(node)
          } else inline.push(node)
        }
        flush()
        child.children = children.length ? children : [element('p', {}, [element('br', {}, [])])]
      }
      walk(child)
    }
  }
  walk(tree)
  const output = processor.stringify(tree)
  assertSerializedOutput(output)
  return output
}

// Zhihu's editor imports document blocks and deliberately drops presentation
// styles copied from other editors. Keep the semantic structure, remove the
// publication theme, and make images explicit paragraph blocks so the paste
// importer treats them as content instead of an unsupported inline widget.
function adaptPublicationHtmlForZhihu(html: string): string {
  const processor = unified().use(rehypeParse, { fragment: true }).use(rehypeStringify)
  const tree = processor.parse(html)
  const walk = (parent: Parent): void => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index]
      if (child.type !== 'element') continue

      if (child.tagName === 'article' || child.tagName === 'section') child.tagName = 'div'

      // Inline theme CSS is not portable to Zhihu and causes oversized
      // headings/tables. Preserve only image sizing, which is honored by the
      // editor while importing a data URL.
      if (child.tagName !== 'img') delete child.properties.style
      else child.properties.style = 'display: block; max-width: 100%; height: auto;'

      if (child.tagName === 'img') {
        const paragraph = element('p', { style: 'margin: 0; text-align: center;' }, [child])
        parent.children[index] = paragraph
        continue
      }

      if (child.tagName === 'td' || child.tagName === 'th') {
        const children: ElementContent[] = []
        let inline: ElementContent[] = []
        const flush = (): void => {
          if (!inline.length) return
          children.push(element('p', { style: 'margin: 0;' }, inline))
          inline = []
        }
        for (const node of child.children) {
          if (node.type === 'element' && CELL_BLOCK_TAGS.has(node.tagName)) {
            flush()
            children.push(node)
          } else inline.push(node)
        }
        flush()
        child.children = children.length ? children : [element('p', {}, [element('br', {}, [])])]
      }

      walk(child)
    }
  }
  walk(tree)
  const output = processor.stringify(tree)
  assertSerializedOutput(output)
  return output
}

const CELL_BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'blockquote', 'pre', 'ul', 'ol', 'table',
  'h1', 'h2', 'h3', 'h4', 'hr'
])
