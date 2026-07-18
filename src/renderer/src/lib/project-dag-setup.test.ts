import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROJECT_DAG_SETUP_EVENT,
  requestProjectDagSetup
} from './project-dag-setup'

describe('requestProjectDagSetup', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('dispatches the workspace request with its fixed Session owner', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal('CustomEvent', class {
      constructor(public type: string, public init: { detail: unknown }) {}
      get detail(): unknown { return this.init.detail }
    })

    requestProjectDagSetup({ sessionId: ' session-1 ', workspaceRoot: ' /workspace/a ' })

    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent
    expect(event.type).toBe(PROJECT_DAG_SETUP_EVENT)
    expect(event.detail).toEqual({ sessionId: 'session-1', workspaceRoot: '/workspace/a' })
  })

  it('does not create an ownerless command', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })

    requestProjectDagSetup({ sessionId: ' ', workspaceRoot: '/workspace/a' })

    expect(dispatchEvent).not.toHaveBeenCalled()
  })
})
