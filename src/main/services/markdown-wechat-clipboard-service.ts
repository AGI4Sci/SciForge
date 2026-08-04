import { clipboard } from 'electron'
import juice from 'juice'
import type { Element, ElementContent, Parent, Root, RootContent } from 'hast'
import rehypeMathjax from 'rehype-mathjax/svg'
import rehypeParse from 'rehype-parse'
import rehypeSanitize, {
  defaultSchema,
  type Options as RehypeSanitizeOptions
} from 'rehype-sanitize'
import rehypeShiki from '@shikijs/rehype'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import {
  MARKDOWN_WECHAT_LIMITS,
  markdownWechatCopyResultSchema,
  markdownWechatRenderInputSchema,
  type MarkdownWechatCopyCounts,
  type MarkdownWechatCopyResult,
  type MarkdownWechatRenderInput,
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
    display: inline-block;
    max-width: 100%;
    color: #17233d;
    line-height: 0;
    vertical-align: -0.18em;
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

type WorkspaceImageReader = typeof readWorkspaceImage

export type MarkdownWechatClipboardServiceDependencies = {
  readWorkspaceImage?: WorkspaceImageReader
  writeClipboard?: (payload: { html: string; text: string }) => void
  now?: () => Date
}

export type MarkdownWechatRenderResult = {
  html: string
  outputBytes: number
  counts: MarkdownWechatCopyCounts
  warnings: MarkdownWechatWarning[]
}

type RenderState = {
  sourcePath: string
  workspaceRoot?: string
  warnings: MarkdownWechatWarning[]
  warningKeys: Set<string>
  rawHtmlFound: boolean
  formulaCount: number
  inlineFormulaCount: number
  displayFormulaCount: number
  codeBlockCount: number
  imageCount: number
  embeddedImageCount: number
  remoteImageCount: number
  totalEmbeddedImageBytes: number
  localImageCache: Map<string, Promise<LocalImageResolution>>
}

type LocalImageResolution =
  | { ok: true; dataUrl: string; size: number }
  | {
      ok: false
      code: Extract<MarkdownWechatWarningCode, 'image-unavailable' | 'image-unsafe' | 'image-too-large'>
      message: string
    }

function createRenderState(input: MarkdownWechatRenderInput): RenderState {
  return {
    sourcePath: input.sourcePath,
    workspaceRoot: input.workspaceRoot,
    warnings: [],
    warningKeys: new Set(),
    rawHtmlFound: false,
    formulaCount: 0,
    inlineFormulaCount: 0,
    displayFormulaCount: 0,
    codeBlockCount: 0,
    imageCount: 0,
    embeddedImageCount: 0,
    remoteImageCount: 0,
    totalEmbeddedImageBytes: 0,
    localImageCache: new Map()
  }
}

function addWarning(
  state: RenderState,
  code: MarkdownWechatWarningCode,
  message: string,
  index?: number
): void {
  if (state.warnings.length >= MARKDOWN_WECHAT_LIMITS.maxWarnings) return
  const boundedMessage = message.trim().slice(0, MARKDOWN_WECHAT_LIMITS.maxWarningMessageChars)
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

function prepareMarkdownSource(state: RenderState): () => (tree: Root) => void {
  return () => (tree) => {
    visit(tree, 'html', () => {
      state.rawHtmlFound = true
    })
  }
}

function prepareHastTree(tree: Root, state: RenderState): void {
  const walk = (parent: Parent): void => {
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index]
      if (child.type !== 'element') continue

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
        if (state.formulaCount > MARKDOWN_WECHAT_LIMITS.maxFormulas) {
          throw new Error(
            `Markdown contains more than ${MARKDOWN_WECHAT_LIMITS.maxFormulas} formulas.`
          )
        }
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

function imageFallback(alt: string): Element {
  return element(
    'span',
    { className: ['wechat-image-fallback'] },
    [{ type: 'text', value: alt.trim() ? `图片：${alt.trim()}` : '图片无法嵌入' }]
  )
}

function estimatedDataUrlBytes(value: string): number | null {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,([a-z0-9+/=_-]+)$/i.exec(value)
  if (!match) return null
  const encoded = match[2]
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding)
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
    if (result.size > MARKDOWN_WECHAT_LIMITS.maxImageBytes) {
      return {
        ok: false,
        code: 'image-too-large',
        message: `A local image exceeded the ${MARKDOWN_WECHAT_LIMITS.maxImageBytes} byte per-image limit.`
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
    return { ok: true, dataUrl, size: result.size }
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
  if (imageIndex > MARKDOWN_WECHAT_LIMITS.maxImages) {
    addWarning(
      state,
      'image-limit-exceeded',
      `Images after the first ${MARKDOWN_WECHAT_LIMITS.maxImages} were omitted.`,
      MARKDOWN_WECHAT_LIMITS.maxImages
    )
    return imageFallback(alt)
  }

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
    if (
      state.totalEmbeddedImageBytes + resolved.size >
      MARKDOWN_WECHAT_LIMITS.maxTotalImageBytes
    ) {
      addWarning(
        state,
        'image-too-large',
        `Embedded images exceeded the ${MARKDOWN_WECHAT_LIMITS.maxTotalImageBytes} byte document limit.`,
        imageIndex
      )
      return imageFallback(alt)
    }
    state.totalEmbeddedImageBytes += resolved.size
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
      'A remote HTTPS image was preserved; final import depends on the WeChat editor.',
      imageIndex
    )
    return node
  }

  if (/^data:/i.test(source)) {
    const normalized = normalizeSafeEmbeddedMediaUrl(source)
    const size = normalized ? estimatedDataUrlBytes(normalized) : null
    if (!normalized || size === null) {
      addWarning(state, 'image-unsafe', 'An unsafe embedded image was omitted.', imageIndex)
      return imageFallback(alt)
    }
    if (
      size > MARKDOWN_WECHAT_LIMITS.maxImageBytes ||
      state.totalEmbeddedImageBytes + size > MARKDOWN_WECHAT_LIMITS.maxTotalImageBytes
    ) {
      addWarning(state, 'image-too-large', 'An embedded image exceeded the publication limit.', imageIndex)
      return imageFallback(alt)
    }
    state.totalEmbeddedImageBytes += size
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
      }

      if (child.tagName === 'svg') {
        const width = stringProperty(child, 'width')
        const height = stringProperty(child, 'height')
        // Only the outer formula SVG uses CSS sizing. MathJax's nested SVGs are
        // geometric viewports for stretchy glyphs; moving their unitless SVG
        // dimensions into CSS makes the declarations invalid and clips the glyph.
        if (mathSvgDepth === 0) {
          if (width) appendInlineStyle(child, `width: ${width};`)
          if (nextInDisplayMath) {
            appendInlineStyle(child, 'max-width: 100%; height: auto;')
          } else if (height) {
            appendInlineStyle(child, `height: ${height};`)
          }
          delete child.properties.width
          delete child.properties.height
        }
      }

      if (!ALLOWED_OUTPUT_TAGS.has(child.tagName)) {
        throw new Error(`WeChat preflight rejected the <${child.tagName}> element.`)
      }

      for (const key of Object.keys(child.properties)) {
        const lowerKey = key.toLowerCase()
        if (lowerKey === 'classname' || lowerKey === 'id' || lowerKey.startsWith('data')) {
          delete child.properties[key]
          continue
        }
        if (lowerKey.startsWith('on')) {
          throw new Error('WeChat preflight rejected an event handler attribute.')
        }
      }

      const style = stringProperty(child, 'style')
      if (style) {
        if (
          /(?:url\s*\(|expression\s*\(|javascript:|@import|-moz-binding|behavior\s*:|var\s*\(|animation\s*:|position\s*:\s*(?:fixed|sticky))/i.test(style)
        ) {
          throw new Error('WeChat preflight rejected an unsafe or externally dependent inline style.')
        }
      }

      for (const key of ['fill', 'stroke']) {
        const value = stringProperty(child, key)
        if (value && /(?:url\s*\(|javascript:|expression\s*\()/i.test(value)) {
          throw new Error('WeChat preflight rejected an unsafe SVG presentation attribute.')
        }
      }

      const href = stringProperty(child, 'href')
      if (href && !href.startsWith('#') && !normalizeSafeExternalUrl(href)) {
        throw new Error('WeChat preflight rejected an unsafe link protocol.')
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
          throw new Error('WeChat preflight rejected an unsafe image source.')
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
    throw new Error('WeChat preflight found unsupported active or externally dependent HTML.')
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
  const readImage = dependencies.readWorkspaceImage ?? readWorkspaceImage
  const markdown = normalizeMarkdownMathDelimiters(input.markdown)

  const processor = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkGfm)
    .use(prepareMarkdownSource(state))
    .use(remarkRehype)
    .use(rehypeSanitize, INPUT_SANITIZE_SCHEMA)
    .use(() => (tree: Root) => {
      prepareHastTree(tree, state)
    })
    .use(() => async (tree: Root) => {
      await resolveResources(tree, state, readImage)
    })
    .use(rehypeMathjax, {
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
    })
    .use(() => (tree: Root) => {
      replaceInvalidMath(tree, state)
    })
    .use(rehypeShiki, {
      theme: 'github-light',
      langs: [...SHIKI_LANGUAGES],
      defaultLanguage: 'text',
      fallbackLanguage: 'text'
    })
    .use(rehypeStringify)

  const rendered = String(await processor.process(markdown))
  if (state.rawHtmlFound) {
    addWarning(
      state,
      'raw-html-omitted',
      'Raw HTML was omitted from the publication copy for safety.'
    )
  }

  const themedFragment = [
    `<style>${FIXED_WECHAT_THEME}</style>`,
    `<article class="wechat-article">${rendered}</article>`
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
  if (outputBytes > MARKDOWN_WECHAT_LIMITS.maxOutputBytes) {
    throw new Error(
      `WeChat HTML is ${outputBytes} bytes, exceeding the ${MARKDOWN_WECHAT_LIMITS.maxOutputBytes} byte limit.`
    )
  }

  return {
    html,
    outputBytes,
    counts: countsFromState(state),
    warnings: state.warnings
  }
}

export async function copyMarkdownForWechat(
  input: MarkdownWechatRenderInput,
  dependencies: MarkdownWechatClipboardServiceDependencies = {}
): Promise<MarkdownWechatCopyResult> {
  const rendered = await renderMarkdownForWechat(input, dependencies)
  const copiedAt = (dependencies.now ?? (() => new Date()))().toISOString()
  const result = markdownWechatCopyResultSchema.parse({
    copiedAt,
    outputBytes: rendered.outputBytes,
    counts: rendered.counts,
    warnings: rendered.warnings,
    effect: 'clipboard-write'
  })

  const writeClipboard = dependencies.writeClipboard ?? ((payload) => clipboard.write(payload))
  writeClipboard({
    html: rendered.html,
    text: input.markdown
  })
  return result
}
