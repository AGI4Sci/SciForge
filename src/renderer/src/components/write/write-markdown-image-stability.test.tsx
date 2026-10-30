// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WriteMarkdownPreview,
  type WriteMarkdownWorkspaceImageLoader,
  type WriteMarkdownWorkspaceLinkOpener
} from './WriteMarkdownPreview'
import type { WriteMarkdownWorkspaceImageLoadResult } from './write-markdown-image-cache'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const MARKDOWN_IMAGE_CACHE_LIMIT = 24

function dataUrlFor(label: string): string {
  return `data:image/png;base64,${label.replaceAll(/[^a-z0-9]/giu, '')}`
}

// The workspace image cache is module-level and shared for the whole test file,
// so every test renders from its own workspace root instead of resetting it.
let workspaceSequence = 0
function uniqueWorkspaceRoot(): string {
  workspaceSequence += 1
  return `/workspace/markdown-image-stability-${workspaceSequence}`
}

type PreviewProps = {
  content: string
  filePath: string
  workspaceRoot: string
  loadWorkspaceImage?: WriteMarkdownWorkspaceImageLoader
  onOpenWorkspaceLink?: WriteMarkdownWorkspaceLinkOpener
}

describe('WriteMarkdownPreview workspace image stability', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.body.appendChild(document.createElement('div'))
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function flushAsyncWork(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  async function renderPreview(props: PreviewProps): Promise<void> {
    await act(async () => {
      root.render(createElement(WriteMarkdownPreview, { isMarkdown: true, ...props }))
    })
    await flushAsyncWork()
  }

  function renderedImages(): HTMLImageElement[] {
    return [...container.querySelectorAll('img')]
  }

  function renderedImage(): HTMLImageElement {
    const [image] = renderedImages()
    if (!image) throw new Error('The preview did not render an <img> element.')
    return image
  }

  it('keeps the <img> node and resolved source when ancestor callback identities change', async () => {
    const workspaceRoot = uniqueWorkspaceRoot()
    const filePath = `${workspaceRoot}/report.md`
    const dataUrl = dataUrlFor('cell')
    const loadWorkspaceImage = vi.fn(async (_input: {
      path: string
      workspaceRoot: string
    }) => ({ ok: true as const, dataUrl }))
    const openWorkspaceLink = vi.fn()

    await renderPreview({
      content: '![fig](figures/cell.png)',
      filePath,
      workspaceRoot,
      loadWorkspaceImage: (input) => loadWorkspaceImage(input),
      onOpenWorkspaceLink: (input) => openWorkspaceLink(input)
    })

    const imageBefore = renderedImage()
    expect(imageBefore.getAttribute('src')).toBe(dataUrl)
    expect(loadWorkspaceImage).toHaveBeenCalledTimes(1)

    // Same document, fresh callback identities, as an ancestor re-render produces.
    await renderPreview({
      content: '![fig](figures/cell.png)',
      filePath,
      workspaceRoot,
      loadWorkspaceImage: (input) => loadWorkspaceImage(input),
      onOpenWorkspaceLink: (input) => openWorkspaceLink(input)
    })

    const imageAfter = renderedImage()
    expect(imageAfter).toBe(imageBefore)
    expect(imageAfter.getAttribute('src')).toBe(dataUrl)
    expect(loadWorkspaceImage).toHaveBeenCalledTimes(1)
  })

  it('routes workspace links through the callback identity of the current render', async () => {
    const workspaceRoot = uniqueWorkspaceRoot()
    const filePath = `${workspaceRoot}/report.md`
    const opened: string[] = []

    await renderPreview({
      content: '[child](notes/child.md)',
      filePath,
      workspaceRoot,
      onOpenWorkspaceLink: () => opened.push('first')
    })
    await renderPreview({
      content: '[child](notes/child.md)',
      filePath,
      workspaceRoot,
      onOpenWorkspaceLink: () => opened.push('second')
    })

    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    await act(async () => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(opened).toEqual(['second'])
  })

  it('loads a genuinely different workspace image instead of keeping the previous source', async () => {
    const workspaceRoot = uniqueWorkspaceRoot()
    const filePath = `${workspaceRoot}/report.md`
    const cellDataUrl = dataUrlFor('cell')
    const otherDataUrl = dataUrlFor('other')
    const loadWorkspaceImage = vi.fn(async ({ path }: { path: string }) => ({
      ok: true as const,
      dataUrl: path.endsWith('other.png') ? otherDataUrl : cellDataUrl
    }))

    await renderPreview({
      content: '![fig](figures/cell.png)',
      filePath,
      workspaceRoot,
      loadWorkspaceImage
    })
    expect(renderedImage().getAttribute('src')).toBe(cellDataUrl)

    await renderPreview({
      content: '![fig](figures/other.png)',
      filePath,
      workspaceRoot,
      loadWorkspaceImage
    })

    expect(renderedImage().getAttribute('src')).toBe(otherDataUrl)
    expect(loadWorkspaceImage).toHaveBeenCalledTimes(2)
    expect(loadWorkspaceImage.mock.calls[1]?.[0]).toMatchObject({
      path: `${workspaceRoot}/figures/other.png`
    })
  })

  it('keeps the displayed source while a refresh for the same resource is in flight', async () => {
    const workspaceRoot = uniqueWorkspaceRoot()
    const filePath = `${workspaceRoot}/report.md`
    const targetPath = `${workspaceRoot}/figures/fig-0.png`
    const targetDataUrl = dataUrlFor('target')
    const refreshedDataUrl = dataUrlFor('refreshed')
    const fillerPaths = Array.from(
      { length: MARKDOWN_IMAGE_CACHE_LIMIT + 6 },
      (_, index) => `figures/fig-${index}.png`
    )
    const content = fillerPaths.map((path, index) => `![fig-${index}](${path})`).join('\n\n')
    let targetLoads = 0
    let finishRefresh: ((result: WriteMarkdownWorkspaceImageLoadResult) => void) | undefined
    const loadWorkspaceImage = vi.fn(({ path }: { path: string }) => {
      if (path === targetPath) {
        targetLoads += 1
        if (targetLoads === 1) {
          return Promise.resolve<WriteMarkdownWorkspaceImageLoadResult>({ ok: true, dataUrl: targetDataUrl })
        }
        return new Promise<WriteMarkdownWorkspaceImageLoadResult>((resolve) => {
          finishRefresh = resolve
        })
      }
      return Promise.resolve<WriteMarkdownWorkspaceImageLoadResult>({
        ok: true,
        dataUrl: dataUrlFor(path.slice(workspaceRoot.length))
      })
    })

    // More images than the shared cache keeps, so the target's data URL is
    // evicted while its <img> is still on screen.
    await renderPreview({ content, filePath, workspaceRoot, loadWorkspaceImage })

    const targetImage = renderedImages()[0]
    expect(targetImage?.getAttribute('src')).toBe(targetDataUrl)

    await act(async () => {
      root.render(createElement(WriteMarkdownPreview, {
        isMarkdown: true,
        content: content.replace('![fig-0]', '![fig-0 renamed]'),
        filePath,
        workspaceRoot,
        loadWorkspaceImage
      }))
    })

    // The refresh is in flight, so the visible image must keep its source.
    expect(renderedImages()[0]).toBe(targetImage)
    expect(targetImage?.getAttribute('src')).toBe(targetDataUrl)

    await act(async () => {
      finishRefresh?.({ ok: true, dataUrl: refreshedDataUrl })
    })
    expect(targetImage?.getAttribute('src')).toBe(refreshedDataUrl)
  })
})