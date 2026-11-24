// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { measureSiYuanViewport, useNativeSiYuanPresentation } from './native-siyuan-presentation.js'
import type { SiYuanEditorViewport } from '../editor-contract.js'

let root: Root | undefined
let container: HTMLElement | undefined

it('ignores pixel hit testing and ARIA guesses; only explicit overlays can obscure an active editor', () => {
  const surface = new Window({ url: 'about:blank' })
  try {
    Object.defineProperty(surface, 'innerWidth', { value: 2351 })
    Object.defineProperty(surface, 'innerHeight', { value: 1226 })
    Object.defineProperty(surface, 'devicePixelRatio', { value: 0.9 })
    const slot = surface.document.createElement('div')
    const neighbour = surface.document.createElement('div')
    surface.document.body.append(slot, neighbour)
    slot.getBoundingClientRect = () => new surface.DOMRect(1166.13, 85.97, 1128.9917, 1140.03)
    slot.checkVisibility = () => true
    // Reproduce Chromium returning the neighbouring rail for a point one CSS
    // pixel inside the slot at 90% zoom, as captured from the stuck editor.
    surface.document.elementFromPoint = x => x > 2295.1217 - 1.2 ? neighbour : slot
    expect(measureSiYuanViewport(slot as unknown as HTMLElement, true).visible).toBe(true)
    surface.document.elementFromPoint = () => neighbour
    expect(measureSiYuanViewport(slot as unknown as HTMLElement, true).visible).toBe(true)
    surface.document.elementFromPoint = () => slot
    neighbour.setAttribute('role', 'dialog')
    neighbour.getBoundingClientRect = () => new surface.DOMRect(1300, 200, 200, 200)
    expect(measureSiYuanViewport(slot as unknown as HTMLElement, true).visible).toBe(true)
    neighbour.setAttribute('data-native-view-occluder', 'true')
    expect(measureSiYuanViewport(slot as unknown as HTMLElement, true).visible).toBe(false)
  } finally { surface.close() }
})

it('measures the actual auxiliary document instead of the hidden main window', () => {
  const auxiliary = new Window({ url: 'about:blank' })
  try {
    auxiliary.name = 'sciforge-workbench:fixture.notes'
    Object.defineProperty(auxiliary, 'innerWidth', { value: 300 })
    Object.defineProperty(auxiliary, 'innerHeight', { value: 300 })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const element = auxiliary.document.createElement('div')
    auxiliary.document.body.append(element)
    element.getBoundingClientRect = () => new auxiliary.DOMRect(10, 20, 400, 400)
    element.checkVisibility = () => true
    auxiliary.document.elementFromPoint = () => element
    expect(measureSiYuanViewport(element as unknown as HTMLElement, true)).toEqual({
      x: 10, y: 20, width: 290, height: 280, visible: true, windowName: 'sciforge-workbench:fixture.notes'
    })
  } finally { auxiliary.close() }
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('restores the editor on explicit overlay close without polling or reloading', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 420, width: 400, height: 400, toJSON() {}
  })
  vi.spyOn(HTMLElement.prototype, 'checkVisibility').mockReturnValue(true)
  const hitTest = vi.spyOn(document, 'elementFromPoint').mockImplementation(() => document.body)
  const present = vi.fn<(input: { url: string | null; viewport: SiYuanEditorViewport }) => Promise<unknown>>(async () => ({ presented: true }))
  const onReady = vi.fn(), onError = vi.fn()
  function Harness() {
    const viewportRef = useRef<HTMLDivElement>(null)
    useNativeSiYuanPresentation({ active: true, url: 'https://notes.test/', viewportRef, present, onReady, onError })
    return createElement('div', { ref: viewportRef })
  }
  container = document.createElement('section')
  const overlay = document.createElement('div')
  overlay.setAttribute('data-native-view-occluder', 'true')
  container.append(overlay)
  document.body.append(container)
  const mount = document.createElement('div')
  container.append(mount)
  root = createRoot(mount)
  await act(async () => root!.render(createElement(Harness)))
  expect(present.mock.calls.at(-1)?.[0]).toMatchObject({ viewport: { visible: false } })
  expect(onReady).not.toHaveBeenCalled()
  await act(async () => { overlay.setAttribute('data-state', 'closed'); await new Promise(resolve => setTimeout(resolve, 40)) })
  expect(onReady).toHaveBeenCalledOnce()
  expect(present.mock.calls.at(-1)?.[0]).toMatchObject({ url: 'https://notes.test/', viewport: { visible: true } })
  expect(present).toHaveBeenCalledTimes(2)
  expect(hitTest).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
})

it('retains a hidden editor, replaces it on account switch, and disposes on unmount', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const rect = { x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 420, width: 400, height: 400, toJSON() {} }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  vi.spyOn(HTMLElement.prototype, 'checkVisibility').mockReturnValue(true)
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => container!.querySelector('div'))
  const present = vi.fn<(input: { url: string | null; viewport: SiYuanEditorViewport }) => Promise<unknown>>().mockResolvedValue({ presented: true })
  const onReady = vi.fn(), onError = vi.fn()
  function Harness({ active, sessionKey = 'user:a' }: { active: boolean; sessionKey?: string }) {
    const viewportRef = useRef<HTMLDivElement>(null)
    useNativeSiYuanPresentation({ active, sessionKey, url: 'http://localhost:7890/', viewportRef, present, onReady, onError })
    return createElement('div', { ref: viewportRef })
  }
  container = document.createElement('section')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(Harness, { active: true })))
  expect(present.mock.calls.at(-1)?.[0]).toMatchObject({ url: 'http://localhost:7890/', viewport: { visible: true } })
  await act(async () => root!.render(createElement(Harness, { active: false })))
  expect(present.mock.calls.at(-1)?.[0]).toMatchObject({ url: null, viewport: { visible: false } })
  expect(present.mock.calls.filter(([input]) => input.url !== null)).toHaveLength(1)
  await act(async () => root!.render(createElement(Harness, { active: true })))
  expect(present.mock.calls.at(-1)?.[0]).toMatchObject({ url: 'http://localhost:7890/', viewport: { visible: true } })
  await act(async () => root!.render(createElement(Harness, { active: true, sessionKey: 'user:b' })))
  expect(present.mock.calls.filter(([input]) => input.url === null)).toHaveLength(2)
  expect(present.mock.calls.at(-1)?.[0]).toMatchObject({ url: 'http://localhost:7890/', viewport: { visible: true } })
  await act(async () => root!.unmount())
  root = undefined
  expect(present.mock.calls.filter(([input]) => input.url === null)).toHaveLength(3)
  expect(onError).not.toHaveBeenCalled()
})

it.each(['rejected', 'unsupported'])('settles a %s presentation instead of retrying it on DOM mutations', async kind => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const rect = { x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 420, width: 400, height: 400, toJSON() {} }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  vi.spyOn(HTMLElement.prototype, 'checkVisibility').mockReturnValue(true)
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => container!.querySelector('div'))
  const present = kind === 'rejected' ? vi.fn(async () => { throw new Error('offline') }) : vi.fn(async () => ({ presented: false }))
  const onReady = vi.fn(), onError = vi.fn()
  function Harness({ revision = 0 }: { revision?: number }) {
    const viewportRef = useRef<HTMLDivElement>(null)
    useNativeSiYuanPresentation({ active: true, sessionKey: 'chat:one', reloadRevision: revision, url: 'https://notes.test/', viewportRef, present, onReady, onError })
    return createElement('div', { ref: viewportRef })
  }
  container = document.createElement('section')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(Harness)))
  expect(present).toHaveBeenCalledTimes(1)
  expect(onError).toHaveBeenCalledTimes(1)
  expect(onReady).not.toHaveBeenCalled()
  for (let i = 0; i < 3; i++) {
    await act(async () => { container!.append(document.createElement('span')); await new Promise(resolve => setTimeout(resolve, 25)) })
  }
  expect(present).toHaveBeenCalledTimes(1)
  await act(async () => root!.render(createElement(Harness, { revision: 1 })))
  expect(present).toHaveBeenCalledTimes(2)
})
