// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useNativeSiYuanPresentation } from './native-siyuan-presentation.js'
import type { SiYuanEditorViewport } from '../editor-contract.js'

let root: Root | undefined
let container: HTMLElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('hides an inactive editor without disposing it, then disposes once when the page unmounts', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const rect = { x: 10, y: 20, left: 10, top: 20, right: 410, bottom: 420, width: 400, height: 400, toJSON() {} }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  vi.spyOn(HTMLElement.prototype, 'checkVisibility').mockReturnValue(true)
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => container!.querySelector('div'))
  const present = vi.fn<(input: { url: string | null; viewport: SiYuanEditorViewport }) => Promise<unknown>>().mockResolvedValue(undefined)
  const onReady = vi.fn(), onError = vi.fn()
  function Harness({ active }: { active: boolean }) {
    const viewportRef = useRef<HTMLDivElement>(null)
    useNativeSiYuanPresentation({ active, url: 'http://localhost:7890/', viewportRef, present, onReady, onError })
    return createElement('div', { ref: viewportRef })
  }
  container = document.createElement('section')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(Harness, { active: true })))
  expect(present.mock.calls.at(-1)?.[0]).toMatchObject({ url: 'http://localhost:7890/', viewport: { visible: true } })
  await act(async () => root!.render(createElement(Harness, { active: false })))
  expect(present.mock.calls.at(-1)?.[0]).toMatchObject({ url: 'http://localhost:7890/', viewport: { visible: false } })
  expect(present.mock.calls.every(([input]) => input.url !== null)).toBe(true)
  await act(async () => root!.render(createElement(Harness, { active: true })))
  expect(present.mock.calls.at(-1)?.[0]).toMatchObject({ url: 'http://localhost:7890/', viewport: { visible: true } })
  await act(async () => root!.unmount())
  root = undefined
  expect(present.mock.calls.filter(([input]) => input.url === null)).toHaveLength(1)
  expect(onError).not.toHaveBeenCalled()
})
