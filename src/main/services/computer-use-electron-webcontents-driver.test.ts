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
  readonly debugger = {
    isAttached: () => this.attached,
    attach: () => { this.attached = true },
    detach: () => { this.attached = false },
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
})
