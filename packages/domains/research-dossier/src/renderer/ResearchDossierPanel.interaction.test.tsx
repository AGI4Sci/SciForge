import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { getI18n, setI18n } from 'react-i18next'
import { Window } from 'happy-dom'

import type {
  ResearchCheckpointStartInputV1,
  ResearchCheckpointStartReceiptV1,
  ResearchCheckpointStatusV1,
  ResearchCheckpointStopInputV1,
  ResearchCheckpointStopReceiptV1
} from '@sciforge/domain-research-checkpoints/contract'

import {
  ResearchDossierPanel,
  type ResearchDossierPanelProps
} from './ResearchDossierPanel.js'
import type { ResearchDossierCapabilityClient } from './research-dossier-capability-client.js'

type Deferred<T> = Readonly<{
  promise: Promise<T>
  resolve: (value: T) => void
}>

type CheckpointResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false
      issue: Readonly<{
        code: 'stale-conflict'
        message: string
        retryable: boolean
      }>
    }>

const browserWindow = new Window({ url: 'https://sciforge.test/' })
const globalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>()
const previousI18n = getI18n()
const translateKey = (key: string | readonly string[]): string => (
  typeof key === 'string' ? key : key.at(-1) ?? ''
)

before(() => {
  setI18n({
    isInitialized: true,
    language: 'en',
    languages: ['en'],
    options: {
      defaultNS: 'common',
      ns: ['common'],
      react: { bindI18n: '', bindI18nStore: '', useSuspense: false }
    },
    getFixedT: () => translateKey,
    hasLoadedNamespace: () => true
  } as never)
  const browserGlobals: Readonly<Record<string, unknown>> = {
    window: browserWindow,
    self: browserWindow,
    document: browserWindow.document,
    navigator: browserWindow.navigator,
    Node: browserWindow.Node,
    Element: browserWindow.Element,
    HTMLElement: browserWindow.HTMLElement,
    HTMLButtonElement: browserWindow.HTMLButtonElement,
    SVGElement: browserWindow.SVGElement,
    Event: browserWindow.Event,
    MouseEvent: browserWindow.MouseEvent,
    MutationObserver: browserWindow.MutationObserver,
    getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
    requestAnimationFrame: browserWindow.requestAnimationFrame.bind(browserWindow),
    cancelAnimationFrame: browserWindow.cancelAnimationFrame.bind(browserWindow),
    IS_REACT_ACT_ENVIRONMENT: true
  }
  for (const [key, value] of Object.entries(browserGlobals)) {
    globalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
})

after(() => {
  setI18n(previousI18n)
  for (const [key, descriptor] of globalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  browserWindow.close()
})

test('clicking Stop before v1 and Start again binds the canonical policy revision and refreshes status', async () => {
  const stopReceipt = deferred<CheckpointResult<ResearchCheckpointStopReceiptV1>>()
  const startReceipt = deferred<CheckpointResult<ResearchCheckpointStartReceiptV1>>()
  const stopInputs: ResearchCheckpointStopInputV1[] = []
  const startInputs: ResearchCheckpointStartInputV1[] = []
  const statusReads: Array<Readonly<{ runtimeId: string; threadId: string }>> = []
  const statuses = [
    automaticStatus(7, true),
    automaticStatus(8, false),
    automaticStatus(9, true)
  ]
  const client = recordingClient({
    statuses,
    statusReads,
    stop: (input) => {
      stopInputs.push(input)
      return stopReceipt.promise
    },
    start: (input) => {
      startInputs.push(input)
      return startReceipt.promise
    }
  })
  const mounted = await mountPanel(client)

  try {
    const stopButton = buttonByLabel(mounted.container, 'researchDossierStopRecording')
    assert.equal(stopButton.disabled, false)

    await act(async () => {
      stopButton.click()
      await tick()
    })
    assert.deepEqual(stopInputs, [{
      runtimeId: 'codex',
      threadId: 'thread-policy',
      expectedPolicyRevision: 7,
      idempotencyKey: stopInputs[0]?.idempotencyKey
    }])
    assert.equal('recordingId' in stopInputs[0]!, false)
    const pendingStopButton = buttonByLabel(mounted.container, 'researchDossierStopRecording')
    assert.equal(pendingStopButton.disabled, true)
    assert.equal(pendingStopButton.getAttribute('aria-busy'), 'true')
    assert.match(pendingStopButton.textContent, /researchDossierStoppingRecording/u)

    await act(async () => {
      pendingStopButton.click()
      await tick()
    })
    assert.equal(stopInputs.length, 1)

    await act(async () => {
      stopReceipt.resolve({ ok: true, value: { recording: null, policyRevision: 8 } })
      await stopReceipt.promise
      await tick()
      await tick()
    })
    await settleReact()
    assert.equal(statusReads.length, 2)
    assert.match(mounted.container.innerHTML, /data-research-recording-policy-revision="8"/u)
    const startButton = buttonByLabel(mounted.container, 'researchDossierStartRecording')
    assert.equal(startButton.disabled, false)

    await act(async () => {
      startButton.click()
      await tick()
    })
    assert.deepEqual(startInputs, [{
      runtimeId: 'codex',
      threadId: 'thread-policy',
      expectedPolicyRevision: 8,
      idempotencyKey: startInputs[0]?.idempotencyKey
    }])
    const pendingStartButton = buttonByLabel(mounted.container, 'researchDossierStartRecording')
    assert.equal(pendingStartButton.disabled, true)
    assert.equal(pendingStartButton.getAttribute('aria-busy'), 'true')

    await act(async () => {
      pendingStartButton.click()
      await tick()
    })
    assert.equal(startInputs.length, 1)

    await act(async () => {
      startReceipt.resolve({
        ok: true,
        value: {
          created: true,
          recording: activeRecording(),
          policyRevision: 9
        }
      })
      await startReceipt.promise
      await tick()
      await tick()
    })
    await settleReact()
    assert.equal(statusReads.length, 3)
    assert.match(mounted.container.innerHTML, /data-research-recording-policy-revision="9"/u)
    assert.equal(buttonByLabel(mounted.container, 'researchDossierStopRecording').disabled, false)
  } finally {
    await mounted.unmount()
  }
})

test('a failed policy action restores the control and a retry refreshes canonical status', async () => {
  const firstStop = deferred<CheckpointResult<ResearchCheckpointStopReceiptV1>>()
  const secondStop = deferred<CheckpointResult<ResearchCheckpointStopReceiptV1>>()
  const stopInputs: ResearchCheckpointStopInputV1[] = []
  const statusReads: Array<Readonly<{ runtimeId: string; threadId: string }>> = []
  const client = recordingClient({
    statuses: [
      automaticStatus(11, true),
      automaticStatus(12, true),
      automaticStatus(13, false)
    ],
    statusReads,
    stop: (input) => {
      stopInputs.push(input)
      return stopInputs.length === 1 ? firstStop.promise : secondStop.promise
    },
    start: async () => ({
      ok: true,
      value: { created: true, recording: activeRecording(), policyRevision: 13 }
    })
  })
  const mounted = await mountPanel(client)

  try {
    await act(async () => {
      buttonByLabel(mounted.container, 'researchDossierStopRecording').click()
      await tick()
    })
    await act(async () => {
      firstStop.resolve({
        ok: false,
        issue: {
          code: 'stale-conflict',
          message: 'The recording policy changed. Retry from the refreshed status.',
          retryable: true
        }
      })
      await firstStop.promise
      await tick()
    })
    await settleReact()
    assert.equal(statusReads.length, 2)
    assert.match(mounted.container.innerHTML, /data-research-recording-policy-revision="12"/u)
    assert.match(
      mounted.container.querySelector('[role="alert"]')?.textContent ?? '',
      /policy changed/iu
    )
    const retryButton = buttonByLabel(mounted.container, 'researchDossierStopRecording')
    assert.equal(retryButton.disabled, false)

    await act(async () => {
      retryButton.click()
      await tick()
    })
    assert.equal(stopInputs.length, 2)
    assert.equal(stopInputs[1]?.expectedPolicyRevision, 12)
    assert.equal(buttonByLabel(mounted.container, 'researchDossierStopRecording').disabled, true)

    await act(async () => {
      secondStop.resolve({ ok: true, value: { recording: null, policyRevision: 13 } })
      await secondStop.promise
      await tick()
      await tick()
    })
    await settleReact()
    assert.equal(statusReads.length, 3)
    assert.equal(buttonByLabel(mounted.container, 'researchDossierStartRecording').disabled, false)
    assert.equal(mounted.container.querySelector('[role="alert"]'), null)
  } finally {
    await mounted.unmount()
  }
})

test('a late recording status from session A cannot replace session B or leak its recording id', async () => {
  const statusA = deferred<CheckpointResult<ResearchCheckpointStatusV1>>()
  const statusB = deferred<CheckpointResult<ResearchCheckpointStatusV1>>()
  const statusReads: Array<Readonly<{
    workspaceRoot: string
    runtimeId: string
    threadId: string
  }>> = []
  const stopCalls: Array<Readonly<{
    workspaceRoot: string
    input: ResearchCheckpointStopInputV1
  }>> = []
  const client = {
    listArtifactVersions: async () => ({ ok: true, value: { items: [] } }),
    readResearchRecordingStatus: async (
      workspaceRoot: string,
      input: Readonly<{ runtimeId: string; threadId: string }>
    ) => {
      statusReads.push({ workspaceRoot, ...input })
      return input.threadId === 'thread-a' ? statusA.promise : statusB.promise
    },
    stopResearchRecording: async (
      workspaceRoot: string,
      input: ResearchCheckpointStopInputV1
    ) => {
      stopCalls.push({ workspaceRoot, input })
      return {
        ok: true as const,
        value: { recording: null, policyRevision: 23 }
      }
    }
  } as unknown as ResearchDossierCapabilityClient
  const mounted = await mountPanel(client, session('thread-a', 'runtime-a', '/workspace/a'))

  try {
    assert.deepEqual(statusReads, [{
      workspaceRoot: '/workspace/a',
      runtimeId: 'runtime-a',
      threadId: 'thread-a'
    }])

    await mounted.rerender(session('thread-b', 'runtime-b', '/workspace/b'))
    assert.deepEqual(statusReads[1], {
      workspaceRoot: '/workspace/b',
      runtimeId: 'runtime-b',
      threadId: 'thread-b'
    })
    assert.throws(
      () => buttonByLabel(mounted.container, 'researchDossierStopRecording'),
      /Missing button/u
    )

    await act(async () => {
      statusB.resolve({
        ok: true,
        value: automaticStatus(22, true, activeRecording('thread-b', 'recording:b'))
      })
      await statusB.promise
      await tick()
    })
    await settleReact()
    assert.match(mounted.container.innerHTML, /data-research-recording-policy-revision="22"/u)

    await act(async () => {
      statusA.resolve({
        ok: true,
        value: automaticStatus(11, true, activeRecording('thread-a', 'recording:a'))
      })
      await statusA.promise
      await tick()
    })
    await settleReact()
    assert.match(mounted.container.innerHTML, /data-research-recording-policy-revision="22"/u)
    assert.doesNotMatch(mounted.container.innerHTML, /policy-revision="11"/u)

    await act(async () => {
      buttonByLabel(mounted.container, 'researchDossierStopRecording').click()
      await tick()
    })
    assert.deepEqual(stopCalls[0], {
      workspaceRoot: '/workspace/b',
      input: {
        runtimeId: 'runtime-b',
        threadId: 'thread-b',
        recordingId: 'recording:b',
        expectedPolicyRevision: 22,
        idempotencyKey: stopCalls[0]?.input.idempotencyKey
      }
    })
  } finally {
    await mounted.unmount()
  }
})

for (const outcome of ['success', 'error'] as const) {
  test(`a late ${outcome} action response from session A cannot update or refresh session B`, async () => {
    const stopResult = deferred<CheckpointResult<ResearchCheckpointStopReceiptV1>>()
    const statusReads: Array<Readonly<{
      workspaceRoot: string
      runtimeId: string
      threadId: string
    }>> = []
    const client = {
      listArtifactVersions: async () => ({ ok: true, value: { items: [] } }),
      readResearchRecordingStatus: async (
        workspaceRoot: string,
        input: Readonly<{ runtimeId: string; threadId: string }>
      ) => {
        statusReads.push({ workspaceRoot, ...input })
        return {
          ok: true as const,
          value: input.threadId === 'thread-a'
            ? automaticStatus(31, true, activeRecording('thread-a', 'recording:a'))
            : automaticStatus(41, false)
        }
      },
      stopResearchRecording: async () => stopResult.promise
    } as unknown as ResearchDossierCapabilityClient
    const mounted = await mountPanel(client, session('thread-a', 'runtime-a', '/workspace/a'))

    try {
      await act(async () => {
        buttonByLabel(mounted.container, 'researchDossierStopRecording').click()
        await tick()
      })
      await mounted.rerender(session('thread-b', 'runtime-b', '/workspace/b'))
      assert.equal(buttonByLabel(mounted.container, 'researchDossierStartRecording').disabled, false)
      assert.match(mounted.container.innerHTML, /data-research-recording-policy-revision="41"/u)

      await act(async () => {
        stopResult.resolve(outcome === 'success'
          ? { ok: true, value: { recording: null, policyRevision: 32 } }
          : {
              ok: false,
              issue: {
                code: 'stale-conflict',
                message: 'Session A is stale.',
                retryable: true
              }
            })
        await stopResult.promise
        await tick()
      })
      await settleReact()

      assert.equal(statusReads.length, 2)
      assert.match(mounted.container.innerHTML, /data-research-recording-policy-revision="41"/u)
      assert.equal(buttonByLabel(mounted.container, 'researchDossierStartRecording').disabled, false)
      assert.equal(mounted.container.querySelector('[role="alert"]'), null)
      assert.doesNotMatch(mounted.container.textContent ?? '', /Session A is stale/u)
    } finally {
      await mounted.unmount()
    }
  })
}

function recordingClient(input: Readonly<{
  statuses: readonly ResearchCheckpointStatusV1[]
  statusReads: Array<Readonly<{ runtimeId: string; threadId: string }>>
  stop: (
    input: ResearchCheckpointStopInputV1
  ) => Promise<CheckpointResult<ResearchCheckpointStopReceiptV1>>
  start: (
    input: ResearchCheckpointStartInputV1
  ) => Promise<CheckpointResult<ResearchCheckpointStartReceiptV1>>
}>): ResearchDossierCapabilityClient {
  let statusIndex = 0
  return {
    listArtifactVersions: async () => ({ ok: true, value: { items: [] } }),
    readResearchRecordingStatus: async (
      _workspaceRoot: string,
      statusInput: Readonly<{ runtimeId: string; threadId: string }>
    ) => {
      input.statusReads.push(statusInput)
      const value = input.statuses[Math.min(statusIndex, input.statuses.length - 1)]
      statusIndex += 1
      assert.ok(value)
      return { ok: true, value }
    },
    stopResearchRecording: async (
      _workspaceRoot: string,
      stopInput: ResearchCheckpointStopInputV1
    ) => input.stop(stopInput),
    startResearchRecording: async (
      _workspaceRoot: string,
      startInput: ResearchCheckpointStartInputV1
    ) => input.start(startInput)
  } as unknown as ResearchDossierCapabilityClient
}

async function mountPanel(
  client: ResearchDossierCapabilityClient,
  initialSession: ResearchDossierPanelProps['session'] = session(
    'thread-policy',
    'codex',
    '/workspace/lab'
  )
): Promise<Readonly<{
  container: HTMLElement
  root: Root
  rerender: (session: ResearchDossierPanelProps['session']) => Promise<void>
  unmount: () => Promise<void>
}>> {
  const { createRoot } = await import('react-dom/client')
  const container = browserWindow.document.createElement('div') as unknown as HTMLElement
  browserWindow.document.body.append(container as never)
  const root = createRoot(container)
  const render = async (sessionValue: ResearchDossierPanelProps['session']) => act(async () => {
    root.render(
      <ResearchDossierPanel
        client={client}
        session={sessionValue}
        active
        onCollapse={() => undefined}
      />
    )
    await tick()
    await tick()
  })
  await render(initialSession)
  await settleReact()
  return {
    container,
    root,
    rerender: async (sessionValue) => {
      await render(sessionValue)
      await settleReact()
    },
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    }
  }
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${label}"]`)
  assert.ok(button instanceof browserWindow.HTMLButtonElement, `Missing button: ${label}`)
  return button as unknown as HTMLButtonElement
}

function automaticStatus(
  policyRevision: number,
  automaticEnabled: boolean,
  recording: ResearchCheckpointStatusV1['recording'] = null
): ResearchCheckpointStatusV1 {
  return {
    recordingMode: 'automatic',
    automaticEnabled,
    policyRevision,
    recording
  }
}

function activeRecording(
  threadId = 'thread-policy',
  recordingId = 'research-recording:policy-test'
): ResearchCheckpointStartReceiptV1['recording'] {
  return {
    recordingId,
    origin: 'live',
    runtimeId: 'codex',
    threadId,
    title: 'Policy interaction test',
    state: 'active',
    versionCount: 0,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z'
  }
}

function session(
  id: string,
  runtimeId: string,
  workspaceRoot: string
): ResearchDossierPanelProps['session'] {
  return { id, runtimeId, workspaceRoot }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function settleReact(): Promise<void> {
  await act(async () => {
    await tick()
    await tick()
  })
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}
