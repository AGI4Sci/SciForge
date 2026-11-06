// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImagePreviewWindow } from './ImagePreviewWindow'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('ImagePreviewWindow', () => {
  let root: Root | undefined

  beforeEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => { root?.unmount() })
      root = undefined
    }
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    vi.restoreAllMocks()
  })

  async function renderLightbox(onClose = (): void => undefined): Promise<void> {
    await act(async () => {
      root = createRoot(document.body.appendChild(document.createElement('div')))
      root.render(createElement(ImagePreviewWindow, {
        open: true,
        src: 'data:image/png;base64,fixture',
        alt: 'figure',
        onClose
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

    Object.defineProperty(image(), 'naturalWidth', { configurable: true, value: 400 })
    Object.defineProperty(image(), 'naturalHeight', { configurable: true, value: 1600 })
    Object.defineProperty(scrollContainer(), 'clientWidth', { configurable: true, value: 600 })
    Object.defineProperty(scrollContainer(), 'clientHeight', { configurable: true, value: 400 })
    await act(async () => image().dispatchEvent(new Event('load')))
    expect(image().style.width).toBe('100px')
    await clickControl('imagePreviewZoomOut')
    expect(image().style.width).toBe('75px')
    await clickControl('imagePreviewZoomIn')
    await clickControl('imagePreviewZoomIn')

    expect(image().className).toContain('m-auto')
    expect(image().className).toContain('max-w-none')
    expect(image().style.width).toBe('125px')

    await clickControl('imagePreviewResetZoom')

    expect(image().className).toContain('m-auto')
    expect(image().className).toContain('max-h-full')
    expect(image().style.width).toBe('100px')
  })

  it('leaves the document interactive and scopes Escape to the preview window', async () => {
    document.body.style.overflow = 'auto'
    const onClose = vi.fn()
    await renderLightbox(onClose)
    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    expect(panel.getAttribute('aria-modal')).toBe('false')
    expect(document.body.style.overflow).toBe('auto')
    const readerAction = vi.fn()
    const reader = document.body.appendChild(document.createElement('button'))
    reader.addEventListener('click', readerAction)
    reader.click()
    expect(readerAction).toHaveBeenCalledOnce()
    await act(async () => {
      reader.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('moves with the title bar, keeps the window on screen, and stops on pointer release', async () => {
    await renderLightbox()
    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    const header = panel.querySelector('header') as HTMLElement
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 100, width: 320, height: 240 } as DOMRect)
    header.setPointerCapture = vi.fn()
    header.hasPointerCapture = vi.fn(() => true)
    header.releasePointerCapture = vi.fn()
    const pointer = async (type: string, x: number, y: number): Promise<void> => {
      await act(async () => {
        header.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true }))
      })
    }
    await pointer('pointerdown', 220, 120)
    await pointer('pointermove', 420, 220)
    expect(panel.style.left).toBe('400px')
    expect(panel.style.top).toBe('200px')
    await pointer('pointermove', -100, -100)
    expect(panel.style.left).toBe('12px')
    expect(panel.style.top).toBe('12px')
    await pointer('pointermove', 10000, 10000)
    expect(panel.style.left).toBe(`${window.innerWidth - 320 - 12}px`)
    expect(panel.style.top).toBe(`${window.innerHeight - 240 - 12}px`)
    await pointer('pointerup', 10000, 10000)
    await pointer('pointermove', 420, 220)
    expect(panel.style.left).toBe(`${window.innerWidth - 320 - 12}px`)
    expect(header.releasePointerCapture).toHaveBeenCalledWith(1)
  })

})
