import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { getI18n, setI18n } from 'react-i18next'
import { Window } from 'happy-dom'

import { createDomainRendererEntry, type ResearchDossierRightPanelContribution } from './index.js'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type {
  DomainRendererContribution,
  DomainRendererWorkbenchHost
} from '@sciforge/domain-sdk/host'
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
import { createResearchDossierCapabilityClient } from './research-dossier-capability-client.js'
import { ResearchDossierEvidenceReview } from './ResearchDossierEvidenceReview.js'
import { createResearchDossierActivation } from '../contract.js'
import type { ArtifactVersionListV2 } from '@sciforge/domain-artifact-versions/contract'

test('normal Dossier impact entry shares Evidence rerun UI and reads a pinned closure only after an explicit click', async () => {
  const reference = historyItem(1).ref, digest = `sha256:${'a'.repeat(64)}`
  const calls: { action: string; input: unknown; options: unknown }[] = []
  const client = createResearchDossierCapabilityClient({ invoke: async (contract: { actionId: string }, input: unknown, options: unknown) => {
    calls.push({ action: contract.actionId, input, options })
    if (contract.actionId !== 'evidence-dag.audit-query') throw new Error('fixture owner permission denied')
    return { subject: { artifactVersionRef: reference }, source: 'evidence-dag', freshness: 'stale', completeness: { complete: false, gapCodes: [] }, records: [{ recordId: 'review', recordDigest: digest, closureDigest: digest, threadId: 'codex:historical', sequence: 1, recordType: 'review', idempotencyKey: 'fixture-key', payload: {}, producerIdentity: 'fixture', reviewerIdentity: null, createdAt: '2026-11-05T00:00:00Z' }], scientificReview: { coverage: 'recorded-links-only', bounded: true, impacts: [{ recordDigest: digest, closureDigest: digest, status: 'requires-review', affectedIds: ['claim'], affected: [{ id: 'claim', title: 'affected-fixture' }], changes: [] }], conditions: ['independence', 'controls', 'negative-results', 'reproduction', 'scope'].map(axis => ({ axis, status: 'unknown', observations: [] })) } }
  } } as never)
  const mounted = await mountPanel({ listArtifactVersions: async () => ({ ok: true, value: { items: [] } }), readResearchRecordingStatus: async () => ({ ok: true, value: automaticStatus(1, false) }) } as never)
  try {
    await act(async () => mounted.root.render(<ResearchDossierEvidenceReview client={client} reference={reference} workspaceRoot="/workspace" runtimeId="codex" sessionId="current" />))
    assert.equal(calls.length, 0)
    await act(async () => { (mounted.container.querySelector('button') as HTMLButtonElement).click(); await tick() })
    assert.equal(calls.length, 1)
    const select = mounted.container.querySelector('select')!
    await act(async () => { select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { [...mounted.container.querySelectorAll('button')].find(button => button.textContent?.includes('读取最小'))!.click(); await tick() })
    assert.deepEqual(calls[1], { action: 'evidence-dag.rerun-spec', input: { runtimeId: 'codex', threadId: 'historical', closureDigest: digest, conclusionId: 'claim' }, options: { workspaceId: '/workspace' } })
    assert.match(mounted.container.textContent!, /fixture owner permission denied/)
    assert.equal(calls.some(call => call.action === 'create-loop.run'), false)
  } finally { await mounted.unmount() }
})

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

test('renders owner summary availability and only opens exact resources with an installed navigator', async () => {
  const opened: unknown[] = []
  const provided: Array<Readonly<{ sessionId: string; scopeId: string }>> = []
  const workbench: DomainRendererWorkbenchHost = {
    canOpenResource: (resourceKind) => resourceKind === 'evidence-claim',
    openResource: (input) => {
      opened.push(input)
      return true
    },
    openRightPanel: () => undefined
  }
  const researchSummaries = [
    {
      id: 'fixture.evidence-unavailable',
      kind: 'renderer.research-summary.v1',
      packageName: '@fixture/evidence',
      owner: { moduleId: 'fixture.evidence', moduleVersion: '1.0.0' },
      contract: {
        slot: 'status',
        label: 'Evidence',
        order: 30,
        scopeKinds: ['workspace'],
        resourceKinds: ['evidence-claim']
      },
      value: {
        provide: () => ({
          status: 'unavailable' as const,
          reason: 'Evidence access is restricted.'
        })
      }
    },
    {
      id: 'fixture.project-summary',
      kind: 'renderer.research-summary.v1',
      packageName: '@fixture/project',
      owner: { moduleId: 'fixture.project', moduleVersion: '1.0.0' },
      contract: {
        slot: 'goal',
        label: 'Goal',
        order: 10,
        scopeKinds: ['workspace'],
        resourceKinds: ['evidence-claim', 'artifact-version']
      },
      value: {
        provide: ({ session, scope }: { session: { id: string }; scope: { id: string } }) => {
          provided.push({ sessionId: session.id, scopeId: scope.id })
          return {
            status: 'available' as const,
            items: [{ label: 'Goal', value: 'Compare two exact runs', tone: 'positive' as const }],
            actions: [
              {
                label: 'Open claim',
                resource: { resourceKind: 'evidence-claim', resourceId: 'claim:exact-1' }
              },
              {
                label: 'Unavailable artifact navigator',
                resource: { resourceKind: 'artifact-version', resourceId: 'artifact-version:missing-1' }
              }
            ]
          }
        }
      }
    }
  ] as unknown as readonly DomainRendererContribution[]
  const client = recordingClient({
    statuses: [automaticStatus(1, true)],
    statusReads: [],
    stop: async () => ({ ok: true, value: { recording: null, policyRevision: 1 } }),
    start: async () => ({
      ok: true,
      value: { created: true, recording: activeRecording(), policyRevision: 1 }
    })
  })
  const mounted = await mountPanel(
    client,
    session('thread-summary', 'codex', '/workspace/summary'),
    { workbench, researchSummaries }
  )

  try {
    assert.deepEqual(provided, [{
      sessionId: 'thread-summary',
      scopeId: '/workspace/summary'
    }])
    const summaryList = mounted.container.querySelector('[data-research-summary-list]')
    assert.ok(summaryList)
    assert.match(summaryList.textContent ?? '', /Compare two exact runs/u)
    assert.match(summaryList.textContent ?? '', /Evidence access is restricted/u)
    assert.doesNotMatch(summaryList.textContent ?? '', /Unavailable artifact navigator/u)

    const openClaim = Array.from(summaryList.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Open claim'))
    assert.ok(openClaim)
    assert.equal((openClaim as HTMLButtonElement).disabled, false)
    ;(openClaim as HTMLButtonElement).click()
    assert.deepEqual(opened, [{
      sessionId: 'thread-summary',
      resource: {
        resourceKind: 'evidence-claim',
        resourceId: 'claim:exact-1'
      }
    }])
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
  ),
  overrides: Pick<ResearchDossierPanelProps, 'workbench' | 'researchSummaries'> = {}
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
        {...overrides}
        client={client}
        session={sessionValue}
        active
        onCollapse={() => undefined}
        surfaceId="surface-dossier-a"
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

test('keeps same-workspace browse content during refresh and clears it when workspace changes', async () => {
  const loads: Array<Deferred<{ ok: true; value: { items: unknown[] } }>> = []
  const listArtifactVersions = async (): Promise<{ ok: true; value: { items: unknown[] } }> => {
    const pending = deferred<{ ok: true; value: { items: unknown[] } }>()
    loads.push(pending)
    return pending.promise
  }
  const client = {
    listArtifactVersions,
    readResearchRecordingStatus: async (
      _workspaceRoot: string,
      _input: Readonly<{ runtimeId: string; threadId: string }>
    ) => ({ ok: true as const, value: automaticStatus(4, false) })
  } as unknown as ResearchDossierCapabilityClient
  const item = (label: string): unknown => ({
    artifact: { kind: 'research-checkpoint', label },
    version: {
      versionId: `artifact-version:${label}`,
      sequence: 1,
      createdAt: '2026-09-21T00:00:00.000Z'
    },
    artifactOrdinal: 1,
    isCurrent: true
  })
  const mounted = await mountPanel(client, session('thread-r1', 'codex', '/workspace/a'))
  try {
    // First load is pending: full-screen loader, no content yet.
    assert.equal(loads.length, 2)
    assert.match(mounted.container.innerHTML, /researchDossierLoading/u)
    assert.doesNotMatch(mounted.container.innerHTML, /Checkpoint A/u)

    // Resolve the first browse load with content A.
    await act(async () => {
      const pending = loads.splice(0)
      for (const deferredLoad of pending) deferredLoad.resolve({ ok: true, value: { items: [item('Checkpoint A')] } })
      await Promise.allSettled(pending.map((deferredLoad) => deferredLoad.promise))
      await tick()
    })
    await settleReact()
    assert.match(mounted.container.innerHTML, /Checkpoint A/u)
    assert.doesNotMatch(mounted.container.innerHTML, /researchDossierLoading/u)

    await act(async () => { buttonByLabel(mounted.container, 'researchDossierRefresh').click(); await tick() })
    assert.match(mounted.container.innerHTML, /Checkpoint A/u)
    assert.match(mounted.container.innerHTML, /researchDossierLoading/u)
    const staleRefresh = loads.splice(0)
    // A different workspace must never retain actionable records from A.
    await mounted.rerender(session('thread-r2', 'codex', '/workspace/b'))
    assert.equal(loads.length, 2)
    assert.doesNotMatch(mounted.container.innerHTML, /Checkpoint A/u)
    assert.match(mounted.container.innerHTML, /researchDossierLoading/u)

    // Resolve the refresh with content B: old content is replaced.
    await act(async () => {
      const pending = loads.splice(0)
      for (const deferredLoad of pending) deferredLoad.resolve({ ok: true, value: { items: [item('Checkpoint B')] } })
      await Promise.allSettled(pending.map((deferredLoad) => deferredLoad.promise))
      await tick()
    })
    await settleReact()
    assert.match(mounted.container.innerHTML, /Checkpoint B/u)
    assert.doesNotMatch(mounted.container.innerHTML, /Checkpoint A/u)
    await act(async () => {
      for (const pending of staleRefresh) pending.resolve({ ok: true, value: { items: [item('Stale A')] } })
      await tick()
    })
    assert.doesNotMatch(mounted.container.innerHTML, /Stale A/u)
  } finally {
    await mounted.unmount()
  }
})


test('real construct-then-publish order renders stages first and loads summary providers once on demand', async () => {
  let published: readonly DomainRendererContribution[] = []
  let provides = 0, reads = 0
  const host = {
    contributions: { list: (kind: string) => published.filter(entry => entry.kind === kind) },
    capabilityInvoker: { invoke: async (contract: { actionId: string }) => {
      reads++
      if (contract.actionId.includes('list')) return { ok: true, value: { items: [] } }
      return { ok: true, value: automaticStatus(1, false) }
    } }
  } as unknown as DomainRendererHost
  const entry = createDomainRendererEntry(host)
  const panel = entry.contributions.find(entry => entry.kind === 'renderer.workbench-right-panel')!.value as ResearchDossierRightPanelContribution
  published = [
    { id: 'fixture.stage', kind: 'renderer.extension', packageName: '@fixture/stage', owner: { moduleId: 'fixture.stage' }, contract: { location: 'research.workspace' }, value: { render: (context: { returnContributionId: string }) => <p data-stage-owner={context.returnContributionId}>阶段推进</p> } },
    { id: 'fixture.summary', kind: 'renderer.research-summary.v1', packageName: '@fixture/summary', owner: { moduleId: 'fixture.summary' }, contract: { slot: 'status', label: 'Evidence', order: 1, scopeKinds: ['workspace'], resourceKinds: [] }, value: { provide: () => { provides++; return { status: 'available', title: 'Formal evidence', items: [], actions: [] } } } }
  ] as unknown as readonly DomainRendererContribution[]
  const container = document.createElement('div')
  document.body.appendChild(container)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(container)
  const context = { session: session('thread-policy', 'codex', '/workspace/lab'), active: true, focused: true, className: '', surfaceId: 'workspace-test', onCollapse: () => undefined }
  try {
    await act(async () => { root.render(<React.Suspense fallback={<p>loading</p>}>{panel.render(context)}</React.Suspense>) })
    for (let i = 0; i < 40 && !container.querySelector('[data-stage-owner]'); i++) await settleReact()
    assert.equal(container.querySelector('[data-stage-owner]')?.getAttribute('data-stage-owner'), 'research-dossier.workbench-right-panel')
    assert.equal(reads, 0)
    assert.equal(provides, 0)
    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === '档案与版本')!.click(); await tick() })
    await settleReact()
    assert.equal(container.querySelectorAll('[data-research-summary]').length, 1)
    assert.equal(provides, 1)
    await act(async () => { root.render(<React.Suspense>{panel.render({ ...context, focused: false })}</React.Suspense>); await tick() })
    await settleReact()
    assert.equal(provides, 1)
  } finally { await act(async () => root.unmount()); container.remove() }
})

test('a repeated exact navigation reopens the dossier after a manual stage switch', async () => {
  const host = { capabilityInvoker: {}, contributions: { list: () => [] } } as unknown as DomainRendererHost
  const panel = createDomainRendererEntry(host).contributions.find(entry => entry.kind === 'renderer.workbench-right-panel')!.value as ResearchDossierRightPanelContribution
  const context = { session: session('thread-repeat', 'codex', '/workspace/lab'), active: true, focused: true, className: '', surfaceId: 'repeat-test', onCollapse: () => undefined }
  // Invalid exact targets still open the dossier's explicit validation error.
  const activation = { revision: 1, payload: { contractVersion: 0, target: { kind: 'artifact-version', versionId: 'missing' } } }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(container)
  const render = async (next = activation) => {
    await act(async () => { root.render(<React.Suspense>{panel.render({ ...context, activation: next })}</React.Suspense>) })
    await settleReact()
  }
  const selected = () => container.querySelector('nav[aria-label="科研"] button[aria-selected="true"]')?.textContent
  try {
    await render()
    assert.equal(selected(), '档案与版本')
    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === '阶段主线')!.click() })
    await render()
    assert.equal(selected(), '阶段主线', 'ordinary rerenders preserve the manual page')
    await render({ ...activation, payload: structuredClone(activation.payload) })
    assert.equal(selected(), '档案与版本', 'a new navigation to the same exact target must be honored')
  } finally { await act(async () => root.unmount()); container.remove() }
})

function historyItem(index: number, kind = 'research-output'): ArtifactVersionListV2['items'][number] {
  const versionId = `artifact-version:history:${index}`
  const artifactId = `artifact:history:${index}`
  const digest = index.toString(16).padStart(64, '0')
  const accessPolicy = { visibility: 'workspace' as const, principals: [], allowExport: true }
  return {
    artifact: { artifactId, kind, label: `History ${index}`, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', currentVersionId: versionId, versionCount: 1 },
    version: { schemaVersion: 1, artifactId, versionId, sequence: 200 - index, transactionId: `artifact-commit:${index}`, createdAt: '2026-08-01T00:00:00.000Z', intent: 'save', storage: { mode: 'snapshot', contentDigest: digest, byteLength: 4 }, accessPolicy, dependencies: [],
      metadata: { causality: 'host-authenticated-executor-write', runtimeId: 'codex', threadId: 'thread-policy' } },
    ref: { artifactId, versionId, contentDigest: digest, byteLength: 4, retention: 'snapshot', availability: 'available', accessPolicy },
    artifactOrdinal: 1, isCurrent: true
  }
}

test('production dossier paginates loaded rows, reads owner continuation and returns to the exact browse position', async () => {
  const rows = Array.from({ length: 62 }, (_, index) => historyItem(index))
  const calls: Array<{ kind?: string; beforeSequence?: number }> = []
  const described: string[] = []
  let navigation: ResearchDossierPanelProps['activation']
  const client = {
    readResearchRecordingStatus: async () => ({ ok: true, value: automaticStatus(1, false) }),
    listArtifactVersions: async (_workspace: string, input: { kind?: string; beforeSequence?: number }) => {
      calls.push(input)
      if (input.kind === 'research-checkpoint') return { ok: true, value: { items: [] } }
      if (!input.kind) return { ok: true, value: { items: rows.slice(0, 25), nextBeforeSequence: 176 } }
      const candidates = rows.filter(item => !input.beforeSequence || item.version.sequence < input.beforeSequence)
      return { ok: true, value: { items: candidates.slice(0, 25), ...(candidates.length > 25 ? { nextBeforeSequence: candidates[24]!.version.sequence } : {}) } }
    },
    describeArtifactVersion: async (_workspace: string, versionId: string) => {
      described.push(versionId)
      return { ok: true, value: rows.find(item => item.ref.versionId === versionId)! }
    }
  } as unknown as ResearchDossierCapabilityClient
  const workbench = { openRightPanel: (input: { activation?: ResearchDossierPanelProps['activation'] }) => { navigation = input.activation } } as unknown as DomainRendererWorkbenchHost
  const mounted = await mountPanel(client, undefined, { workbench })
  const render = async () => {
    await act(async () => { mounted.root.render(<ResearchDossierPanel client={client} session={session('thread-policy', 'codex', '/workspace/lab')} active surfaceId="history-test" onCollapse={() => undefined} workbench={workbench} activation={navigation} />); await tick() })
    await settleReact()
  }
  const click = async (key: string) => {
    const button = Array.from(mounted.container.querySelectorAll('button')).find(button => button.textContent === key)
    assert.ok(button, key)
    await act(async () => { button.click(); await tick() })
    await settleReact()
  }
  try {
    assert.equal(mounted.container.querySelectorAll('ol > li').length, 25)
    assert.equal(calls.length, 2)
    await click('researchDossierContinueHistory')
    assert.equal(calls.at(-1)!.beforeSequence, 176)
    assert.equal(mounted.container.querySelectorAll('ol > li').length, 25)
    await click('researchDossierNextPage')
    assert.match(mounted.container.textContent!, /History 49/u)
    assert.doesNotMatch(mounted.container.textContent!, /History 0\b/u)
    await act(async () => { (Array.from(mounted.container.querySelectorAll('ol button')).find(button => button.textContent?.includes('History 49')) as HTMLButtonElement).click(); await tick() })
    assert.deepEqual((navigation!.payload as { target: unknown }).target, { kind: 'artifact-version', versionId: 'artifact-version:history:49' })
    assert.equal((navigation!.payload as { expectedDigest: string }).expectedDigest, `sha256:${rows[49]!.ref.contentDigest}`)
    // Navigate directly to a version beyond the recent window, without scanning to find it.
    navigation = createResearchDossierActivation({ kind: 'artifact-version', versionId: rows[61]!.ref.versionId }, { page: 'versions', expectedDigest: `sha256:${rows[61]!.ref.contentDigest}` })
    await render()
    assert.deepEqual(described, ['artifact-version:history:61'])
    assert.equal(mounted.container.querySelector('[data-dossier-selected-version]')?.getAttribute('data-dossier-selected-version'), rows[61]!.ref.versionId)
    const countBeforeReturn = calls.length
    await click('researchDossierBackToHistory')
    await render()
    assert.match(mounted.container.textContent!, /History 49/u)
    assert.equal(calls.length, countBeforeReturn, 'return reuses presentation cache without restarting owner cursors')
  } finally { await mounted.unmount() }
})

test('exact Evidence reads use the public owner contract and closure navigation, never a review write', async () => {
  const reference = historyItem(61).ref
  const calls: Array<{ actionId: string; input: unknown; options: unknown }> = []
  const opened: unknown[] = []
  let wrongDigest = false
  const closureDigest = `sha256:${'b'.repeat(64)}`
  const client = createResearchDossierCapabilityClient({ invoke: async (contract: { actionId: string; effect: string }, input: unknown, options: unknown) => {
    assert.equal(contract.effect, 'read')
    calls.push({ actionId: contract.actionId, input, options })
    return { subject: { artifactVersionRef: { ...reference, ...(wrongDigest ? { contentDigest: 'f'.repeat(64) } : {}) } }, source: 'evidence-dag', freshness: 'unknown',
      completeness: { complete: false, gapCodes: ['source-not-covered'] },
      records: [{ recordId: 'review:1', recordDigest: `sha256:${'c'.repeat(64)}`, closureDigest, threadId: 'claude:historical-reviewer', sequence: 1, recordType: 'review', idempotencyKey: 'fixture-review', payload: { verdict: 'needs-review' }, producerIdentity: 'reviewer:1', reviewerIdentity: null, createdAt: '2026-08-01T00:00:00.000Z' }] }
  } } as never)
  const mounted = await mountPanel({ listArtifactVersions: async () => ({ ok: true, value: { items: [] } }), readResearchRecordingStatus: async () => ({ ok: true, value: automaticStatus(1, false) }) } as never)
  const workbench = { canOpenResource: () => true, openResource: (input: unknown) => { opened.push(input); return false } } as unknown as DomainRendererWorkbenchHost
  const click = async (key: string) => {
    const button = Array.from(mounted.container.querySelectorAll('button')).find(button => button.textContent === key)
    assert.ok(button, key)
    await act(async () => { button.click(); await tick() })
    await settleReact()
  }
  try {
    await act(async () => mounted.root.render(<ResearchDossierEvidenceReview client={client} reference={reference} workspaceRoot="/workspace/lab" sessionId="thread-policy" runtimeId="codex" workbench={workbench} />))
    assert.equal(calls.length, 0, 'mounting is not an audit or approval')
    await click('researchDossierReadEvidence')
    assert.deepEqual(calls[0], { actionId: 'evidence-dag.audit-query', input: { subject: { artifactVersionRef: reference } }, options: { workspaceId: '/workspace/lab' } })
    assert.match(mounted.container.textContent!, /unknown.*researchDossierHistoryPartial/u)
    assert.match(mounted.container.textContent!, /source-not-covered/u)
    await click('researchDossierOpenEvidenceClosure')
    assert.deepEqual(opened, [{ sessionId: 'thread-policy', resource: { resourceKind: 'evidence-closure', resourceId: closureDigest, integrity: { algorithm: 'sha256', expectedDigest: closureDigest } } }])
    assert.match(mounted.container.textContent!, /researchDossierEvidenceNavigationUnavailable/u)
    wrongDigest = true
    await click('researchDossierReadEvidence')
    assert.match(mounted.container.textContent!, /researchDossierEvidenceIdentityMismatch/u)
    assert.equal(mounted.container.querySelectorAll('ol li').length, 0)
    assert.ok(calls.every(call => call.actionId === 'evidence-dag.audit-query'))
  } finally { await mounted.unmount() }
})

test('a delayed browse continuation cannot replace another workspace or exact target', async () => {
  const pending = deferred<unknown>()
  const client = {
    readResearchRecordingStatus: async () => ({ ok: true, value: automaticStatus(1, false) }),
    listArtifactVersions: async (workspace: string, input: { kind: string; beforeSequence?: number }) => {
      if (input.kind === 'research-checkpoint') return { ok: true, value: { items: [] } }
      if (input.beforeSequence) return pending.promise
      return { ok: true, value: { items: [historyItem(workspace === '/workspace/a' ? 1 : 101)], ...(workspace === '/workspace/a' ? { nextBeforeSequence: 100 } : {}) } }
    }
  } as never
  const mounted = await mountPanel(client, session('thread-a', 'codex', '/workspace/a'))
  try {
    await act(async () => {
      Array.from(mounted.container.querySelectorAll('button')).find(button => button.textContent === 'researchDossierContinueHistory')!.click()
      await tick()
    })
    await mounted.rerender(session('thread-b', 'codex', '/workspace/b'))
    assert.match(mounted.container.textContent!, /History 101/u)
    await act(async () => { pending.resolve({ ok: true, value: { items: [historyItem(49)] } }); await tick() })
    assert.match(mounted.container.textContent!, /History 101/u)
    assert.doesNotMatch(mounted.container.textContent!, /History 49/u)
  } finally { await mounted.unmount() }
})

test('Evidence permission failures stay explicit and a late response cannot leak from an unmounted exact version', async () => {
  const pending = deferred<unknown>()
  let reads = 0
  const client = { queryEvidenceAudit: async () => {
    reads++
    if (reads === 1) return pending.promise
    throw new Error('access-restricted: Evidence permission denied')
  } } as never
  const mounted = await mountPanel({ listArtifactVersions: async () => ({ ok: true, value: { items: [] } }), readResearchRecordingStatus: async () => ({ ok: true, value: automaticStatus(1, false) }) } as never)
  const render = async (index: number) => {
    await act(async () => mounted.root.render(<ResearchDossierEvidenceReview key={index} client={client} reference={historyItem(index).ref} workspaceRoot={`/workspace/${index}`} sessionId="thread-policy" runtimeId="codex" />))
  }
  const read = async () => { await act(async () => {
    Array.from(mounted.container.querySelectorAll('button')).find(button => button.textContent === 'researchDossierReadEvidence')!.click()
    await tick()
  }) }
  try {
    await render(1)
    await read()
    assert.equal(mounted.container.querySelector('button')?.getAttribute('aria-busy'), 'true')
    await render(2)
    await read()
    assert.match(mounted.container.querySelector('[role=alert]')!.textContent!, /access-restricted.*permission denied/u)
    await act(async () => { pending.resolve({ subject: { artifactVersionRef: historyItem(1).ref }, source: 'evidence-dag', freshness: 'fresh', completeness: { complete: true, gapCodes: [] }, records: [] }); await tick() })
    assert.match(mounted.container.querySelector('[role=alert]')!.textContent!, /permission denied/u)
    assert.doesNotMatch(mounted.container.textContent!, /researchDossierEvidenceQueryComplete/u)
    assert.equal(reads, 2, 'no automatic retry after denial')
  } finally { await mounted.unmount() }
})


test('actual dossier search calls the owner for unloaded historical metadata, handles errors and resets on workspace change', async () => {
  const calls: Array<{ workspace: string; input: { kind?: string; metadataQuery?: string; currentOnly?: boolean; cursor?: string } }> = []
  const client = createResearchDossierCapabilityClient({ invoke: async (contract: { actionId: string }, input: { kind?: string; metadataQuery?: string; currentOnly?: boolean; cursor?: string }, options: { workspaceId: string }) => {
    if (contract.actionId === 'research-checkpoints.status') return { ok: true, value: automaticStatus(1, false) }
    assert.equal(contract.actionId, 'artifact-versions.list-v2')
    calls.push({ workspace: options.workspaceId, input })
    if (input.kind === 'research-checkpoint') return { ok: true, value: { items: [] } }
    if (input.metadataQuery === 'denied') return { ok: false, issue: { code: 'access-restricted', message: 'query denied', retryable: false } }
    if (input.metadataQuery === 'empty') return { ok: true, value: { items: [] } }
    if (input.metadataQuery === 'older') return { ok: true, value: { items: [{ ...historyItem(61), isCurrent: false }], ...(!input.cursor ? { nextBeforeSequence: 139, nextCursor: 'owner-bound-cursor' } : {}) } }
    return { ok: true, value: { items: [historyItem(options.workspaceId === '/workspace/lab' ? 0 : 101)] } }
  } } as never)
  const mounted = await mountPanel(client)
  const search = async (query: string) => {
    const input = mounted.container.querySelector('input[type=search]') as HTMLInputElement
    assert.ok(input)
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(browserWindow.HTMLInputElement.prototype, 'value')!.set!; setter.call(input, query); input.dispatchEvent(new browserWindow.Event('input', { bubbles: true }) as unknown as Event); input.dispatchEvent(new browserWindow.Event('change', { bubbles: true }) as unknown as Event); await tick() })
    await settleReact()
  }
  try {
    assert.match(mounted.container.textContent!, /History 0/)
    await search('older')
    assert.equal(calls.at(-1)!.input.metadataQuery, 'older')
    assert.equal(calls.at(-1)!.input.currentOnly, false)
    assert.match(mounted.container.textContent!, /History 61/)
    await act(async () => { Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent === 'researchDossierContinueSearch')!.click(); await tick() }); await settleReact()
    assert.equal(calls.at(-1)!.input.cursor, 'owner-bound-cursor')
    assert.equal(mounted.container.querySelectorAll('ol > li').length, 1, 'repeated version is deduplicated')
    await search('denied'); assert.match(mounted.container.textContent!, /query denied/); assert.doesNotMatch(mounted.container.textContent!, /History 61/)
    await search('empty'); assert.match(mounted.container.textContent!, /researchDossierNoLoadedMatches/)
    await search(''); assert.match(mounted.container.textContent!, /History 0/)
    await mounted.rerender(session('other', 'codex', '/workspace/b'))
    assert.equal(calls.at(-1)!.input.metadataQuery, ''); assert.match(mounted.container.textContent!, /History 101/)
  } finally { await mounted.unmount() }
})


test('Dossier Evidence validates the complete ref and discards pending results on same-mounted scope changes', async () => {
  const pending = deferred<unknown>()
  let calls = 0
  const reference = historyItem(61).ref
  const value = (ref: typeof reference, marker: string) => ({ subject: { artifactVersionRef: ref }, source: 'evidence-dag', freshness: 'fresh', completeness: { complete: false, gapCodes: [marker] }, records: [] })
  const client = { queryEvidenceAudit: async () => ++calls === 1 ? pending.promise : value({ ...reference, byteLength: reference.byteLength + 1 }, 'WRONG_FULL_REF') } as never
  const mounted = await mountPanel({ listArtifactVersions: async () => ({ ok: true, value: { items: [] } }), readResearchRecordingStatus: async () => ({ ok: true, value: automaticStatus(1, false) }) } as never)
  const render = async (sessionId: string) => { await act(async () => mounted.root.render(<ResearchDossierEvidenceReview client={client} reference={reference} workspaceRoot="/workspace/lab" sessionId={sessionId} runtimeId="codex" />)) }
  const read = async () => { await act(async () => { (mounted.container.querySelector('button') as HTMLButtonElement).click(); await tick() }) }
  try {
    await render('first'); await read(); await render('second'); await read()
    assert.match(mounted.container.textContent!, /researchDossierEvidenceIdentityMismatch/)
    await act(async () => { pending.resolve(value(reference, 'LATE_OLD_SESSION')); await tick() })
    assert.doesNotMatch(mounted.container.textContent!, /LATE_OLD_SESSION|WRONG_FULL_REF/)
    assert.match(mounted.container.textContent!, /researchDossierEvidenceIdentityMismatch/)
  } finally { await mounted.unmount() }
})
