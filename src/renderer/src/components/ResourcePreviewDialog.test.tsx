// @vitest-environment happy-dom
import { act, useSyncExternalStore, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkspacePreviewResourceRendererInput } from '@sciforge/domain-sdk/workspace-preview'
import { installedRendererContributions } from '../domain-modules/installed-renderer-contributions'
import { RESOURCE_TEXT_PREVIEW_MAX_BYTES } from '../lib/resource-preview-content'
import i18n from '../i18n'
import { closeResourcePreview, getResourcePreviewSnapshot, openResourcePreview, subscribeResourcePreview } from '../lib/resource-preview'
import ResourcePreviewDialog from './ResourcePreviewDialog'

const viewers = vi.hoisted(() => ({ pdf: vi.fn(), image: vi.fn() }))
vi.mock('../domain-modules/installed-renderer-contributions', async () => {
  const { createBuiltInWorkspacePreviewPluginRegistrations } = await import('../workspace-preview/built-in-plugin-contributions')
  const { createRendererWorkspacePreviewRegistry } = await import('../workspace-preview/registry')
  return { installedRendererContributions: { workspacePreviews: createRendererWorkspacePreviewRegistry({
    registrations: createBuiltInWorkspacePreviewPluginRegistrations()
  }) } }
})
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
  const fetchContent = vi.fn().mockResolvedValueOnce(head(3, 'text/plain'))
    .mockResolvedValueOnce(new Response('a,b', { status: 206, headers: { 'content-length': '3' } }))
  vi.stubGlobal('fetch', fetchContent)
  await mount()
  await act(async () => { openResourcePreview({ ...input, file: { name: 'notes.txt', mimeType: 'text/plain', size: 3 } }) })
  expect(document.body.textContent).toContain('a,b')
  expect(document.querySelector('[data-workspace-preview-text-viewer]')).not.toBeNull()
  expect(document.querySelector('textarea')?.readOnly).toBe(true)
  expect(document.querySelector<HTMLButtonElement>('[data-text-save]')?.disabled).toBe(true)
  expect(fetchContent).toHaveBeenLastCalledWith('sciforge-resource://content?exact=one', { headers: { Range: 'bytes=0-2' }, signal: expect.anything() })
})

it.each([
  ['table.csv', 'text/csv', 'sample,note\nα,"quoted,\nline"\nβ,"""value"""\n', ['α', 'quoted,\nline', 'β', '"value"']],
  ['table.tsv', 'text/tab-separated-values', 'sample\tcount\nα\t2\nβ\t1\n', ['α', '2', 'β', '1']],
  ['records.jsonl', 'application/x-ndjson', '{"sample":"α","count":2}\n{"sample":"β","count":1}\n', ['α', '2', 'β', '1']]
])('renders %s through the registered parser and grid without entering workspace edits', async (name, mimeType, text, values) => {
  transport()
  const size = new TextEncoder().encode(text as string).byteLength
  const fetchContent = vi.fn().mockResolvedValueOnce(head(size, mimeType as string))
    .mockResolvedValueOnce(new Response(text as string, { status: 206, headers: { 'content-length': String(size) } }))
  vi.stubGlobal('fetch', fetchContent)
  await mount()
  await act(async () => { openResourcePreview({ ...input, file: { name: name as string, mimeType: mimeType as string, size } }) })
  expect(document.querySelector('[data-workspace-preview-tabular-viewer]')).not.toBeNull()
  expect(document.querySelector('[data-workspace-preview-text-viewer]')).toBeNull()
  expect([...document.querySelectorAll('[data-tabular-cell-value]')].map(cell => cell.textContent)).toEqual(values)
  const editButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-tabular-cell-edit]')]
  expect(editButtons.length).toBeGreaterThan(0)
  expect(editButtons.every(button => button.disabled)).toBe(true)
  await act(async () => { editButtons[0]!.click() })
  expect(document.querySelector('[data-tabular-cell-editor]')).toBeNull()
  expect(document.querySelector('[data-tabular-row-insert-editor]')).toBeNull()
  expect(fetchContent).toHaveBeenCalledTimes(2)
})

it('keeps the resource byte cap and truncation notice for tables', async () => {
  transport()
  const text = `id,value\n${'sample,1\n'.repeat(40_000)}`
  const fetchContent = vi.fn().mockResolvedValueOnce(head(text.length, 'text/csv'))
    .mockResolvedValueOnce(new Response(text.slice(0, RESOURCE_TEXT_PREVIEW_MAX_BYTES), {
      status: 206, headers: { 'content-length': String(RESOURCE_TEXT_PREVIEW_MAX_BYTES) }
    }))
  vi.stubGlobal('fetch', fetchContent)
  await mount()
  await act(async () => { openResourcePreview({ ...input, file: { name: 'bounded.csv', mimeType: 'text/csv', size: text.length } }) })
  expect(document.querySelector('[data-workspace-preview-tabular-viewer]')).not.toBeNull()
  expect(document.body.textContent).toContain(i18n.t('resourcePreviewTruncated', { ns: 'common' }))
  expect(fetchContent).toHaveBeenLastCalledWith('sciforge-resource://content?exact=one', {
    headers: { Range: `bytes=0-${RESOURCE_TEXT_PREVIEW_MAX_BYTES - 1}` }, signal: expect.anything()
  })
})

it('does not render a table when byte access is revoked after metadata authorization', async () => {
  transport()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(head(12, 'text/csv'))
    .mockResolvedValueOnce(new Response('private transport detail', { status: 403 })))
  await mount()
  await act(async () => { openResourcePreview({ ...input, file: { name: 'revoked.csv', mimeType: 'text/csv', size: 12 } }) })
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('文件预览失败')
  expect(document.querySelector('[data-workspace-preview-tabular-viewer]')).toBeNull()
  expect(document.body.textContent).not.toContain('private transport detail')
})

it('dispatches a package resource hook through the same registry without a workspace context', async () => {
  transport()
  const registry = installedRendererContributions.workspacePreviews
  const renderWorkspace = vi.fn(() => <div />)
  const renderResource = vi.fn((request: WorkspacePreviewResourceRendererInput) => <div data-testid="custom-resource">
    {request.content.kind === 'text' ? request.content.text : ''}
  </div>)
  const registration = registry.register('fixture.resource-owner', {
    manifest: { ...registry.get('text')!.manifest, id: 'fixture-resource', displayName: 'Fixture Resource',
      extensions: ['.fixture'], mimeTypes: ['application/vnd.fixture+json'], priority: 999 },
    render: renderWorkspace, resource: { contentKinds: ['text'], render: renderResource }
  })
  cleanups.push(() => registration.dispose())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(head(2, 'application/vnd.fixture+json'))
    .mockResolvedValueOnce(new Response('{}', { status: 206, headers: { 'content-length': '2' } })))
  await mount()
  await act(async () => { openResourcePreview({ ...input, file: { name: 'data.fixture', mimeType: 'application/vnd.fixture+json', size: 2 } }) })
  expect(document.querySelector('[data-testid="custom-resource"]')?.textContent).toBe('{}')
  expect(renderWorkspace).not.toHaveBeenCalled()
  expect(renderResource).toHaveBeenCalledOnce()
  const request = renderResource.mock.calls[0]![0]
  for (const field of ['session', 'path', 'observation', 'context', 'applyEdit']) expect(request).not.toHaveProperty(field)
  expect(request.contentKey).toContain('sha256:one')
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
