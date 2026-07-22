import { BrowserWindow, clipboard, dialog } from 'electron'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { createElement, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { PluggableList } from 'unified'
import type {
  WriteExportFormat,
  WriteExportPayload,
  WriteExportResult,
  WriteRichClipboardPayload,
  WriteRichClipboardResult
} from '../../shared/write-export'
import { normalizeMarkdownMathDelimiters } from '../../shared/write-markdown-math'
import { markdownToLatexDocument } from '../../shared/write-markdown-latex'
import {
  resolveWriteMarkdownLinkResource,
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath,
  transformWriteMarkdownLinkUrl,
  transformWriteMarkdownMediaUrl
} from '../../shared/write-markdown-resource'
import { normalizeSafeEmbeddedMediaUrl } from '../../shared/external-url-policy'
import { readWorkspaceImage, resolveWorkspaceFile } from './workspace-service'
import {
  resolveSafeWorkspaceWriteTarget,
  writeSafeWorkspaceFile
} from '@sciforge/domain-sdk/node/workspace-paths'

type HtmlToDocxDocumentOptions = {
  title?: string
  creator?: string
  keywords?: string[]
  description?: string
  font?: string
  fontSize?: number
}

type HtmlToDocxConverter = (
  htmlString: string,
  headerHtmlString?: string | null,
  documentOptions?: HtmlToDocxDocumentOptions,
  footerHtmlString?: string | null
) => Promise<ArrayBuffer | Blob>

type MarkdownAstNode = {
  type?: string
  url?: unknown
  children?: MarkdownAstNode[]
}

const require = createRequire(import.meta.url)
const htmlToDocx = require('html-to-docx') as HtmlToDocxConverter
const katexCssPath = require.resolve('katex/dist/katex.min.css')

const markdownRemarkPlugins = [remarkMath, remarkGfm]
const markdownRehypePlugins = [rehypeKatex] as unknown as PluggableList

function writeMarkdownUrlTransform(value: string, key: string): string {
  if (key === 'src') return transformWriteMarkdownMediaUrl(value)
  if (key === 'href') return transformWriteMarkdownLinkUrl(value)
  return value
}

const EXPORT_CSS = `
  :root {
    color-scheme: light;
  }

  * {
    box-sizing: border-box;
  }

  html {
    background: #ffffff;
  }

  body {
    margin: 0;
    background: #ffffff;
    color: #111827;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 15px;
    line-height: 1.72;
  }

  a {
    color: #0f62fe;
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  .document-shell {
    padding: 22mm 18mm;
  }

  .markdown-body {
    max-width: 100%;
  }

  .markdown-body > :first-child {
    margin-top: 0;
  }

  .markdown-body > :last-child {
    margin-bottom: 0;
  }

  .markdown-body p,
  .markdown-body ul,
  .markdown-body ol,
  .markdown-body blockquote,
  .markdown-body pre,
  .markdown-body table {
    margin: 0 0 1em;
  }

  .markdown-body h1,
  .markdown-body h2,
  .markdown-body h3,
  .markdown-body h4,
  .markdown-body h5,
  .markdown-body h6 {
    margin: 1.45em 0 0.65em;
    line-height: 1.24;
    color: #0f172a;
    font-weight: 700;
  }

  .markdown-body h1 {
    font-size: 2em;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 0.3em;
  }

  .markdown-body h2 {
    font-size: 1.55em;
    border-bottom: 1px solid #edf2f7;
    padding-bottom: 0.24em;
  }

  .markdown-body h3 {
    font-size: 1.25em;
  }

  .markdown-body ul,
  .markdown-body ol {
    padding-left: 1.5em;
  }

  .markdown-body li + li {
    margin-top: 0.3em;
  }

  .markdown-body blockquote {
    padding: 0.3em 0 0.3em 1em;
    border-left: 4px solid #dbe4ff;
    color: #475569;
    background: #f8fbff;
  }

  .markdown-body code {
    font-family: "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace;
    font-size: 0.92em;
  }

  .markdown-body p code,
  .markdown-body li code,
  .markdown-body td code {
    padding: 0.12em 0.38em;
    border-radius: 0.42em;
    background: #f1f5f9;
    color: #0f172a;
  }

  .markdown-body pre {
    overflow-x: auto;
    padding: 0.95em 1.05em;
    border-radius: 0.9em;
    background: #0f172a;
    color: #e2e8f0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .markdown-body pre code {
    background: transparent;
    color: inherit;
    padding: 0;
  }

  .markdown-body hr {
    height: 1px;
    border: 0;
    background: #e5e7eb;
    margin: 1.6em 0;
  }

  .markdown-body table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95em;
  }

  .markdown-body th,
  .markdown-body td {
    border: 1px solid #dbe3ee;
    padding: 0.5em 0.7em;
    vertical-align: top;
    text-align: left;
  }

  .markdown-body th {
    background: #f8fafc;
    font-weight: 700;
  }

  .markdown-body img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 1rem auto;
  }

  .plain-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace;
  }

  @page {
    size: A4;
    margin: 0;
  }
`

let katexCssCache: string | null = null

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(filePath)
}

function basenameWithoutExtension(filePath: string): string {
  const name = basename(filePath)
  const extension = extname(name)
  return extension ? name.slice(0, -extension.length) : name
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function exportExtension(format: WriteExportFormat): string {
  if (format === 'html') return '.html'
  if (format === 'pdf') return '.pdf'
  if (format === 'doc') return '.doc'
  if (format === 'tex') return '.tex'
  return '.docx'
}

function exportDialogFilter(format: WriteExportFormat): Electron.FileFilter {
  if (format === 'html') return { name: 'HTML', extensions: ['html'] }
  if (format === 'pdf') return { name: 'PDF', extensions: ['pdf'] }
  if (format === 'doc') return { name: 'DOC', extensions: ['doc'] }
  if (format === 'tex') return { name: 'LaTeX', extensions: ['tex'] }
  return { name: 'DOCX', extensions: ['docx'] }
}

function ensureExportExtension(targetPath: string, format: WriteExportFormat): string {
  const extension = exportExtension(format)
  return extname(targetPath).trim() ? targetPath : `${targetPath}${extension}`
}

function defaultExportPath(sourcePath: string, format: WriteExportFormat): string {
  return join(dirname(sourcePath), `${basenameWithoutExtension(sourcePath)}${exportExtension(format)}`)
}

async function readKatexCss(): Promise<string> {
  if (katexCssCache !== null) return katexCssCache
  try {
    katexCssCache = await readFile(katexCssPath, 'utf8')
  } catch {
    katexCssCache = ''
  }
  return katexCssCache
}

function renderPlainTextFragment(content: string): string {
  return renderToStaticMarkup(
    createElement(
      'pre',
      {
        className: 'plain-text'
      },
      normalizeMarkdownMathDelimiters(content)
    )
  )
}

function collectMarkdownImageSources(content: string): Set<string> {
  const tree = unified().use(remarkParse).parse(content) as MarkdownAstNode
  const sources = new Set<string>()
  const visit = (node: MarkdownAstNode): void => {
    if (node.type === 'image' && typeof node.url === 'string' && node.url.trim()) {
      sources.add(node.url.trim())
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  return sources
}

async function collectWorkspaceImageDataUrls(
  content: string,
  sourcePath: string,
  workspaceRoot?: string
): Promise<Map<string, string>> {
  const root = workspaceRoot?.trim()
  if (!root) return new Map()

  const sources = collectMarkdownImageSources(content)
  if (sources.size === 0) return new Map()

  const dataUrls = new Map<string, string>()
  await Promise.all([...sources].map(async (src) => {
    const localPath = resolveWriteMarkdownResourcePath(src, sourcePath)
    if (!localPath) return
    const result = await readWorkspaceImage({ path: localPath, workspaceRoot: root })
    const dataUrl = result.ok ? normalizeSafeEmbeddedMediaUrl(result.dataUrl) : null
    if (dataUrl) dataUrls.set(src, dataUrl)
  }))
  return dataUrls
}

async function renderMarkdownFragment(
  content: string,
  sourcePath: string,
  workspaceRoot?: string
): Promise<string> {
  const localImageDataUrls = await collectWorkspaceImageDataUrls(content, sourcePath, workspaceRoot)
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: markdownRemarkPlugins,
        rehypePlugins: markdownRehypePlugins,
        urlTransform: writeMarkdownUrlTransform,
        components: {
          a: ({
            href,
            children,
            ...props
          }: ComponentPropsWithoutRef<'a'> & { href?: string; children?: ReactNode }): ReactNode => {
            const resolvedHref = resolveWriteMarkdownLinkResource(href)
            return createElement(
              'a',
              {
                ...props,
                ...(resolvedHref ? { href: resolvedHref } : {})
              },
              children
            )
          },
          img: ({
            src,
            alt,
            ...props
          }: ComponentPropsWithoutRef<'img'> & { src?: string; alt?: string | null }): ReactNode => {
            const resolvedSrc = (src ? localImageDataUrls.get(src) : undefined) ??
              resolveWriteMarkdownResource(src, sourcePath)
            return createElement('img', {
              ...props,
              ...(resolvedSrc ? { src: resolvedSrc } : {}),
              alt: alt ?? ''
            })
          }
        }
      },
      content
    )
  )
}

export async function buildWriteClipboardHtmlFragment(options: {
  sourcePath: string
  content: string
  workspaceRoot?: string
}): Promise<string> {
  const fragment = isMarkdownFile(options.sourcePath)
    ? await renderMarkdownFragment(options.content, options.sourcePath, options.workspaceRoot)
    : renderPlainTextFragment(options.content)
  return `<article class="markdown-body">${fragment}</article>`
}

export function buildWriteExportFileName(sourcePath: string, format: WriteExportFormat): string {
  return `${basenameWithoutExtension(sourcePath)}${exportExtension(format)}`
}

export async function buildWriteExportHtmlDocument(options: {
  sourcePath: string
  content: string
  title?: string
  wordCompatible?: boolean
  workspaceRoot?: string
}): Promise<string> {
  const title = options.title?.trim() || basenameWithoutExtension(options.sourcePath)
  const katexCss = await readKatexCss()
  const body = await buildWriteClipboardHtmlFragment({
    sourcePath: options.sourcePath,
    content: options.content,
    workspaceRoot: options.workspaceRoot
  })
  const baseHref = pathToFileURL(`${dirname(options.sourcePath)}/`).href
  const namespaces = options.wordCompatible
    ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"'
    : ''

  return [
    '<!DOCTYPE html>',
    `<html lang="en"${namespaces}>`,
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    `  <base href="${escapeHtml(baseHref)}" />`,
    `  <style>${EXPORT_CSS}</style>`,
    katexCss ? `  <style>${katexCss}</style>` : '',
    '</head>',
    '<body>',
    '  <main class="document-shell">',
    `    ${body}`,
    '  </main>',
    '</body>',
    '</html>'
  ].filter((line) => line !== '').join('\n')
}

export function buildWriteExportLatexDocument(options: {
  sourcePath: string
  content: string
  title?: string
}): string {
  const title = options.title?.trim() || basenameWithoutExtension(options.sourcePath)
  if (/\.tex$/i.test(options.sourcePath)) return options.content
  return markdownToLatexDocument(options.content, { title })
}

export async function copyWriteDocumentAsRichText(
  payload: WriteRichClipboardPayload
): Promise<WriteRichClipboardResult> {
  try {
    const resolved = await resolveWorkspaceFile({
      path: payload.path,
      workspaceRoot: payload.workspaceRoot
    })
    if (!resolved.ok) {
      return {
        ok: false,
        message: resolved.message
      }
    }

    const html = await buildWriteClipboardHtmlFragment({
      sourcePath: resolved.path,
      content: payload.content,
      workspaceRoot: payload.workspaceRoot
    })

    clipboard.write({
      html,
      text: payload.content
    })

    return {
      ok: true,
      copiedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function bufferFromDocxResult(result: ArrayBuffer | Blob): Promise<Buffer> {
  if (typeof ArrayBuffer !== 'undefined' && result instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(result))
  }
  if (typeof Blob !== 'undefined' && result instanceof Blob) {
    return Buffer.from(await result.arrayBuffer())
  }
  throw new TypeError('Unsupported DOCX export result.')
}

async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-export-'))
  const tempHtmlPath = join(tempDir, 'document.html')
  await writeFile(tempHtmlPath, html, 'utf8')

  const hiddenWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true
    }
  })

  try {
    await hiddenWindow.loadURL(pathToFileURL(tempHtmlPath).href)
    await hiddenWindow.webContents.executeJavaScript(`
      Promise.all([
        document.fonts?.ready ?? Promise.resolve(),
        Promise.all(
          Array.from(document.images).map((image) => {
            if (image.complete) return Promise.resolve()
            return new Promise((resolve) => {
              const done = () => resolve(undefined)
              image.addEventListener('load', done, { once: true })
              image.addEventListener('error', done, { once: true })
            })
          })
        )
      ]).then(() => undefined)
    `)
    await delay(120)
    const pdf = await hiddenWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true
    })
    return Buffer.from(pdf)
  } finally {
    if (!hiddenWindow.isDestroyed()) hiddenWindow.destroy()
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function showExportSaveDialog(
  sourcePath: string,
  format: WriteExportFormat,
  parentWindow?: BrowserWindow | null
): Promise<Electron.SaveDialogReturnValue> {
  const options: Electron.SaveDialogOptions = {
    title: 'Export document',
    defaultPath: defaultExportPath(sourcePath, format),
    filters: [exportDialogFilter(format)]
  }
  return parentWindow
    ? dialog.showSaveDialog(parentWindow, options)
    : dialog.showSaveDialog(options)
}

export async function exportWriteDocument(
  payload: WriteExportPayload,
  options?: { parentWindow?: BrowserWindow | null }
): Promise<WriteExportResult> {
  try {
    const resolved = await resolveWorkspaceFile({
      path: payload.path,
      workspaceRoot: payload.workspaceRoot
    })
    if (!resolved.ok) {
      return {
        ok: false,
        canceled: false,
        message: resolved.message
      }
    }

    const sourcePath = resolved.path
    const exportDialogResult = await showExportSaveDialog(sourcePath, payload.format, options?.parentWindow)
    if (exportDialogResult.canceled || !exportDialogResult.filePath) {
      return {
        ok: false,
        canceled: true
      }
    }

    const target = await resolveSafeWorkspaceWriteTarget(
      ensureExportExtension(exportDialogResult.filePath, payload.format),
      payload.workspaceRoot,
      { createParentDirectories: true }
    )
    const title = basenameWithoutExtension(sourcePath)
    if (payload.format === 'tex') {
      await writeSafeWorkspaceFile(target, buildWriteExportLatexDocument({
        sourcePath,
        content: payload.content,
        title
      }), { encoding: 'utf8' })
      return {
        ok: true,
        path: target.path,
        format: payload.format,
        exportedAt: new Date().toISOString()
      }
    }

    const html = await buildWriteExportHtmlDocument({
      sourcePath,
      content: payload.content,
      title,
      wordCompatible: payload.format === 'doc',
      workspaceRoot: payload.workspaceRoot
    })

    if (payload.format === 'html' || payload.format === 'doc') {
      await writeSafeWorkspaceFile(target, html, { encoding: 'utf8' })
    } else if (payload.format === 'docx') {
      const docx = await htmlToDocx(html, null, {
        title,
        creator: 'SciForge',
        keywords: ['markdown', 'export'],
        description: `Exported from ${basename(sourcePath)}`,
        font: 'Arial',
        fontSize: 24
      })
      await writeSafeWorkspaceFile(target, await bufferFromDocxResult(docx))
    } else {
      await writeSafeWorkspaceFile(target, await renderHtmlToPdf(html))
    }

    return {
      ok: true,
      path: target.path,
      format: payload.format,
      exportedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
