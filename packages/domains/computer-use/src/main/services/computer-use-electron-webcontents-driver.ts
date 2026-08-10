import { createHash, randomUUID } from 'node:crypto'
import {
  CdpAdapterDriverError,
  insertedTextVerification,
  type CdpAdapterDriver,
  type CdpAdapterTarget,
  type ElectronWebContentsCdpAdapterTarget
} from './computer-use-cdp-adapter'
import {
  CDP_CSS_VIEWPORT_EXPRESSION,
  CDP_RENDERER_SETTLE_EXPRESSION,
  CDP_SEMANTIC_TREE_EXPRESSION,
  cdpClickReadbackExpression,
  normalizeCdpClickReadback,
  normalizeCdpSemanticTree,
  verifyCdpClick,
  type CdpClickReadback,
  type CdpSemanticNode
} from './computer-use-cdp-semantics'

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
  debuggerOwnershipUnknown: boolean
  pressedKeys: Set<string>
  pressedMouseButtons: Map<string, { x: number; y: number; clickCount: number }>
  observationViewport: { width: number; height: number } | null
  cssViewport: { width: number; height: number } | null
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

  const closeHandle = async (handleId: string): Promise<void> => {
    const handle = handles.get(handleId)
    if (!handle) return
    if (handle.debuggerOwnershipUnknown) {
      throw new Error('Electron debugger ownership is unknown; refusing to detach or release the handle.')
    }
    await releaseOwnedInput(handle)
    detachOwnedDebugger(handle)
    if (!handle.contents.isDestroyed()) {
      handle.contents.removeListener('destroyed', handle.onDestroyed)
      handle.contents.debugger.removeListener?.('detach', handle.onDebuggerDetach)
    }
    handles.delete(handleId)
    if (handlesByRequest.get(handle.requestId) === handleId) handlesByRequest.delete(handle.requestId)
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
        throw new CdpAdapterDriverError(
          'ACTION_UNSUPPORTED', 'Electron driver accepts electron-webcontents targets only.', true
        )
      }
      const existingId = handlesByRequest.get(requestId)
      if (existingId) {
        const existing = handles.get(existingId)
        if (!existing) {
          handlesByRequest.delete(requestId)
          throw new CdpAdapterDriverError(
            'TARGET_LOST', 'Electron open recovery handle is unavailable.', true
          )
        }
        if (existing.targetId !== target.targetId || existing.generation !== target.generation) {
          throw new Error('REQUEST_ID_CONFLICT: Electron open request identity changed.')
        }
        if (existing.destroyed || existing.contents.isDestroyed()) {
          if (!existing.contents.isDestroyed()) {
            existing.contents.removeListener('destroyed', existing.onDestroyed)
            existing.contents.debugger.removeListener?.('detach', existing.onDebuggerDetach)
          }
          handles.delete(existingId)
          handlesByRequest.delete(requestId)
          throw new CdpAdapterDriverError(
            'TARGET_LOST', 'Electron target disappeared before Open recovery.', true
          )
        }
        if (existing.debuggerOwnershipUnknown) {
          throw new CdpAdapterDriverError(
            'BACKEND_UNAVAILABLE',
            'Electron debugger ownership remains unknown after attach failure.',
            false
          )
        }
        return { handleId: existing.id, targetId: existing.targetId, generation: existing.generation }
      }
      if (target.ownership !== 'attached') {
        throw new CdpAdapterDriverError(
          'ACTION_UNSUPPORTED',
          'Electron webContents are attached targets and are never destroyed by this driver.',
          true
        )
      }
      if (target.generation !== generation) {
        throw new CdpAdapterDriverError(
          'TARGET_LOST', 'Electron adapter generation changed.', true
        )
      }
      const contents = availableContents().find((candidate) => candidate.id === target.locator.webContentsId)
      if (!contents) {
        throw new CdpAdapterDriverError(
          'TARGET_LOST', 'Electron webContents is unavailable.', true
        )
      }
      const expected = targetFor(contents)
      if (expected.targetId !== target.targetId) {
        throw new CdpAdapterDriverError(
          'TARGET_LOST', 'Electron webContents identity changed.', true
        )
      }
      if (contents.debugger.isAttached()) {
        throw new CdpAdapterDriverError(
          'BACKEND_UNAVAILABLE', 'Electron webContents debugger is already attached.', true
        )
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
        ownsDebugger: false,
        debuggerOwnershipUnknown: false,
        pressedKeys: new Set(),
        pressedMouseButtons: new Map(),
        observationViewport: null,
        cssViewport: null,
        onDestroyed: () => undefined,
        onDebuggerDetach: () => undefined
      }
      handle.onDestroyed = () => {
        handle.destroyed = true
        handle.ownsDebugger = false
        handle.debuggerOwnershipUnknown = false
      }
      handle.onDebuggerDetach = () => {
        // If attach ownership was ambiguous, a later detach proves that the
        // unknown debugger resource is gone and the quarantined request may
        // safely recover only to discard its logical handle.
        handle.destroyed = !handle.debuggerOwnershipUnknown
        handle.ownsDebugger = false
        handle.debuggerOwnershipUnknown = false
      }
      contents.once('destroyed', handle.onDestroyed)
      contents.debugger.once?.('detach', handle.onDebuggerDetach)
      handles.set(id, handle)
      handlesByRequest.set(requestId, id)
      try {
        contents.debugger.attach('1.3')
      } catch (error) {
        const attached = contents.debugger.isAttached()
        handle.ownsDebugger = false
        handle.debuggerOwnershipUnknown = attached
        if (!attached) {
          contents.removeListener('destroyed', handle.onDestroyed)
          contents.debugger.removeListener?.('detach', handle.onDebuggerDetach)
          handles.delete(id)
          handlesByRequest.delete(requestId)
        }
        throw new CdpAdapterDriverError(
          'BACKEND_UNAVAILABLE',
          `Electron debugger attach failed: ${safeMessage(error)}`,
          !attached
        )
      }
      handle.ownsDebugger = true
      return { handleId: id, targetId: target.targetId, generation }
    },
    async observe(handleId) {
      const handle = requireHandle(handleId)
      if (handle.cancelled) throw new Error('Electron webContents handle was cancelled.')
      const [image, semanticTree, cssViewport] = await Promise.all([
        handle.contents.capturePage(),
        electronSemanticTree(handle.contents),
        electronCssViewport(handle.contents)
      ])
      if (handle.contents.isDestroyed()) {
        throw new Error('TARGET_LOST: Electron webContents closed during observe.')
      }
      handle.revision += 1
      handle.observationViewport = image.getSize()
      handle.cssViewport = cssViewport
      return {
        targetId: handle.targetId,
        generation: handle.generation,
        revision: `electron-cdp:${handle.revision}`,
        imageBase64: image.toPNG().toString('base64'),
        metadata: {
          url: handle.contents.getURL().slice(0, 2048),
          title: handle.contents.getTitle().slice(0, 2048),
          viewport: handle.observationViewport,
          cssViewport,
          semanticTree
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
        const [observationX, observationY] = coordinate(action.coordinate)
        const [x, y] = electronInputCoordinate(handle, observationX, observationY)
        const button = name === 'right_click' ? 'right' : 'left'
        const clickCount = name === 'double_click' ? 2 : 1
        const beforeReadback = await clickReadback(handle.contents, x, y)
        const beforeSemanticTree = await electronSemanticTree(handle.contents)
        await dispatchMouseClick(handle, button, x, y, clickCount)
        await waitForRendererTurn(handle.contents)
        const afterReadback = await clickReadback(handle.contents, x, y)
        const afterSemanticTree = await electronSemanticTree(handle.contents)
        verification = verifyCdpClick(
          beforeReadback,
          afterReadback,
          beforeSemanticTree,
          afterSemanticTree
        )
      } else if (name === 'type') {
        const text = String(action.text ?? '')
        const beforeReadback = await activeElementReadback(handle.contents)
        await handle.contents.debugger.sendCommand('Input.insertText', { text })
        const afterReadback = await activeElementReadback(handle.contents)
        verification = insertedTextVerification(beforeReadback, afterReadback, text)
      } else if (name === 'key' || name === 'hotkey') {
        const keys = (Array.isArray(action.keys) ? action.keys : [action.keys]).map(String).filter(Boolean)
        if (keys.length === 0) throw new Error('Electron key action requires keys.')
        await dispatchKeyChord(handle, keys)
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
      await closeHandle(handleId)
    },
    async shutdown() {
      const errors: unknown[] = []
      for (const handleId of [...handles.keys()]) {
        try {
          await closeHandle(handleId)
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Electron webContents input cleanup is incomplete.')
      }
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
      if (target.generation !== generation) {
        throw new CdpAdapterDriverError(
          'TARGET_LOST', 'Composite adapter generation changed.', true
        )
      }
      let match: Awaited<ReturnType<typeof enumerate>>[number] | undefined
      try {
        match = (await enumerate()).find((item) => sameTarget(item.outer, target))
      } catch (error) {
        throw new CdpAdapterDriverError(
          'BACKEND_UNAVAILABLE', `Composite target discovery failed: ${safeMessage(error)}`, true
        )
      }
      if (!match) {
        throw new CdpAdapterDriverError(
          'TARGET_LOST', 'CDP target is unavailable or changed identity.', true
        )
      }
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
      const results = await Promise.allSettled(drivers.map((driver) => driver.shutdown()))
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason)
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Composite CDP driver cleanup is incomplete.')
      }
      handles.clear()
      handlesByRequest.clear()
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

async function waitForRendererTurn(contents: ElectronWebContentsLike): Promise<void> {
  await contents.debugger.sendCommand('Runtime.evaluate', {
    expression: CDP_RENDERER_SETTLE_EXPRESSION,
    awaitPromise: true,
    returnByValue: true
  })
}

async function electronSemanticTree(contents: ElectronWebContentsLike): Promise<CdpSemanticNode[]> {
  const response = record(await contents.debugger.sendCommand('Runtime.evaluate', {
    expression: CDP_SEMANTIC_TREE_EXPRESSION,
    returnByValue: true
  }))
  return normalizeCdpSemanticTree(record(response.result).value)
}

async function electronCssViewport(
  contents: ElectronWebContentsLike
): Promise<{ width: number; height: number }> {
  const response = record(await contents.debugger.sendCommand('Runtime.evaluate', {
    expression: CDP_CSS_VIEWPORT_EXPRESSION,
    returnByValue: true
  }))
  const value = record(record(response.result).value)
  return {
    width: Math.max(1, finiteNumber(value.width, 1)),
    height: Math.max(1, finiteNumber(value.height, 1))
  }
}

function electronInputCoordinate(handle: ElectronHandle, x: number, y: number): [number, number] {
  const observation = handle.observationViewport
  const css = handle.cssViewport
  if (!observation || !css) {
    throw new Error('STALE_OBSERVATION: Electron action has no captured viewport mapping.')
  }
  return [
    x * css.width / Math.max(1, observation.width),
    y * css.height / Math.max(1, observation.height)
  ]
}

async function clickReadback(
  contents: ElectronWebContentsLike,
  x: number,
  y: number
): Promise<CdpClickReadback> {
  const response = record(await contents.debugger.sendCommand('Runtime.evaluate', {
    expression: cdpClickReadbackExpression(x, y),
    returnByValue: true
  }))
  return normalizeCdpClickReadback(record(response.result).value)
}

async function scrollPosition(contents: ElectronWebContentsLike): Promise<{ x: number; y: number }> {
  const response = record(await contents.debugger.sendCommand('Runtime.evaluate', {
    expression: '({ x: window.scrollX, y: window.scrollY })', returnByValue: true
  }))
  const value = record(record(response.result).value)
  return { x: finiteNumber(value.x, 0), y: finiteNumber(value.y, 0) }
}

async function dispatchMouseClick(
  handle: ElectronHandle,
  button: string,
  x: number,
  y: number,
  clickCount: number
): Promise<void> {
  handle.pressedMouseButtons.set(button, { x, y, clickCount })
  try {
    await handle.contents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button, clickCount
    })
  } finally {
    // Record ownership before dispatch because a rejected promise does not
    // prove that the renderer failed to receive the press.
    await releaseOwnedMouseButtons(handle, [button])
  }
}

async function dispatchKeyChord(handle: ElectronHandle, keys: string[]): Promise<void> {
  const normalized = keys.map(electronKey)
  const modifiers = normalized.reduce((mask, key) => mask | modifierMask(key), 0)
  try {
    for (const key of normalized) {
      // Record ownership before dispatch so a lost keyDown response is still
      // balanced by keyUp during action cleanup or a later close retry.
      handle.pressedKeys.add(key)
      await handle.contents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown', key, modifiers, ...(key.length === 1 ? { text: key } : {})
      })
    }
  } finally {
    await releaseOwnedKeys(handle)
  }
}

async function releaseOwnedInput(handle: ElectronHandle): Promise<void> {
  if (handle.destroyed || handle.contents.isDestroyed()) {
    // Destroying the renderer also destroys its synthetic input state.
    handle.pressedKeys.clear()
    handle.pressedMouseButtons.clear()
    return
  }
  if (
    !handle.contents.debugger.isAttached()
    && (handle.pressedKeys.size > 0 || handle.pressedMouseButtons.size > 0)
  ) {
    throw new Error('Electron target was lost before owned input state could be released.')
  }
  const errors: unknown[] = []
  try {
    await releaseOwnedMouseButtons(handle)
  } catch (error) {
    errors.push(error)
  }
  try {
    await releaseOwnedKeys(handle)
  } catch (error) {
    errors.push(error)
  }
  if (errors.length > 0) throw new AggregateError(errors, 'Electron owned input release failed.')
}

async function releaseOwnedMouseButtons(
  handle: ElectronHandle,
  buttons: readonly string[] = [...handle.pressedMouseButtons.keys()].reverse()
): Promise<void> {
  const errors: unknown[] = []
  for (const button of buttons) {
    const state = handle.pressedMouseButtons.get(button)
    if (!state) continue
    try {
      await handle.contents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', button, ...state
      })
      handle.pressedMouseButtons.delete(button)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'Electron mouse release failed.')
}

async function releaseOwnedKeys(handle: ElectronHandle): Promise<void> {
  const errors: unknown[] = []
  for (const key of [...handle.pressedKeys].reverse()) {
    const modifiers = [...handle.pressedKeys].reduce((mask, pressed) => (
      mask | modifierMask(pressed)
    ), 0)
    try {
      await handle.contents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp', key, modifiers
      })
      handle.pressedKeys.delete(key)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'Electron key release failed.')
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
