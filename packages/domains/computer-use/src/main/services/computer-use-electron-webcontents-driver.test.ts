import { describe, expect, it, vi } from 'vitest'
import {
  createElectronWebContentsCdpDriver,
  type ElectronWebContentsLike
} from './computer-use-electron-webcontents-driver'

describe('Electron webContents CDP driver', () => {
  it('uses the structured scroll deltaX and deltaY values', async () => {
    const positions = [{ x: 0, y: 0 }, { x: 120, y: 340 }]
    const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (
        method === 'Runtime.evaluate' &&
        params?.expression === '({ x: window.scrollX, y: window.scrollY })'
      ) {
        return { result: { value: positions.shift() } }
      }
      return { result: { value: undefined } }
    })
    const contents: ElectronWebContentsLike = {
      id: 7,
      debugger: {
        isAttached: vi.fn(() => false),
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand,
        once: vi.fn(),
        removeListener: vi.fn()
      },
      isDestroyed: vi.fn(() => false),
      getURL: vi.fn(() => 'https://example.test/'),
      getTitle: vi.fn(() => 'Example'),
      capturePage: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn()
    }
    const driver = createElectronWebContentsCdpDriver(() => [contents])
    const [target] = await driver.targets()
    const opened = await driver.open(target, 'scroll-request')

    const result = await driver.action(opened.handleId, {
      expectedRevision: 'electron-cdp:0',
      action: { action: 'scroll', deltaX: 120, deltaY: 340 }
    })

    expect(sendCommand).toHaveBeenCalledWith('Runtime.evaluate', {
      expression: 'window.scrollBy(120, 340)',
      returnByValue: true
    })
    expect(result).toMatchObject({
      committed: true,
      mayHaveTakenEffect: true,
      verification: { status: 'verified' }
    })
  })
})
