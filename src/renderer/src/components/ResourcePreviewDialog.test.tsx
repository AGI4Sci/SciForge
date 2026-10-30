// @vitest-environment happy-dom
import { act, useSyncExternalStore, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { closeResourcePreview, getResourcePreviewSnapshot, openResourcePreview, subscribeResourcePreview } from '../lib/resource-preview'
import ResourcePreviewDialog from './ResourcePreviewDialog'

const viewers = vi.hoisted(() => ({ pdf: vi.fn(), image: vi.fn() }))
vi.mock('../workspace-preview/PdfWorkspaceViewer', () => ({
  PdfWorkspaceViewer: (props: unknown) => { viewers.pdf(props); return <div data-testid="existing-pdf-viewer" /> }
}))
vi.mock('../workspace-preview/ImageWorkspaceViewer', () => ({
  ImageWorkspaceViewer: (props: { onLoadError(): void }) => { viewers.image(props); return <button data-testid="existing-image-viewer" onClick={props.onLoadError}>image</button> }
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const cleanups: Array<() => void> = []
afterEach(async () => {
  await act(async () => {
    const current = getResourcePreviewSnapshot()
    if (current) closeResourcePreview(current.id)
    for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  })
  viewers.pdf.mockClear(); viewers.image.mockClear()
  vi.unstubAllGlobals()
})
function Host(): ReactElement | null {
  const current = useSyncExternalStore(subscribeResourcePreview, getResourcePreviewSnapshot)
  return current ? <ResourcePreviewDialog key={current.id} request={current} /> : null
}
const input = {
  resource: { token: `cap_${'a'.repeat(24)}`, semanticRevision: 'sha256:one', expiresAt: '2099-10-22T00:00:00.000Z' },
  file: { name: 'report.pdf', mimeType: 'application/pdf', size: 42 }
}
async function mount(): Promise<void> {
  await i18n.changeLanguage('zh')
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  cleanups.push(() => { root.unmount(); element.remove() })
  await act(async () => { root.render(<Host />) })
}
function transport() {
  const contentUrl = vi.fn(() => 'sciforge-resource://content?exact=one')
  vi.stubGlobal('window', Object.assign(window, { sciforge: { capabilities: { resourceContentUrl: contentUrl } } }))
  return contentUrl
}
function head(size = 42, mime = 'application/pdf') { return new Response(null, { headers: { 'content-length': String(size), 'content-type': mime } }) }

it('renders the existing PDF viewer from the exact Broker URL without a Session or synthetic observation', async () => {
  transport()
  const fetchContent = vi.fn().mockResolvedValue(head())
  vi.stubGlobal('fetch', fetchContent)
  await mount()
  await act(async () => { expect(openResourcePreview(input)).toBe(true) })
  expect(document.querySelector('[data-testid="existing-pdf-viewer"]')).not.toBeNull()
  const props = viewers.pdf.mock.calls.at(-1)![0]
  expect(props.previewState.sourceUrl).toBe('sciforge-resource://content?exact=one')
  expect(props.documentContentKey).toContain('sha256:one')
  expect(props).not.toHaveProperty('observation')
  expect(props).not.toHaveProperty('asset')
  expect(props).not.toHaveProperty('sessionId')
  expect(fetchContent).toHaveBeenCalledOnce()
})

it('renders images in the existing viewer and localizes a resource load failure', async () => {
  transport()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(head(12, 'image/png')))
  await mount()
  await act(async () => { openResourcePreview({ ...input, file: { name: 'figure.png', mimeType: 'image/png', size: 12 } }) })
  expect(viewers.image.mock.calls.at(-1)![0].previewState.dataUrl).toBe('sciforge-resource://content?exact=one')
  await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="existing-image-viewer"]')!.click() })
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('文件预览失败')
})

it('renders bounded text using the existing read-only text viewer', async () => {
  transport()
  const fetchContent = vi.fn().mockResolvedValueOnce(head(3, 'text/csv'))
    .mockResolvedValueOnce(new Response('a,b', { status: 206, headers: { 'content-length': '3' } }))
  vi.stubGlobal('fetch', fetchContent)
  await mount()
  await act(async () => { openResourcePreview({ ...input, file: { name: 'table.csv', mimeType: 'text/csv', size: 3 } }) })
  expect(document.body.textContent).toContain('a,b')
  expect(document.querySelector('[data-workspace-preview-text-viewer]')).not.toBeNull()
  expect(document.querySelector('textarea')?.readOnly).toBe(true)
  expect(document.querySelector<HTMLButtonElement>('[data-text-save]')?.disabled).toBe(true)
  expect(fetchContent).toHaveBeenLastCalledWith('sciforge-resource://content?exact=one', { headers: { Range: 'bytes=0-2' }, signal: expect.anything() })
})

it('keeps keyboard focus inside the modal, closes with Escape and restores the caller', async () => {
  transport()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(head(3, 'image/png')))
  const caller = document.createElement('button')
  document.body.append(caller)
  cleanups.push(() => caller.remove())
  await mount()
  caller.focus()
  await act(async () => { openResourcePreview(input) })
  const close = document.querySelector<HTMLButtonElement>('[data-testid="resource-preview-close"]')!
  expect(document.activeElement).toBe(close)
  const imageControl = document.querySelector<HTMLButtonElement>('[data-testid="existing-image-viewer"]')!
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(imageControl)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(close)
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(document.querySelector('[data-testid="resource-preview-dialog"]')).toBeNull()
  expect(document.activeElement).toBe(caller)
})

it('aborts a replaced resource and ignores its late result', async () => {
  transport()
  let resolveFirst!: (value: Response) => void
  const first = new Promise<Response>(resolve => { resolveFirst = resolve })
  const fetchContent = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(head(3, 'application/octet-stream'))
  vi.stubGlobal('fetch', fetchContent)
  await mount()
  await act(async () => { openResourcePreview(input) })
  const oldSignal = fetchContent.mock.calls[0]![1].signal as AbortSignal
  await act(async () => { openResourcePreview({ ...input, file: { ...input.file, name: 'new.bin' } }) })
  expect(oldSignal.aborted).toBe(true)
  await act(async () => { resolveFirst(head()); await first })
  expect(document.querySelector('h2')?.textContent).toBe('new.bin')
  expect(viewers.pdf).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('暂不支持预览')
})

it('shows a localized authorization error without exposing transport details or passing bytes to viewers', async () => {
  transport()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private transport detail', { status: 403 })))
  await mount()
  await act(async () => { openResourcePreview(input) })
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('文件预览失败')
  expect(document.body.textContent).not.toContain('private transport detail')
  expect(viewers.pdf).not.toHaveBeenCalled()
  expect(viewers.image).not.toHaveBeenCalled()
})
