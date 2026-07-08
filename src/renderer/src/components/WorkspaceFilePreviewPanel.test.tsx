import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkspaceFileReadDocxResult,
  WorkspaceFileReadPdfResult,
  WorkspaceFileReadTextResult,
  WorkspaceHtmlPreviewResult,
  WorkspaceImageReadResult
} from '@shared/workspace-file'
import type { VisibleContextComponentSnapshot } from '@shared/visible-context'
import { WorkspaceFilePreviewPanel } from './WorkspaceFilePreviewPanel'

type LoadedImagePreviewResult = Extract<WorkspaceImageReadResult, { ok: true }> & {
  kind: 'image'
}
type LoadedPreviewResult =
  | WorkspaceFileReadTextResult
  | WorkspaceFileReadPdfResult
  | WorkspaceFileReadDocxResult
  | LoadedImagePreviewResult

const WORKSPACE_ROOT = '/workspace/lab'

const reactHarness = vi.hoisted(() => ({
  stateIndex: 0,
  stateOverrides: new Map<number, unknown>(),
  effects: [] as Array<() => void | (() => void)>
}))

const visibleContextMock = vi.hoisted(() => ({
  registerVisibleContextComponent: vi.fn()
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      reactHarness.effects.push(effect)
    },
    useState: (initial: unknown) => {
      const index = reactHarness.stateIndex
      reactHarness.stateIndex += 1
      const value = reactHarness.stateOverrides.has(index)
        ? reactHarness.stateOverrides.get(index)
        : typeof initial === 'function'
          ? (initial as () => unknown)()
          : initial
      return [value, vi.fn()]
    }
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: unknown) => selector
}))

vi.mock('../store/chat-store', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      sideConversations: {},
      spawnSideConversation: vi.fn(),
      sendSideMessage: vi.fn()
    })
}))

vi.mock('../lib/code-highlighting', () => ({
  highlightCodeHtml: vi.fn(async (content: string) => `<pre>${content}</pre>`),
  languageFromFilePath: (path: string) => path.split('.').pop() ?? '',
  renderFallbackCodeHtml: (content: string) => `<pre>${content}</pre>`
}))

vi.mock('../lib/open-workspace-path', () => ({
  openWorkspacePathInEditor: vi.fn(async () => ({ ok: true }))
}))

vi.mock('../lib/open-external', () => ({
  openSafeExternalUrl: vi.fn(async () => undefined)
}))

vi.mock('../lib/visible-context', () => ({
  registerVisibleContextComponent: visibleContextMock.registerVisibleContextComponent
}))

vi.mock('./write/WriteMarkdownEditor', async () => {
  const { createElement: h } = await vi.importActual<typeof import('react')>('react')
  return {
    WriteMarkdownEditor: (props: {
      value: string
      filePath: string
      markdownFeatures: boolean
    }) =>
      h('div', {
        'data-preview-route': 'source',
        'data-file-path': props.filePath,
        'data-markdown-features': String(props.markdownFeatures)
      }, props.value)
  }
})

vi.mock('./write/WriteMarkdownPreview', async () => {
  const { createElement: h } = await vi.importActual<typeof import('react')>('react')
  return {
    WriteMarkdownPreview: (props: {
      content: string
      filePath: string
      isMarkdown?: boolean
    }) =>
      h('div', {
        'data-preview-route': 'markdown',
        'data-file-path': props.filePath,
        'data-is-markdown': String(Boolean(props.isMarkdown))
      }, props.content)
  }
})

vi.mock('./write/WritePdfViewer', async () => {
  const { createElement: h } = await vi.importActual<typeof import('react')>('react')
  return {
    WritePdfViewer: (props: { filePath: string; dataBase64: string }) =>
      h('div', {
        'data-preview-route': 'pdf',
        'data-file-path': props.filePath,
        'data-bytes': props.dataBase64
      }),
    WritePdfSelection: undefined
  }
})

vi.mock('./write/WriteDocxViewer', async () => {
  const { createElement: h } = await vi.importActual<typeof import('react')>('react')
  return {
    WriteDocxViewer: (props: { filePath: string; content: string }) =>
      h('div', {
        'data-preview-route': 'docx',
        'data-file-path': props.filePath
      }, props.content)
  }
})

vi.mock('./write/WritePdfAnnotationsPanel', async () => {
  const { createElement: h } = await vi.importActual<typeof import('react')>('react')
  return {
    WritePdfAnnotationsPanel: () => h('div', { 'data-preview-route': 'annotations' })
  }
})

function resetHarness(): void {
  reactHarness.stateIndex = 0
  reactHarness.stateOverrides = new Map()
  reactHarness.effects = []
}

function renderPreview(
  result: LoadedPreviewResult | null,
  options: {
    targetPath?: string
    htmlPreview?: WorkspaceHtmlPreviewResult
  } = {}
): string {
  resetHarness()
  reactHarness.stateOverrides.set(0, result)
  reactHarness.stateOverrides.set(1, false)
  if (result?.kind === 'text') reactHarness.stateOverrides.set(11, result.content)
  if (options.htmlPreview) reactHarness.stateOverrides.set(6, options.htmlPreview)

  return renderToStaticMarkup(createElement(WorkspaceFilePreviewPanel, {
    target: {
      path: options.targetPath ?? result?.path ?? `${WORKSPACE_ROOT}/docs/readme.md`,
      workspaceRoot: WORKSPACE_ROOT
    },
    workspaceRoot: WORKSPACE_ROOT,
    onClose: vi.fn()
  }))
}

function textResult(path: string, content = 'hello'): WorkspaceFileReadTextResult {
  return {
    ok: true,
    kind: 'text',
    path,
    content,
    mimeType: path.endsWith('.md') ? 'text/markdown' : path.endsWith('.html') ? 'text/html' : 'text/plain',
    size: content.length,
    truncated: false
  }
}

function pdfResult(path: string): WorkspaceFileReadPdfResult {
  return {
    ok: true,
    kind: 'pdf',
    path,
    content: '',
    dataBase64: 'JVBERi0xLjQ=',
    mimeType: 'application/pdf',
    size: 12,
    truncated: false,
    mtimeMs: 123
  }
}

function docxResult(path: string): WorkspaceFileReadDocxResult {
  return {
    ok: true,
    kind: 'docx',
    path,
    content: 'Docx body',
    paragraphs: [{ id: 'p1', index: 0, text: 'Docx body' }],
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 34,
    truncated: false,
    mtimeMs: 456
  }
}

function imageResult(path: string): LoadedImagePreviewResult {
  return {
    ok: true,
    kind: 'image',
    path,
    dataUrl: 'data:image/png;base64,aW1hZ2U=',
    mimeType: 'image/png',
    size: 5
  }
}

function findEffect(sourceNeedle: string): () => void | (() => void) {
  const effect = reactHarness.effects.find((candidate) => candidate.toString().includes(sourceNeedle))
  expect(effect).toBeTypeOf('function')
  return effect!
}

describe('WorkspaceFilePreviewPanel preview routing', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    resetHarness()
  })

  it('keeps plain text files in the source editor route', () => {
    const html = renderPreview(textResult(`${WORKSPACE_ROOT}/notes/todo.txt`, 'plain text'))

    expect(html).toContain('data-preview-route="source"')
    expect(html).toContain('data-markdown-features="false"')
    expect(html).toContain('plain text')
    expect(html).not.toContain('data-preview-route="markdown"')
    expect(html).not.toContain('data-preview-route="pdf"')
    expect(html).not.toContain('data-preview-route="docx"')
  })

  it('opens markdown files in preview mode by default', () => {
    const html = renderPreview(textResult(`${WORKSPACE_ROOT}/docs/readme.md`, '# Readme'))

    expect(html).toContain('data-preview-route="markdown"')
    expect(html).toContain('data-is-markdown="true"')
    expect(html).toContain('# Readme')
    expect(html).not.toContain('data-preview-route="source"')
  })

  it('opens html files in the html iframe preview route by default', () => {
    const path = `${WORKSPACE_ROOT}/reports/index.html`
    const html = renderPreview(textResult(path, '<h1>Report</h1>'), {
      htmlPreview: {
        ok: true,
        path,
        workspaceRoot: WORKSPACE_ROOT,
        url: 'http://127.0.0.1:5173/__preview/index.html',
        size: 20,
        mtimeMs: 789
      }
    })

    expect(html).toContain('<iframe')
    expect(html).toContain('src="http://127.0.0.1:5173/__preview/index.html"')
    expect(html).not.toContain('data-preview-route="source"')
    expect(html).not.toContain('data-preview-route="markdown"')
  })

  it('routes image, pdf, and docx results to their dedicated preview surfaces', () => {
    expect(renderPreview(imageResult(`${WORKSPACE_ROOT}/figures/cell.png`))).toContain(
      'src="data:image/png;base64,aW1hZ2U="'
    )
    expect(renderPreview(pdfResult(`${WORKSPACE_ROOT}/papers/study.pdf`))).toContain(
      'data-preview-route="pdf"'
    )
    expect(renderPreview(docxResult(`${WORKSPACE_ROOT}/drafts/protocol.docx`))).toContain(
      'data-preview-route="docx"'
    )
  })

  it('uses the image bridge for image-like targets before generic file reads', () => {
    const readWorkspaceImage = vi.fn(async () => imageResult(`${WORKSPACE_ROOT}/figures/cell.png`))
    const readWorkspaceFile = vi.fn(async () => textResult(`${WORKSPACE_ROOT}/figures/cell.png`))
    vi.stubGlobal('window', {
      sciforge: {
        readWorkspaceImage,
        readWorkspaceFile
      }
    })

    renderPreview(null, { targetPath: `${WORKSPACE_ROOT}/figures/cell.png` })
    findEffect('readWorkspaceImage')()

    expect(readWorkspaceImage).toHaveBeenCalledWith({
      path: `${WORKSPACE_ROOT}/figures/cell.png`,
      workspaceRoot: WORKSPACE_ROOT
    })
    expect(readWorkspaceFile).not.toHaveBeenCalled()
  })

  it('registers the preview target as visible context', () => {
    const path = `${WORKSPACE_ROOT}/docs/readme.md`
    renderPreview(textResult(path, '# Readme'))

    findEffect('registerVisibleContextComponent')()

    expect(visibleContextMock.registerVisibleContextComponent).toHaveBeenCalledWith(
      expect.objectContaining<Partial<VisibleContextComponentSnapshot>>({
        id: 'right-sidebar.file-preview',
        region: 'right-sidebar',
        component: 'file-preview',
        title: 'readme.md',
        summary: 'Previewing text file readme.md.',
        resources: [
          expect.objectContaining({
            kind: 'workspaceFile',
            role: 'preview-target',
            workspaceRoot: WORKSPACE_ROOT,
            path,
            relativePath: 'docs/readme.md',
            resourceUri: 'workspace://file/docs/readme.md',
            name: 'readme.md',
            fileKind: 'text',
            mimeType: 'text/markdown',
            size: '# Readme'.length
          })
        ],
        state: expect.objectContaining({
          path,
          workspaceRoot: WORKSPACE_ROOT,
          kind: 'text',
          loading: false,
          ok: true,
          workspacePreviewPluginId: 'markdown',
          workspacePreviewModality: 'document',
          workspacePreviewMode: 'preview',
          workspacePreviewSelectionKind: null,
          workspacePreviewActionCount: 5,
          workspaceObservation: expect.objectContaining({
            file: expect.objectContaining({
              path,
              workspaceRoot: WORKSPACE_ROOT,
              mimeType: 'text/markdown'
            }),
            view: {
              pluginId: 'markdown',
              modality: 'document',
              mode: 'preview',
              title: 'readme.md'
            },
            visibleText: '# Readme',
            actions: expect.arrayContaining(['observe', 'select', 'applyEdit', 'save', 'export:html'])
          })
        })
      })
    )
  })
})
