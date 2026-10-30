// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Streamdown } from 'streamdown'
import {
  highlightCodeHtml,
  renderFallbackCodeHtml
} from '../../lib/code-highlighting'
import { StreamdownCode } from './StreamdownCode'

vi.mock('../../lib/code-highlighting', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/code-highlighting')>()
  return {
    ...actual,
    highlightCodeHtml: vi.fn(actual.highlightCodeHtml)
  }
})

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const highlightSpy = vi.mocked(highlightCodeHtml)
const UNCLOSED_FENCE = '```ts\nconst answer = 42\n'
const CLOSED_FENCE = '```ts\nconst answer = 42\n```\n'

describe('StreamdownCode streaming highlight', () => {
  let root: Root | undefined
  let container: HTMLDivElement

  beforeEach(() => {
    highlightSpy.mockClear()
    container = document.body.appendChild(document.createElement('div'))
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      root = undefined
    }
    document.body.innerHTML = ''
  })

  async function renderMarkdown(text: string, streaming: boolean): Promise<void> {
    await act(async () => {
      root ??= createRoot(container)
      root.render(
        createElement(
          Streamdown,
          {
            mode: streaming ? 'streaming' : 'static',
            parseIncompleteMarkdown: streaming,
            components: { code: StreamdownCode }
          },
          text
        )
      )
    })
  }

  function blockHtml(): string {
    const el = document.querySelector('.ds-code-block-html')
    expect(el).toBeTruthy()
    return (el as HTMLElement).innerHTML
  }

  it('keeps the cheap fallback html while a fence is still streaming', async () => {
    await renderMarkdown(UNCLOSED_FENCE, true)

    expect(highlightSpy).not.toHaveBeenCalled()
    expect(blockHtml()).toBe(renderFallbackCodeHtml('const answer = 42'))
  })

  it('highlights a fence once it closes mid-stream', async () => {
    await renderMarkdown(CLOSED_FENCE, true)

    await vi.waitFor(() => {
      expect(highlightSpy).toHaveBeenCalledWith('const answer = 42', 'ts')
    }, { timeout: 10000 })
    await vi.waitFor(() => {
      expect(blockHtml()).toContain('shiki')
    }, { timeout: 10000 })
  })

  it('highlights an unclosed fence once the stream ends', async () => {
    await renderMarkdown(UNCLOSED_FENCE, true)
    expect(highlightSpy).not.toHaveBeenCalled()

    await renderMarkdown(UNCLOSED_FENCE, false)

    await vi.waitFor(() => {
      expect(highlightSpy).toHaveBeenCalledWith('const answer = 42', 'ts')
    }, { timeout: 10000 })
    await vi.waitFor(() => {
      expect(blockHtml()).toContain('shiki')
    }, { timeout: 10000 })
  })

  it('highlights immediately for static markdown', async () => {
    await renderMarkdown(CLOSED_FENCE, false)

    expect(highlightSpy).toHaveBeenCalledWith('const answer = 42', 'ts')
  })
})
