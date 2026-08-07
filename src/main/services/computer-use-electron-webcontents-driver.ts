import { createHash, randomUUID } from 'node:crypto'
import {
  insertedTextVerification,
  type CdpAdapterDriver,
  type CdpAdapterTarget,
  type ElectronWebContentsCdpAdapterTarget
} from './computer-use-cdp-adapter'

type DebuggerLike = {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, commandParams?: Record<string, unknown>): Promise<unknown>
  once?(event: 'detach', listener: (...args: unknown[]) => void): unknown
  removeListener?(event: 'detach', listener: (...args: unknown[]) => void): unknown
}

type NativeImageLike = {
  toPNG(): Buffer
  getSize(): { width: number; height: number }
}

export type ElectronWebContentsLike = {
  id: number
  debugger: DebuggerLike
  isDestroyed(): boolean
  getURL(): string
  getTitle(): string
  capturePage(): Promise<NativeImageLike>
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
}

type ElectronHandle = {
  id: string
  requestId: string
  targetId: string
  generation: string
  contents: ElectronWebContentsLike
  revision: number
  cancelled: boolean
  destroyed: boolean
  ownsDebugger: boolean
  onDestroyed: () => void
  onDebuggerDetach: () => void
}

export function createElectronWebContentsCdpDriver(
  listWebContents: () => readonly ElectronWebContentsLike[]
): CdpAdapterDriver {
  const adapterInstanceId = `electron-cdp-adapter-${randomUUID()}`
  const generation = `electron-cdp-generation-${randomUUID()}`
  const handles = new Map<string, ElectronHandle>()
  const handlesByRequest = new Map<string, string>()

  const availableContents = (): ElectronWebContentsLike[] => listWebContents()
    .filter((contents) => Number.isSafeInteger(contents.id) && contents.id > 0 && !contents.isDestroyed())

  const targetFor = (contents: ElectronWebContentsLike): ElectronWebContentsCdpAdapterTarget => ({
    targetId: stableElectronWebContentsTargetId(adapterInstanceId, contents.id),
    kind: 'electron-webcontents',
    ownership: 'attached',
    generation,
    locator: { webContentsId: contents.id },
    metadata: {
      title: contents.getTitle().slice(0, 2048),
      url: contents.getURL().slice(0, 2048)
    }
  })

  const requireHandle = (handleId: string): ElectronHandle => {
    const handle = handles.get(handleId)
    if (!handle || handle.destroyed || handle.contents.isDestroyed()) {
      throw new Error('TARGET_LOST: Electron webContents handle is unavailable.')
    }
    return handle
  }

  const detachOwnedDebugger = (handle: ElectronHandle): void => {
    if (!handle.ownsDebugger || handle.contents.isDestroyed()) return
    if (handle.contents.debugger.isAttached()) handle.contents.debugger.detach()
    handle.ownsDebugger = false
  }

  return Object.freeze({
    async available() {
      return {
        available: true,
        adapterInstanceId,
        generation,
        activeHandleCount: handles.size,
        supportedTargetKinds: ['electron-webcontents']
      }
    },
    async targets() {
      return availableContents().map(targetFor)
    },
    async open(target, requestId) {
      if (target.kind !== 'electron-webcontents') {
        throw new Error('ACTION_UNSUPPORTED: Electron driver accepts electron-webcontents targets only.')
      }
      const existingId = handlesByRequest.get(requestId)
      if (existingId) {
        const existing = requireHandle(existingId)
        if (existing.targetId !== target.targetId || existing.generation !== target.generation) {
          throw new Error('REQUEST_ID_CONFLICT: Electron open request identity changed.')
        }
        return { handleId: existing.id, targetId: existing.targetId, generation: existing.generation }
      }
      if (target.ownership !== 'attached') {
        throw new Error('Electron webContents are attached targets and are never destroyed by this driver.')
      }
      if (target.generation !== generation) {
        throw new Error('TARGET_LOST: Electron adapter generation changed.')
      }
      const contents = availableContents().find((candidate) => candidate.id === target.locator.webContentsId)
      if (!contents) throw new Error('TARGET_LOST: Electron webContents is unavailable.')
      const expected = targetFor(contents)
      if (expected.targetId !== target.targetId) {
        throw new Error('TARGET_LOST: Electron webContents identity changed.')
      }
      if (contents.debugger.isAttached()) {
        throw new Error('BACKEND_UNAVAILABLE: Electron webContents debugger is already attached.')
      }
      try {
        contents.debugger.attach('1.3')
      } catch (error) {
        throw new Error(`BACKEND_UNAVAILABLE: Electron debugger attach failed: ${safeMessage(error)}`)
      }
      const id = `electron-cdp-handle-${randomUUID()}`
      const handle: ElectronHandle = {
        id,
        requestId,
        targetId: target.targetId,
        generation,
        contents,
        revision: 0,
        cancelled: false,
        destroyed: false,
        ownsDebugger: true,
        onDestroyed: () => undefined,
        onDebuggerDetach: () => undefined
      }
      handle.onDestroyed = () => {
        handle.destroyed = true
        handle.ownsDebugger = false
      }
      handle.onDebuggerDetach = () => {
        handle.destroyed = true
        handle.ownsDebugger = false
      }
      contents.once('destroyed', handle.onDestroyed)
      contents.debugger.once?.('detach', handle.onDebuggerDetach)
      handles.set(id, handle)
      handlesByRequest.set(requestId, id)
      return { handleId: id, targetId: target.targetId, generation }
    },
    async observe(handleId) {
      const handle = requireHandle(handleId)
      if (handle.cancelled) throw new Error('Electron webContents handle was cancelled.')
      const image = await handle.contents.capturePage()
      if (handle.contents.isDestroyed()) {
        throw new Error('TARGET_LOST: Electron webContents closed during observe.')
      }
      handle.revision += 1
      return {
        targetId: handle.targetId,
        generation: handle.generation,
        revision: `electron-cdp:${handle.revision}`,
        imageBase64: image.toPNG().toString('base64'),
        metadata: {
          url: handle.contents.getURL().slice(0, 2048),
          title: handle.contents.getTitle().slice(0, 2048),
          viewport: image.getSize()
        }
      }
    },
    async action(handleId, input) {
      const handle = requireHandle(handleId)
      if (handle.cancelled) throw new Error('Electron webContents handle was cancelled.')
      if (input.expectedRevision !== `electron-cdp:${handle.revision}`) {
        throw new Error('STALE_OBSERVATION: Electron action revision does not match.')
      }
      const action = record(input.action)
      const name = String(action.action ?? '').toLowerCase()
      let verification: Record<string, unknown> = {
        status: 'unverified', details: { reason: 'action-has-no-semantic-readback' }
      }
      if (name === 'click' || name === 'left_click' || name === 'right_click' || name === 'double_click') {
        const [x, y] = coordinate(action.coordinate)
        const button = name === 'right_click' ? 'right' : 'left'
        const clickCount = name === 'double_click' ? 2 : 1
        await handle.contents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed', x, y, button, clickCount
        })
        await handle.contents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x, y, button, clickCount
        })
      } else if (name === 'type') {
        const text = String(action.text ?? '')
        const beforeReadback = await activeElementReadback(handle.contents)
        await handle.contents.debugger.sendCommand('Input.insertText', { text })
        const afterReadback = await activeElementReadback(handle.contents)
        verification = insertedTextVerification(beforeReadback, afterReadback, text)
      } else if (name === 'key' || name === 'hotkey') {
        const keys = (Array.isArray(action.keys) ? action.keys : [action.keys]).map(String).filter(Boolean)
        if (keys.length === 0) throw new Error('Electron key action requires keys.')
        await dispatchKeyChord(handle.contents, keys)
        verification = { status: 'unverified', details: { chord: keys.join('+') } }
      } else if (name === 'scroll') {
        const pixels = finiteNumber(action.pixels, 1)
        const before = await scrollPosition(handle.contents)
        await handle.contents.debugger.sendCommand('Runtime.evaluate', {
          expression: `window.scrollBy(0, ${JSON.stringify(pixels)})`, returnByValue: true
        })
        const after = await scrollPosition(handle.contents)
        verification = {
          status: before.x !== after.x || before.y !== after.y ? 'verified' : 'unverified',
          details: { before, after }
        }
      } else if (name === 'wait') {
        const durationMs = Math.min(30_000, Math.max(0, finiteNumber(action.time, 1) * 1000))
        await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
        verification = { status: 'not-applicable', details: {} }
      } else {
        throw new Error(`ACTION_UNSUPPORTED: ${name}`)
      }
      handle.revision += 1
      return {
        targetId: handle.targetId,
        generation: handle.generation,
        committed: name !== 'wait',
        mayHaveTakenEffect: name !== 'wait',
        verification: { ...verification, revisionAfter: `electron-cdp:${handle.revision}` }
      }
    },
    async cancel(handleId) {
      const handle = handles.get(handleId)
      if (handle) handle.cancelled = true
    },
    async close(handleId) {
      const handle = handles.get(handleId)
      if (!handle) return
      detachOwnedDebugger(handle)
      if (!handle.contents.isDestroyed()) {
        handle.contents.removeListener('destroyed', handle.onDestroyed)
        handle.contents.debugger.removeListener?.('detach', handle.onDebuggerDetach)
      }
      handles.delete(handleId)
      if (handlesByRequest.get(handle.requestId) === handleId) handlesByRequest.delete(handle.requestId)
    },
    async shutdown() {
      for (const handleId of [...handles.keys()]) {
        const handle = handles.get(handleId)
        if (!handle) continue
        handles.delete(handleId)
        if (!handle.contents.isDestroyed()) {
          handle.contents.removeListener('destroyed', handle.onDestroyed)
          handle.contents.debugger.removeListener?.('detach', handle.onDebuggerDetach)
        }
        try { detachOwnedDebugger(handle) } catch { /* best-effort shutdown */ }
      }
      handlesByRequest.clear()
    }
  })
}

export function stableElectronWebContentsTargetId(instanceId: string, webContentsId: number): string {
  const instanceHash = createHash('sha256').update(instanceId).digest('hex').slice(0, 24)
  return `electron:${instanceHash}:${webContentsId}`
}

export function createCompositeCdpDriver(drivers: readonly CdpAdapterDriver[]): CdpAdapterDriver {
  const adapterInstanceId = `composite-cdp-adapter-${randomUUID()}`
  const generation = `composite-cdp-generation-${randomUUID()}`
  const handles = new Map<string, { driver: CdpAdapterDriver; innerHandleId: string; targetId: string; requestId: string }>()
  const handlesByRequest = new Map<string, string>()

  const enumerate = async (): Promise<Array<{ driver: CdpAdapterDriver; outer: CdpAdapterTarget; inner: CdpAdapterTarget }>> => {
    const result: Array<{ driver: CdpAdapterDriver; outer: CdpAdapterTarget; inner: CdpAdapterTarget }> = []
    for (const driver of drivers) {
      const capability = await driver.available()
      if (!capability.available) continue
      for (const inner of await driver.targets()) {
        result.push({ driver, inner, outer: { ...inner, generation } as CdpAdapterTarget })
      }
    }
    return result
  }

  return Object.freeze({
    async available() {
      const capabilities = await Promise.all(drivers.map((driver) => driver.available()))
      const available = capabilities.filter((item) => item.available)
      return {
        available: available.length > 0,
        ...(available.length === 0 ? { reason: capabilities.map((item) => item.reason).filter(Boolean).join('; ') || 'No CDP target driver is available.' } : {}),
        adapterInstanceId,
        generation,
        activeHandleCount: handles.size,
        supportedTargetKinds: [...new Set(available.flatMap((item) => item.supportedTargetKinds ?? []))]
      }
    },
    async targets() {
      return (await enumerate()).map((item) => item.outer)
    },
    async open(target, requestId) {
      const priorId = handlesByRequest.get(requestId)
      if (priorId) {
        const prior = handles.get(priorId)
        if (!prior || prior.targetId !== target.targetId) {
          throw new Error('REQUEST_ID_CONFLICT: Composite CDP open request identity changed.')
        }
        return { handleId: priorId, targetId: prior.targetId, generation }
      }
      if (target.generation !== generation) throw new Error('TARGET_LOST: Composite adapter generation changed.')
      const match = (await enumerate()).find((item) => sameTarget(item.outer, target))
      if (!match) throw new Error('TARGET_LOST: CDP target is unavailable or changed identity.')
      const opened = await match.driver.open(match.inner, requestId)
      const handleId = `composite-cdp-handle-${randomUUID()}`
      handles.set(handleId, { driver: match.driver, innerHandleId: opened.handleId, targetId: target.targetId, requestId })
      handlesByRequest.set(requestId, handleId)
      return { handleId, targetId: target.targetId, generation }
    },
    async observe(handleId) {
      const handle = requireCompositeHandle(handles, handleId)
      return { ...(await handle.driver.observe(handle.innerHandleId)), targetId: handle.targetId, generation }
    },
    async action(handleId, input) {
      const handle = requireCompositeHandle(handles, handleId)
      return { ...(await handle.driver.action(handle.innerHandleId, input)), targetId: handle.targetId, generation }
    },
    async cancel(handleId, reason) {
      const handle = handles.get(handleId)
      if (handle) await handle.driver.cancel(handle.innerHandleId, reason)
    },
    async close(handleId, reason) {
      const handle = handles.get(handleId)
      if (!handle) return
      await handle.driver.close(handle.innerHandleId, reason)
      handles.delete(handleId)
      if (handlesByRequest.get(handle.requestId) === handleId) handlesByRequest.delete(handle.requestId)
    },
    async shutdown() {
      handles.clear()
      handlesByRequest.clear()
      await Promise.allSettled(drivers.map((driver) => driver.shutdown()))
    }
  })
}

function requireCompositeHandle(
  handles: Map<string, { driver: CdpAdapterDriver; innerHandleId: string; targetId: string; requestId: string }>,
  handleId: string
) {
  const handle = handles.get(handleId)
  if (!handle) throw new Error('TARGET_LOST: Composite CDP handle is unavailable.')
  return handle
}

function sameTarget(left: CdpAdapterTarget, right: CdpAdapterTarget): boolean {
  return left.kind === right.kind && left.targetId === right.targetId &&
    JSON.stringify(left.locator) === JSON.stringify(right.locator)
}

async function activeElementReadback(contents: ElectronWebContentsLike): Promise<string> {
  const response = record(await contents.debugger.sendCommand('Runtime.evaluate', {
    expression: `(() => { const e = document.activeElement; if (!e) return ''; return typeof e.value === 'string' ? e.value : (e.textContent || '') })()`,
    returnByValue: true
  }))
  return String(record(response.result).value ?? '')
}

async function scrollPosition(contents: ElectronWebContentsLike): Promise<{ x: number; y: number }> {
  const response = record(await contents.debugger.sendCommand('Runtime.evaluate', {
    expression: '({ x: window.scrollX, y: window.scrollY })', returnByValue: true
  }))
  const value = record(record(response.result).value)
  return { x: finiteNumber(value.x, 0), y: finiteNumber(value.y, 0) }
}

async function dispatchKeyChord(contents: ElectronWebContentsLike, keys: string[]): Promise<void> {
  const normalized = keys.map(electronKey)
  const modifiers = normalized.reduce((mask, key) => mask | modifierMask(key), 0)
  for (const key of normalized) {
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown', key, modifiers, ...(key.length === 1 ? { text: key } : {})
    })
  }
  for (const key of [...normalized].reverse()) {
    await contents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers })
  }
}

function electronKey(key: string): string {
  const aliases: Record<string, string> = {
    ctrl: 'Control', control: 'Control', alt: 'Alt', shift: 'Shift', meta: 'Meta',
    command: 'Meta', cmd: 'Meta', enter: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape'
  }
  return aliases[key.toLowerCase()] ?? key
}

function modifierMask(key: string): number {
  return key === 'Alt' ? 1 : key === 'Control' ? 2 : key === 'Meta' ? 4 : key === 'Shift' ? 8 : 0
}

function coordinate(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) throw new Error('Electron click requires a coordinate.')
  return [finiteNumber(value[0], Number.NaN), finiteNumber(value[1], Number.NaN)]
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    if (Number.isNaN(fallback)) throw new Error('Expected a finite number.')
    return fallback
  }
  return number
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.')
  return value as Record<string, unknown>
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replaceAll(/\s+/gu, ' ').slice(0, 500)
}
