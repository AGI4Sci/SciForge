import { describe, expect, it, vi } from 'vitest'
import {
  openPathInSystemEditor,
  watchForSystemEditorReturn,
  type SystemEditorReturnEventTarget
} from './system-editor'

class TestEventTarget implements SystemEditorReturnEventTarget {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string): void {
    const event = new Event(type)
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }
}

describe('system editor', () => {
  it('opens a workspace path with the operating system application', async () => {
    const openPath = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/figure.png',
      editorId: 'system'
    }))

    await openPathInSystemEditor({
      openPath,
      path: '/workspace/figure.png',
      workspaceRoot: '/workspace'
    })

    expect(openPath).toHaveBeenCalledWith({
      path: '/workspace/figure.png',
      workspaceRoot: '/workspace',
      editorId: 'system'
    })
  })

  it('surfaces system application launch failures', async () => {
    await expect(openPathInSystemEditor({
      openPath: vi.fn(async () => ({ ok: false as const, message: 'No image editor is registered.' })),
      path: '/workspace/figure.png'
    })).rejects.toThrow('No image editor is registered.')
  })

  it('refreshes after focus returns and remains armed for later editor visits', () => {
    const windowTarget = new TestEventTarget()
    const documentTarget = new TestEventTarget()
    const onReturn = vi.fn()
    let hidden = false
    const dispose = watchForSystemEditorReturn({
      windowTarget,
      documentTarget,
      isDocumentHidden: () => hidden,
      onReturn
    })

    windowTarget.dispatch('focus')
    expect(onReturn).not.toHaveBeenCalled()

    windowTarget.dispatch('blur')
    windowTarget.dispatch('focus')
    windowTarget.dispatch('focus')
    expect(onReturn).toHaveBeenCalledTimes(1)

    hidden = true
    documentTarget.dispatch('visibilitychange')
    hidden = false
    documentTarget.dispatch('visibilitychange')
    expect(onReturn).toHaveBeenCalledTimes(2)

    dispose()
    windowTarget.dispatch('blur')
    windowTarget.dispatch('focus')
    expect(onReturn).toHaveBeenCalledTimes(2)
  })
})
