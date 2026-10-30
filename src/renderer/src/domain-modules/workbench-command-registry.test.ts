import { describe, expect, it, vi } from 'vitest'
import { WorkbenchCommandRegistry } from './workbench-command-registry'

describe('WorkbenchCommandRegistry', () => {
  it('registers one canonical handler per stable command ID', () => {
    const commands = new WorkbenchCommandRegistry()
    commands.register({
      id: 'paper-radar.open',
      ownerId: 'sciforge.paper-radar',
      contribution: { execute: () => undefined }
    })

    expect(commands.resolve('paper-radar.open')).toMatchObject({
      id: 'paper-radar.open',
      ownerId: 'sciforge.paper-radar'
    })
    expect(() => commands.register({
      id: 'paper-radar.open',
      ownerId: 'example.duplicate',
      contribution: { execute: () => undefined }
    })).toThrow('Duplicate renderer contribution "paper-radar.open"')
  })

  it('delegates right-panel, bottom-panel, and overlay commands without target switches', async () => {
    const commands = new WorkbenchCommandRegistry()
    const openRightPanel = vi.fn()
    const openBottomPanel = vi.fn()
    const toggleOverlay = vi.fn()
    const registrations = [
      ['review.open', openRightPanel],
      ['terminal.open', openBottomPanel],
      ['comments.toggle', toggleOverlay]
    ] as const
    for (const [id, execute] of registrations) {
      commands.register({
        id,
        ownerId: `sciforge.${id.split('.')[0]}`,
        contribution: { execute }
      })
    }
    const invocation = {
      sessionId: 'session-1',
      workspaceRoot: '/workspace/lab',
      payload: { revision: 3, source: 'timeline' }
    } as const

    await expect(commands.execute('review.open', invocation)).resolves.toBe(true)
    await expect(commands.execute('terminal.open', invocation)).resolves.toBe(true)
    await expect(commands.execute('comments.toggle', invocation)).resolves.toBe(true)
    expect(openRightPanel).toHaveBeenCalledWith(invocation)
    expect(openBottomPanel).toHaveBeenCalledWith(invocation)
    expect(toggleOverlay).toHaveBeenCalledWith(invocation)
  })

  it('fails closed for unavailable, unknown, throwing-state, and invalid invocations', async () => {
    const commands = new WorkbenchCommandRegistry()
    const execute = vi.fn()
    commands.register({
      id: 'review.open',
      ownerId: 'sciforge.review',
      contribution: {
        execute,
        isAvailable: () => false,
        isActive: () => {
          throw new Error('state failed')
        }
      }
    })

    expect(commands.isActive('review.open', {})).toBe(false)
    await expect(commands.execute('review.open', {})).resolves.toBe(false)
    await expect(commands.execute('missing.open', {})).resolves.toBe(false)
    await expect(commands.execute('review.open', {
      sessionId: ''
    } as never)).resolves.toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })

  it('propagates handler failures to the invoking surface', async () => {
    const commands = new WorkbenchCommandRegistry()
    commands.register({
      id: 'review.open',
      ownerId: 'sciforge.review',
      contribution: {
        execute: () => {
          throw new Error('handler failed')
        }
      }
    })

    await expect(commands.execute('review.open', {})).rejects.toThrow('handler failed')
  })
})
