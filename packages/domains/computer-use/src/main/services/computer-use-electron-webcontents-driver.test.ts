import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  createCompositeCdpDriver,
  createElectronWebContentsCdpDriver,
  type ElectronWebContentsLike
} from './computer-use-electron-webcontents-driver'

class FakeWebContents extends EventEmitter implements ElectronWebContentsLike {
  readonly id = 17
  destroyed = false
  attached = false
  text = ''
  scrollY = 0
  readonly commands: Array<{ method: string; params?: Record<string, unknown> }> = []
  private readonly debuggerEvents = new EventEmitter()
  readonly debugger = {
    isAttached: () => this.attached,
    attach: () => { this.attached = true },
    detach: () => { this.externalDebuggerDetach() },
    once: (event: string, listener: (...args: unknown[]) => void) => {
      this.debuggerEvents.once(event, listener)
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      this.debuggerEvents.removeListener(event, listener)
    },
    sendCommand: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      this.commands.push({ method, ...(params ? { params } : {}) })
      if (method === 'Input.insertText') this.text += String(params?.text ?? '')
      if (method === 'Runtime.evaluate') {
        const expression = String(params?.expression ?? '')
        if (expression.includes('window.scrollBy')) {
          const amount = Number(/scrollBy\(0,\s*(-?[\d.]+)/u.exec(expression)?.[1] ?? 0)
          this.scrollY += amount
        }
        return expression.includes('scrollX')
          ? { result: { value: { x: 0, y: this.scrollY } } }
          : { result: { value: this.text } }
      }
      return {}
    }
  }

  isDestroyed(): boolean { return this.destroyed }
  getURL(): string { return 'app://sciforge.test/' }
  getTitle(): string { return 'SciForge test surface' }
  externalDebuggerDetach(): void {
    this.attached = false
    this.debuggerEvents.emit('detach')
  }
  async capturePage() {
    return {
      toPNG: () => Buffer.from('test-png'),
      getSize: () => ({ width: 640, height: 480 })
    }
  }
  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

describe('Electron webContents CDP driver', () => {
  it('binds input and capture to one webContents and detaches without destroying it', async () => {
    const contents = new FakeWebContents()
    const driver = createElectronWebContentsCdpDriver(() => [contents])
    const capability = await driver.available()
    expect(capability).toMatchObject({
      available: true, activeHandleCount: 0, supportedTargetKinds: ['electron-webcontents']
    })
    const [target] = await driver.targets()
    expect(target).toMatchObject({
      kind: 'electron-webcontents', ownership: 'attached', locator: { webContentsId: 17 }
    })
    const opened = await driver.open(target!, 'request-electron-1')
    const replay = await driver.open(target!, 'request-electron-1')
    expect(replay).toEqual(opened)
    expect(contents.attached).toBe(true)

    const observation = await driver.observe(opened.handleId)
    expect(observation).toMatchObject({ targetId: target!.targetId, revision: 'electron-cdp:1' })
    const action = await driver.action(opened.handleId, {
      expectedRevision: 'electron-cdp:1',
      action: { action: 'type', text: 'isolated-electron' }
    })
    expect(action).toMatchObject({
      targetId: target!.targetId,
      verification: { status: 'verified', revisionAfter: 'electron-cdp:2' }
    })
    expect(contents.text).toBe('isolated-electron')

    await driver.close(opened.handleId, 'done')
    expect(contents.attached).toBe(false)
    expect(contents.destroyed).toBe(false)
    await expect(driver.targets()).resolves.toHaveLength(1)
  })

  it('does not steal or detach a debugger owned by another caller', async () => {
    const contents = new FakeWebContents()
    contents.attached = true
    const detach = vi.spyOn(contents.debugger, 'detach')
    const driver = createElectronWebContentsCdpDriver(() => [contents])
    const [target] = await driver.targets()
    await expect(driver.open(target!, 'request-busy-debugger')).rejects.toThrow('BACKEND_UNAVAILABLE')
    await driver.shutdown()
    expect(detach).not.toHaveBeenCalled()
    expect(contents.attached).toBe(true)
  })

  it('never claims or detaches a debugger when attach ownership is ambiguous', async () => {
    const contents = new FakeWebContents()
    const detach = vi.spyOn(contents.debugger, 'detach')
    contents.debugger.attach = () => {
      contents.attached = true
      throw new Error('another debugger won the attach race')
    }
    const driver = createElectronWebContentsCdpDriver(() => [contents])
    const [target] = await driver.targets()
    await expect(driver.open(target!, 'request-attach-unknown')).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE', safeToRetry: false
    })
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 1 })
    await expect(driver.open(target!, 'request-attach-unknown')).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE', safeToRetry: false
    })
    await expect(driver.shutdown()).rejects.toThrow('cleanup is incomplete')
    expect(detach).not.toHaveBeenCalled()
    expect(contents.attached).toBe(true)
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 1 })

    contents.externalDebuggerDetach()
    const recovered = await driver.open(target!, 'request-attach-unknown')
    await driver.close(recovered.handleId, 'unknown-debugger-is-gone')
    expect(detach).not.toHaveBeenCalled()
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 0 })
  })

  it('reports target loss for a destroyed webContents and clears owned handles on shutdown', async () => {
    const contents = new FakeWebContents()
    const driver = createElectronWebContentsCdpDriver(() => [contents])
    const [target] = await driver.targets()
    const opened = await driver.open(target!, 'request-destroyed')
    contents.destroy()
    await expect(driver.observe(opened.handleId)).rejects.toThrow('TARGET_LOST')
    await driver.shutdown()
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 0 })
  })

  it('safely releases an uncertain Open when its target disappeared before replay', async () => {
    const contents = new FakeWebContents()
    const driver = createElectronWebContentsCdpDriver(() => [contents])
    const [target] = await driver.targets()
    await driver.open(target!, 'request-open-target-destroyed')
    contents.destroy()

    await expect(driver.open(target!, 'request-open-target-destroyed')).rejects.toMatchObject({
      code: 'TARGET_LOST', safeToRetry: true
    })
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 0 })
    await driver.shutdown()
  })

  it('retains cleanup ownership when debugger detach fails so close can retry', async () => {
    const contents = new FakeWebContents()
    let failDetach = true
    contents.debugger.detach = () => {
      if (failDetach) throw new Error('detach blocked')
      contents.attached = false
    }
    const driver = createElectronWebContentsCdpDriver(() => [contents])
    const [target] = await driver.targets()
    const opened = await driver.open(target!, 'request-detach-retry')
    await expect(driver.close(opened.handleId, 'first')).rejects.toThrow('detach blocked')
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 1 })
    failDetach = false
    await driver.close(opened.handleId, 'retry')
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 0 })
  })

  it('retries an owned mouse release during close after partial dispatch failure', async () => {
    const contents = new FakeWebContents()
    const originalSend = contents.debugger.sendCommand
    let failRelease = true
    contents.debugger.sendCommand = async (method, params) => {
      if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased' && failRelease) {
        throw new Error('mouse release transport failed')
      }
      return originalSend(method, params)
    }
    const driver = createElectronWebContentsCdpDriver(() => [contents])
    const [target] = await driver.targets()
    const opened = await driver.open(target!, 'request-mouse-release-retry')
    const observed = await driver.observe(opened.handleId)

    await expect(driver.action(opened.handleId, {
      expectedRevision: observed.revision,
      action: { action: 'click', coordinate: [12, 18] }
    })).rejects.toThrow('mouse release')
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 1 })

    failRelease = false
    await driver.close(opened.handleId, 'cleanup-retry')
    expect(contents.attached).toBe(false)
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 0 })
    expect(contents.commands.filter(({ method, params }) => (
      method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased'
    ))).toHaveLength(1)
  })

  it('retains and releases owned modifier keys when a chord fails midway', async () => {
    const contents = new FakeWebContents()
    const originalSend = contents.debugger.sendCommand
    let failSecondKeyDown = true
    let failKeyRelease = true
    contents.debugger.sendCommand = async (method, params) => {
      if (method === 'Input.dispatchKeyEvent' && params?.type === 'keyDown' && params.key === 'a' && failSecondKeyDown) {
        failSecondKeyDown = false
        throw new Error('second keyDown transport failed')
      }
      if (method === 'Input.dispatchKeyEvent' && params?.type === 'keyUp' && failKeyRelease) {
        throw new Error('key release transport failed')
      }
      return originalSend(method, params)
    }
    const driver = createElectronWebContentsCdpDriver(() => [contents])
    const [target] = await driver.targets()
    const opened = await driver.open(target!, 'request-key-release-retry')
    const observed = await driver.observe(opened.handleId)

    await expect(driver.action(opened.handleId, {
      expectedRevision: observed.revision,
      action: { action: 'hotkey', keys: ['ctrl', 'a'] }
    })).rejects.toThrow('key release')
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 1 })

    failKeyRelease = false
    await driver.close(opened.handleId, 'cleanup-retry')
    expect(contents.attached).toBe(false)
    expect(contents.commands).toContainEqual({
      method: 'Input.dispatchKeyEvent',
      params: { type: 'keyUp', key: 'Control', modifiers: 2 }
    })
    await expect(driver.available()).resolves.toMatchObject({ activeHandleCount: 0 })
  })

  it('retains composite handles until a failed child shutdown succeeds on retry', async () => {
    const contents = new FakeWebContents()
    let failDetach = true
    contents.debugger.detach = () => {
      if (failDetach) throw new Error('detach blocked')
      contents.attached = false
    }
    const child = createElectronWebContentsCdpDriver(() => [contents])
    const composite = createCompositeCdpDriver([child])
    const [target] = await composite.targets()
    await composite.open(target!, 'request-composite-shutdown-retry')

    await expect(composite.shutdown()).rejects.toThrow('cleanup is incomplete')
    await expect(composite.available()).resolves.toMatchObject({ activeHandleCount: 1 })
    failDetach = false
    await composite.shutdown()
    await expect(composite.available()).resolves.toMatchObject({ activeHandleCount: 0 })
  })
})
