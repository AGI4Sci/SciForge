// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImagePreviewLightbox } from './ImagePreviewLightbox'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('ImagePreviewLightbox', () => {
  let root: Root | undefined

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(async () => {
    if (root) {
      await act(async () => { root?.unmount() })
      root = undefined
    }
    document.body.innerHTML = ''
  })

  async function renderLightbox(): Promise<void> {
    await act(async () => {
      root = createRoot(document.body.appendChild(document.createElement('div')))
      root.render(createElement(ImagePreviewLightbox, {
        open: true,
        src: 'data:image/png;base64,fixture',
        alt: 'figure',
        onClose: () => undefined
      }))
    })
  }

  function image(): HTMLImageElement {
    const element = document.body.querySelector('img')
    expect(element).toBeTruthy()
    return element as HTMLImageElement
  }

  function scrollContainer(): HTMLElement {
    const element = image().parentElement
    expect(element).toBeTruthy()
    return element as HTMLElement
  }

  async function clickControl(ariaLabel: string): Promise<void> {
    const button = document.body.querySelector(`button[aria-label="${ariaLabel}"]`)
    expect(button).toBeTruthy()
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('anchors the zoomed image from the top-left so every edge stays reachable by scrolling', async () => {
    await renderLightbox()

    expect(image().className).toContain('m-auto')
    expect(image().className).toContain('max-h-full')
    expect(scrollContainer().className).toContain('overflow-auto')
    expect(scrollContainer().className).not.toContain('items-center')
    expect(scrollContainer().className).not.toContain('justify-center')

    await clickControl('imagePreviewZoomIn')

    expect(image().className).toContain('m-auto')
    expect(image().className).toContain('max-w-none')
    expect(image().style.width).toBe('125%')

    await clickControl('imagePreviewResetZoom')

    expect(image().className).toContain('m-auto')
    expect(image().className).toContain('max-h-full')
    expect(image().style.width).toBe('')
  })
})
