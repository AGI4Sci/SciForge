import { createDomainRendererEntry as createEvidenceRendererEntry, createResearchAuditCommand } from '@sciforge/domain-evidence-dag/renderer'
import type { DomainRendererWorkbenchGlobalOverlayValue } from '@sciforge/domain-sdk/renderer'
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
import { ResearchWorkspacePanel } from './ResearchWorkspacePanel.js'
import type { ArtifactVersionListV2 } from '@sciforge/domain-artifact-versions/contract'
import { localMaterialPath } from './LocalMaterialRegistration.js'

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
    React,
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
    ResizeObserver: browserWindow.ResizeObserver,
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
  overrides: Pick<ResearchDossierPanelProps, 'workbench' | 'researchSummaries' | 'workspacePreview'> = {}
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
  const kinds: string[] = []
  const listArtifactVersions = async (_workspace: string, input: { kind: string }): Promise<{ ok: true; value: { items: unknown[] } }> => {
    kinds.push(input.kind)
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
    assert.equal(loads.length, 3)
    assert.deepEqual(kinds.slice(-3), ['research-checkpoint', 'research-output', 'research-material'])
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
    assert.equal(loads.length, 3)
    assert.deepEqual(kinds.slice(-3), ['research-checkpoint', 'research-output', 'research-material'])
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
    assert.equal(kinds.length, 9, 'initial load, explicit refresh and workspace switch each read every kind once')
  } finally {
    await mounted.unmount()
  }
})


test('construct-then-publish resolves the workspace contribution and reads materials only on demand', async () => {
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
    const stageDeadline = Date.now() + 2_000
    while (!container.querySelector('[data-stage-owner]') && Date.now() < stageDeadline) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
    assert.equal(container.querySelector('[data-stage-owner]')?.getAttribute('data-stage-owner'), 'research-dossier.workbench-right-panel')
    assert.equal(reads, 0)
    assert.equal(provides, 0)
    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === '版本')!.click(); await tick() })
    await settleReact()
    assert.equal(container.querySelectorAll('[data-research-summary]').length, 1)
    assert.ok(reads > 0)
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
  const selected = () => container.querySelector('nav[aria-label="审计工作区"] button[aria-selected="true"]')?.textContent
  try {
    await render()
    assert.equal(selected(), '概览')
    await act(async () => { Array.from(container.querySelectorAll('button')).find(button => button.textContent === '版本')!.click() })
    await render()
    assert.equal(selected(), '版本', 'ordinary rerenders preserve the manual page')
    await render({ ...activation, payload: structuredClone(activation.payload) })
    assert.equal(selected(), '概览', 'a new navigation to the same exact target must be honored')
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
      if (input.kind && input.kind !== 'research-output') return { ok: true, value: { items: [] } }
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
    assert.equal(calls.length, 3)
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
    assert.match(mounted.container.textContent!, /researchDossierEvidenceUnknown.*researchDossierHistoryPartial/u)
    assert.ok(Array.from(mounted.container.querySelectorAll('details')).some(detail => !detail.open && detail.textContent?.includes('unknown')))
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


function comparisonFixture() {
  const selected = { ...historyItem(1), isCurrent: false }
  const current = historyItem(2)
  current.artifact.artifactId = selected.artifact.artifactId
  current.version.artifactId = selected.artifact.artifactId
  current.ref.artifactId = selected.artifact.artifactId
  // Reproduce the missing pointer shape at the renderer boundary; current is explicit in history.
  delete (selected.artifact as Partial<typeof selected.artifact>).currentVersionId
  return { selected, current }
}

for (const outcome of ['different', 'same', 'error', 'missing', 'wrong-from', 'wrong-to', 'wrong-to-digest'] as const) {
  test(`version comparison gives visible ${outcome} feedback and preserves exact targets`, async () => {
    const { selected, current } = comparisonFixture()
    if (outcome === 'missing') { selected.ref.accessPolicy.allowExport = false; selected.ref.availability = 'missing' }
    const calls: unknown[] = []
    const pending = deferred<Awaited<ReturnType<ResearchDossierCapabilityClient['compareArtifactVersions']>>>()
    const client = {
      listArtifactVersions: async () => ({ ok: true, value: { items: outcome === 'missing' ? [selected] : [selected, current] } }),
      describeArtifactVersion: async () => ({ ok: true, value: selected }),
      compareArtifactVersions: async (_workspace: string, input: unknown) => { calls.push(input); return pending.promise }
    } as unknown as ResearchDossierCapabilityClient
    const mounted = await mountPanel(client)
    const activation = createResearchDossierActivation({ kind: 'artifact-version', versionId: selected.ref.versionId }, { page: 'versions' })
    try {
      await act(async () => { mounted.root.render(<ResearchDossierPanel client={client} session={session('thread-policy', 'codex', '/workspace/lab')} active activation={activation} surfaceId="compare-test" onCollapse={() => undefined} />); await tick() })
      await settleReact()
      const button = Array.from(mounted.container.querySelectorAll('button')).find(button => button.textContent === 'researchDossierCompare')!
      assert.ok(button)
      assert.doesNotMatch(mounted.container.querySelector('[data-dossier-selected-version]')!.textContent!, /artifact-version:/)
      assert.equal(mounted.container.querySelector('details[data-technical-details][open]'), null)
      const more = mounted.container.querySelector<HTMLDetailsElement>('[data-dossier-more-actions]')!
      assert.equal(more.open, false)
      await act(async () => { more.querySelector('summary')!.click(); await tick() })
      assert.equal(more.open, true)
      assert.ok(Array.from(more.querySelectorAll('button')).some(button => button.textContent === 'researchDossierRestore'))
      if (outcome === 'missing') {
        for (const key of ['researchDossierRestore', 'researchDossierBundle']) {
          const disabled = Array.from(more.querySelectorAll('button')).find(button => button.textContent === key)!
          assert.equal(disabled.disabled, true)
          assert.ok(disabled.title)
          assert.ok(more.textContent?.includes(disabled.title))
        }
        assert.equal(button.disabled, true)
        assert.equal(button.title, 'researchDossierCompareTargetMissing')
        assert.match(mounted.container.textContent!, /researchDossierCompareTargetMissing/)
        button.click()
        assert.equal(calls.length, 0)
        return
      }
      await act(async () => { button.click(); await tick() })
      assert.deepEqual(calls, [{ fromVersionId: selected.ref.versionId, toVersionId: current.ref.versionId, textPreviewMaxBytes: 8192 }])
      assert.match(mounted.container.textContent!, /researchDossierComparing/)
      await act(async () => {
        pending.resolve(outcome === 'error' ? { ok: false, issue: { code: 'owner-unavailable', message: 'comparison owner failed', retryable: false } } as never : { ok: true, value: { from: outcome === 'wrong-from' ? { ...selected.ref, byteLength: selected.ref.byteLength + 1 } : selected.ref, to: outcome === 'wrong-to' ? selected.ref : outcome === 'wrong-to-digest' ? { ...current.ref, contentDigest: 'e'.repeat(64) } : current.ref, sameContent: outcome === 'same', metadataChanged: false, mediaTypeChanged: false, byteLengthDelta: 0, addedDependencies: [], removedDependencies: [] } } as never)
        await tick()
      })
      assert.match(mounted.container.textContent!, outcome === 'error' ? /comparison owner failed/ : outcome.startsWith('wrong-') ? /researchDossierCompareIdentityMismatch/ : outcome === 'same' ? /researchDossierSameContent/ : /researchDossierDifferentContent/)
      if (outcome.startsWith('wrong-')) assert.equal(mounted.container.querySelector('[data-artifact-version-comparison]'), null)
    } finally { await mounted.unmount() }
  })
}

for (const response of ['success', 'error'] as const) for (const change of ['target', 'workspace', 'session', 'runtime', 'client', 'activation', 'inactive', 'unmount'] as const) {
  test(`late comparison ${response} is discarded after ${change} changes`, async () => {
    const { selected, current } = comparisonFixture()
    const pending = deferred<Awaited<ReturnType<ResearchDossierCapabilityClient['compareArtifactVersions']>>>()
    const client = { listArtifactVersions: async () => ({ ok: true, value: { items: [selected, current] } }), describeArtifactVersion: async (_workspace: string, versionId: string) => ({ ok: true, value: versionId === current.ref.versionId ? current : selected }), compareArtifactVersions: () => pending.promise } as unknown as ResearchDossierCapabilityClient
    const mounted = await mountPanel(client)
    const activation = createResearchDossierActivation({ kind: 'artifact-version', versionId: selected.ref.versionId }, { page: 'versions' })
    const props: ResearchDossierPanelProps = { client, session: session('thread-policy', 'codex', '/workspace/lab'), active: true, activation, surfaceId: 'compare-fence', onCollapse: () => undefined }
    try {
      await act(async () => { mounted.root.render(<ResearchDossierPanel {...props} />); await tick() })
      await settleReact()
      await act(async () => { Array.from(mounted.container.querySelectorAll('button')).find(button => button.textContent === 'researchDossierCompare')!.click(); await tick() })
      const next = { ...props }
      if (change === 'target') next.activation = createResearchDossierActivation({ kind: 'artifact-version', versionId: current.ref.versionId }, { page: 'versions' })
      if (change === 'activation') next.activation = { ...activation }
      if (change === 'workspace') next.session = { ...props.session, workspaceRoot: '/other' }
      if (change === 'session') next.session = { ...props.session, id: 'other' }
      if (change === 'runtime') next.session = { ...props.session, runtimeId: 'other' }
      if (change === 'client') next.client = { ...client }
      if (change === 'inactive') next.active = false
      await act(async () => { mounted.root.render(change === 'unmount' ? null : <ResearchDossierPanel {...next} />); await tick() })
      await act(async () => { pending.resolve(response === 'error' ? { ok: false, issue: { code: 'owner-unavailable', message: 'late comparison failure', retryable: false } } as never : { ok: true, value: { from: selected.ref, to: current.ref, sameContent: true, addedDependencies: [], removedDependencies: [] } } as never); await tick() })
      assert.doesNotMatch(mounted.container.textContent!, /late comparison failure|researchDossierComparing/)
      assert.equal(mounted.container.querySelector('[data-artifact-version-comparison]'), null)
    } finally { await mounted.unmount() }
  })
}


// These tests mount the production workspace and dossier. The contribution is a
// public-contract probe: it records navigation without emulating a graph owner.
async function mountAuditWorkspace(client: ResearchDossierCapabilityClient, activation?: ResearchDossierPanelProps['activation']) {
  const container = document.createElement('div'); document.body.append(container)
  const { createRoot } = await import('react-dom/client'); const root = createRoot(container)
  const evidence: Array<{ active: boolean; activation: { payload: Record<string, unknown> } }> = []
  const researchViews = [{ id: 'fixture.workspace', kind: 'renderer.extension', packageName: '@fixture/workspace', owner: { moduleId: 'fixture.workspace' }, contract: { location: 'research.workspace' }, value: {
    render: (context: { active: boolean; activation: { payload: Record<string, unknown> } }) => { evidence.push(context); return <p data-evidence-probe>{context.activation.payload.view === 'graph' ? '图读取入口' : '实际研究摘要'}</p> }
  } }] as unknown as readonly DomainRendererContribution[]
  let current = activation
  const render = async (next = current) => {
    current = next
    await act(async () => { root.render(<ResearchWorkspacePanel client={client} session={session('thread-policy', 'codex', '/workspace/lab')} activation={next} active focused surfaceId="audit-test" onCollapse={() => undefined} researchViews={researchViews} />); await tick() })
    await settleReact()
  }
  const click = async (label: string) => {
    const target = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label)
    assert.ok(target, label); await act(async () => { target.click(); await tick() }); await settleReact()
  }
  await render()
  return { container, root, evidence, render, click, close: async () => { await act(async () => root.unmount()); container.remove() } }
}
function auditClient(items = [historyItem(1)], overrides: Partial<ResearchDossierCapabilityClient> = {}): ResearchDossierCapabilityClient {
  return { listArtifactVersions: async (_workspace: string, input: { kind?: string }) => ({ ok: true, value: { items: input.kind === 'research-checkpoint' ? [] : items } }),
    describeArtifactVersion: async (_workspace: string, versionId: string) => ({ ok: true, value: items.find(item => item.ref.versionId === versionId)! }),
    readResearchRecordingStatus: async () => ({ ok: true, value: automaticStatus(1, false) }), ...overrides } as ResearchDossierCapabilityClient
}

test('audit tabs form one keyboard tablist and pass the full selected material reference without writes', async () => {
  const item = historyItem(1), client = auditClient([item])
  const m = await mountAuditWorkspace(client, createResearchDossierActivation({ kind: 'artifact-version', versionId: item.ref.versionId }, { expectedDigest: `sha256:${item.ref.contentDigest}` }))
  try {
    assert.equal(m.container.querySelectorAll('[role=tablist]').length, 1)
    const tabs = [...m.container.querySelectorAll<HTMLButtonElement>('[role=tab]')]
    assert.deepEqual(tabs.map(tab => tab.textContent), ['概览', '证据图', '版本'])
    assert.equal(tabs.filter(tab => tab.tabIndex === 0).length, 1)
    await act(async () => { tabs[0].focus(); tabs[0].dispatchEvent(new browserWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }) as unknown as Event); await tick() })
    assert.equal(document.activeElement, tabs[1]); assert.equal(tabs[1].getAttribute('aria-selected'), 'true')
    assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, item.ref)
    assert.equal(m.evidence.at(-1)?.activation.payload.runtimeId, 'codex')
    await act(async () => { tabs[1].dispatchEvent(new browserWindow.KeyboardEvent('keydown', { key: 'End', bubbles: true }) as unknown as Event); await tick() })
    assert.equal(document.activeElement, tabs[2]); assert.equal(tabs[2].getAttribute('aria-selected'), 'true')
    assert.equal(m.container.querySelector('[data-dossier-selected-version]')?.getAttribute('data-dossier-selected-version'), item.ref.versionId)
    const readingPane = m.container.querySelector<HTMLElement>('[data-dossier-reading-pane]')!
    await act(async () => { readingPane.scrollTop = 133; readingPane.dispatchEvent(new Event('scroll', { bubbles: true })) })
    await m.click('概览'); assert.match(m.container.querySelector('header')!.textContent!, /History 1/)
    await m.click('版本'); assert.equal(readingPane.scrollTop, 133, 'each tab restores its reading position')
    assert.equal(m.container.querySelectorAll('[aria-label="researchTitle"]').length, 0, 'the dossier has no inner navigation')
  } finally { await m.close() }
})

test('audit version changes and back preserve exact historical context across tabs and ordinary rerenders', async () => {
  const old = { ...historyItem(1), isCurrent: false }, current = historyItem(2)
  current.artifact = { ...old.artifact, currentVersionId: current.ref.versionId }; current.version.artifactId = old.ref.artifactId; current.ref.artifactId = old.ref.artifactId
  const activation = createResearchDossierActivation({ kind: 'artifact-version', versionId: old.ref.versionId }, { page: 'versions' })
  const items = [old, current]
  const m = await mountAuditWorkspace(auditClient(items), activation)
  try {
    await m.click('证据图'); assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, old.ref)
    await m.render({ ...activation }); assert.equal(m.container.querySelector('[role=tab][aria-selected=true]')?.textContent, '证据图')
    await m.click('版本')
    const currentButton = [...m.container.querySelectorAll<HTMLButtonElement>('ol button')].find(button => button.textContent?.includes('researchDossierCurrent'))!
    assert.ok(currentButton)
    await act(async () => { currentButton.click(); await tick() }); await settleReact()
    await m.click('证据图'); assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, current.ref)
    await m.click('返回')
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
    assert.equal(document.activeElement, m.container.querySelector('[role=tab][aria-selected=true]'))
    const newer = historyItem(3); newer.ref.artifactId = old.ref.artifactId; newer.version.artifactId = old.ref.artifactId; newer.artifact = { ...old.artifact, currentVersionId: newer.ref.versionId }; items.push(newer)
    await m.click('刷新材料')
    assert.equal(m.container.querySelector('[data-dossier-selected-version]')?.getAttribute('data-dossier-selected-version'), old.ref.versionId, 'a newly discovered version does not replace the historical selection')
    await m.click('证据图')
    assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, old.ref)
    assert.match(m.container.querySelector('header')!.textContent!, /历史材料/)
  } finally { await m.close() }
})

test('audit partial material history stays readable and cannot silently turn an unavailable target into a current graph', async () => {
  const item = historyItem(1)
  const partial = auditClient([item], { listArtifactVersions: async () => ({ ok: false, issue: { code: 'access-restricted', message: 'history temporarily denied', retryable: false } }) })
  const m = await mountAuditWorkspace(partial, createResearchDossierActivation({ kind: 'artifact-version', versionId: item.ref.versionId }, { page: 'versions' }))
  try {
    assert.match(m.container.textContent!, /history temporarily denied/)
    await m.click('证据图'); assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, item.ref)
    await m.render(createResearchDossierActivation({ kind: 'artifact-version', versionId: item.ref.versionId }, { expectedDigest: `sha256:${'f'.repeat(64)}` }))
    await m.click('证据图'); assert.match(m.container.textContent!, /尚未取得此材料的精确引用/)
    assert.equal(m.container.querySelectorAll('[data-evidence-probe]').length, 0)
  } finally { await m.close() }
})

test('audit discards late exact loads, keeps empty materials honest, and does not infer a project version', async () => {
  const delayed = deferred<Awaited<ReturnType<ResearchDossierCapabilityClient['describeArtifactVersion']>>>()
  const first = historyItem(1), second = historyItem(2)
  const client = auditClient([first, second], { describeArtifactVersion: async (_workspace, id) => id === first.ref.versionId ? delayed.promise : { ok: true, value: second } })
  const m = await mountAuditWorkspace(client, createResearchDossierActivation({ kind: 'artifact-version', versionId: first.ref.versionId }))
  try {
    await m.render(createResearchDossierActivation({ kind: 'artifact-version', versionId: second.ref.versionId }))
    await act(async () => { delayed.resolve({ ok: true, value: first }); await tick() }); await settleReact()
    await m.click('证据图'); assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, second.ref)
    assert.match(m.container.querySelector('header')!.textContent!, /History 2/)
  } finally { await m.close() }
  const empty = await mountAuditWorkspace(auditClient([]))
  try { await empty.click('版本'); assert.match(empty.container.textContent!, /材料变化/); assert.equal(empty.container.querySelectorAll('ol > li').length, 0); assert.doesNotMatch(empty.container.textContent!, /项目版本|已通过/) }
  finally { await empty.close() }
})


test('an exact graph deep link keeps its snapshot and material when switching to overview and versions', async () => {
  const item = { ...historyItem(1), isCurrent: false }, snapshotDigest = `sha256:${'b'.repeat(64)}`
  const activation = { contributionId: 'research-dossier.workbench-right-panel', revision: 7, payload: { view: 'graph', runtimeId: 'codex', threadId: 'thread-policy', artifactVersionRef: item.ref, snapshotDigest } }
  const m = await mountAuditWorkspace(auditClient([item]), activation)
  try {
    assert.equal(m.container.querySelector('[role=tab][aria-selected=true]')?.textContent, '证据图')
    assert.equal(m.evidence.at(-1)?.activation.payload.snapshotDigest, snapshotDigest)
    await m.click('概览'); assert.match(m.container.querySelector('header')!.textContent!, /History 1.*历史材料/)
    await m.click('版本'); assert.equal(m.container.querySelector('[data-dossier-selected-version]')?.getAttribute('data-dossier-selected-version'), item.ref.versionId)
    await m.click('证据图'); assert.equal(m.evidence.at(-1)?.activation.payload.snapshotDigest, snapshotDigest)
    assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, item.ref)
  } finally { await m.close() }
})

test('ready previous material cannot be relabelled as a newly selected version while its read is pending', async () => {
  const first = historyItem(1), second = historyItem(2)
  const delayed = deferred<Awaited<ReturnType<ResearchDossierCapabilityClient['describeArtifactVersion']>>>()
  const client = auditClient([first, second], { describeArtifactVersion: async (_workspace, id) => id === second.ref.versionId ? delayed.promise : { ok: true, value: first } })
  const m = await mountAuditWorkspace(client, createResearchDossierActivation({ kind: 'artifact-version', versionId: first.ref.versionId }))
  try {
    await m.click('证据图'); assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, first.ref)
    await m.render(createResearchDossierActivation({ kind: 'artifact-version', versionId: second.ref.versionId }))
    await m.click('证据图')
    assert.match(m.container.textContent!, /尚未取得此材料的精确引用/)
    assert.equal(m.container.querySelectorAll('[data-evidence-probe]').length, 0)
    await act(async () => { delayed.resolve({ ok: true, value: second }); await tick() }); await settleReact()
    assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, second.ref)
  } finally { await m.close() }
})

test('changing material version from a pinned graph deep link clears the old snapshot and back restores it', async () => {
  const old = { ...historyItem(1), isCurrent: false }, current = historyItem(2)
  current.artifact = { ...old.artifact, currentVersionId: current.ref.versionId }
  current.version.artifactId = old.ref.artifactId; current.ref.artifactId = old.ref.artifactId
  const snapshotDigest = `sha256:${'b'.repeat(64)}`
  const activation = { contributionId: 'research-dossier.workbench-right-panel', revision: 9, payload: {
    view: 'graph', runtimeId: 'codex', threadId: 'historical-origin', artifactVersionRef: old.ref, snapshotDigest
  } }
  const m = await mountAuditWorkspace(auditClient([old, current]), activation)
  try {
    assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, old.ref)
    assert.equal(m.evidence.at(-1)?.activation.payload.snapshotDigest, snapshotDigest)
    assert.equal(m.evidence.at(-1)?.activation.payload.threadId, 'historical-origin')
    await m.click('版本')
    const next = [...m.container.querySelectorAll<HTMLButtonElement>('ol button')].find(button => button.textContent?.includes('researchDossierCurrent'))
    assert.ok(next)
    await act(async () => { next.click(); await tick() }); await settleReact()
    await m.click('证据图')
    assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, current.ref)
    assert.equal(m.evidence.at(-1)?.activation.payload.snapshotDigest, undefined, 'new material cannot inherit the old pinned graph')
    assert.notEqual(m.evidence.at(-1)?.activation.payload.threadId, 'historical-origin', 'old graph session must not overwrite the newly resolved target')
    await m.click('返回'); await m.click('证据图')
    assert.deepEqual(m.evidence.at(-1)?.activation.payload.artifactVersionRef, old.ref)
    assert.equal(m.evidence.at(-1)?.activation.payload.snapshotDigest, snapshotDigest)
    assert.equal(m.evidence.at(-1)?.activation.payload.threadId, 'historical-origin')
  } finally { await m.close() }
})


test('actual audit command opens the contributed global shell with three tabs and original scope', async () => {
  let published: readonly DomainRendererContribution[] = []
  const opens: Array<{activation: {revision:number;payload:unknown}}> = [], side: unknown[] = [], sessions: unknown[] = [], reads: Array<{action:string;input:unknown}> = []
  let closed = 0
  const host = { contributions:{list:(kind:string)=>published.filter(item=>item.kind===kind)},
    capabilityInvoker:{invoke:async(contract:{actionId:string;effect:string},input:unknown)=>{
      assert.equal(contract.effect,'read','opening and browsing global audit must not dispatch a write')
      reads.push({action:contract.actionId,input})
      if(contract.actionId==='evidence-dag.record.view') return {revision:1,node:null,ancestors:[],children:[],latestRecordPath:[],totalChildren:0,messages:[],paused:false,model:'',pending:0,failures:[],coverage:'visible-session-snapshots',lastScanAt:null}
      if(contract.actionId==='artifact-versions.list-v2') return {ok:true,value:{items:[]}}
      if(contract.actionId==='research-checkpoints.status') return {ok:true,value:automaticStatus(1,false)}
      if(contract.actionId==='evidence-dag.view') return {url:null,status:{committed:null,pending:null,updatedAt:'2026-11-10T00:00:00Z'},binding:{status:'missing',reason:'snapshot-unavailable'}}
      throw new Error('Unexpected test owner read: '+contract.actionId)
    }},workbench:{toggleGlobalOverlay:(input:unknown)=>opens.push(input as typeof opens[number]),openSession:async(input:unknown)=>{sessions.push(input);return true},openRightPanel:(input:unknown)=>side.push(input)}
  } as unknown as DomainRendererHost
  const evidence=createEvidenceRendererEntry(host),dossier=createDomainRendererEntry(host)
  published=[...evidence.contributions,...dossier.contributions] as unknown as readonly DomainRendererContribution[]
  const command=createResearchAuditCommand(host)
  await command.execute({sessionId:'audit-origin',runtimeId:'codex',workspaceRoot:'/science'})
  assert.equal(opens.length,1)
  const overlay=evidence.contributions.find(item=>item.kind==='renderer.workbench-global-overlay')!.value as DomainRendererWorkbenchGlobalOverlayValue<React.ReactElement>
  const container=document.createElement('div');document.body.append(container);const {createRoot}=await import('react-dom/client');const root=createRoot(container)
  const context={active:true,className:'h-full',session:{id:'other-active',runtimeId:'codex',workspaceRoot:'/other'},activation:opens[0].activation as never,onClose:()=>{closed++}}
  try {
    await act(async()=>root.render(<React.Suspense>{overlay.render(context)}</React.Suspense>));await settleReact()
    assert.deepEqual([...container.querySelectorAll('[role=tab]')].map(tab=>tab.textContent),['概览','证据图','版本'])
    assert.equal(container.querySelectorAll('[role=tablist]').length,1)
    // The production contribution lazy-loads EvidenceWorkspacePanel. Two event-loop
    // turns do not prove that the dynamic module and its effects have settled.
    const deadline = Date.now() + 2_000
    while (!reads.some(item => item.action === 'evidence-dag.record.view') && Date.now() < deadline) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
    assert.ok(reads.some(item => item.action === 'evidence-dag.record.view'), 'production audit owner read must settle within its test budget')
    const recordRead=reads.find(item=>item.action==='evidence-dag.record.view')!.input as {threadId:string;workspaceRoot:string}
    assert.equal(recordRead.threadId,'audit-origin');assert.equal(recordRead.workspaceRoot,'/science')
    await act(async()=>{[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='版本')!.click();await tick()});await settleReact()
    assert.match(container.textContent!,/材料变化/)
    await act(async()=>{[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='证据图')!.click();await tick()});await settleReact()
    assert.ok(reads.some(item=>item.action==='evidence-dag.view'));assert.equal(reads.some(item=>item.action==='evidence-dag.priority'),false,'global overlay cannot invent a pane id for priority')
    await act(async()=>{[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='返回侧面')!.click();await tick()})
    assert.equal(closed,1);assert.deepEqual(sessions,[{runtimeId:'codex',threadId:'audit-origin',focusComposer:false,readOnly:true}])
    const target=side[0] as {contributionId:string;sessionId:string;surfaceId?:string;activation:{payload:unknown}}
    assert.equal(target.contributionId,'research-dossier.workbench-right-panel');assert.equal(target.sessionId,'audit-origin');assert.equal(target.surfaceId,undefined)
    assert.deepEqual(target.activation.payload,{recordScope:{runtimeId:'codex',threadId:'audit-origin',workspaceRoot:'/science'}})
    await act(async()=>{[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='关闭')!.click()})
    assert.equal(closed,2)
  } finally {await act(async()=>root.unmount());container.remove()}
})

async function fillMaterialPath(container: HTMLElement, value: string): Promise<void> {
  const input = container.querySelector('input[name="material-path"]') as HTMLInputElement
  assert.ok(input)
  await act(async () => {
    Object.getOwnPropertyDescriptor(browserWindow.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new browserWindow.Event('input', { bubbles: true }) as unknown as Event)
    input.dispatchEvent(new browserWindow.Event('change', { bubbles: true }) as unknown as Event)
    await tick()
  })
}

async function submitMaterial(container: HTMLElement): Promise<void> {
  await act(async () => {
    container.querySelector('[data-local-material-registration] form')!.dispatchEvent(new browserWindow.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event)
    await tick()
  })
  await settleReact()
}

test('normal Dossier registers actual workspace material through observe and opens its exact saved CSV preview', async () => {
  const calls: Array<{ action: string; input: any; options: any }> = []
  const row = historyItem(1)
  row.artifact.kind = 'research-material'
  row.artifact.label = 'results.csv'
  row.version.metadata = { observedWorkspacePath: 'data/results.csv', materialRole: 'source', registrationSessionId: 'thread-policy', registrationRuntimeId: 'codex', provenanceStatus: 'observed-untracked' } as never
  let saved = false
  let navigation: ResearchDossierPanelProps['activation']
  let preview: unknown
  const workbench = { openRightPanel: (input: { activation?: ResearchDossierPanelProps['activation'] }) => { navigation = input.activation } } as never
  const workspacePreview = { open: (target: unknown) => { preview = target } }
  const client = createResearchDossierCapabilityClient({ invoke: async (contract: { actionId: string; inputSchema: { parse: (input: unknown) => unknown } }, input: any, options: any) => {
    contract.inputSchema.parse(input)
    calls.push({ action: contract.actionId, input, options })
    if (contract.actionId === 'research-checkpoints.status') return { ok: true, value: automaticStatus(1, false) }
    if (contract.actionId === 'artifact-versions.list-v2') return { ok: true, value: { items: saved && (!input.kind || input.kind === 'research-material') ? [row] : [] } }
    if (contract.actionId === 'artifact-versions.observe') { saved = true; return { ok: true, value: { transactionId: 'artifact-commit:material', committedAt: '2026-11-14T00:00:00Z', idempotentReplay: false, versions: [{ candidateId: 'local-material', ...row }], events: [] } } }
    if (contract.actionId === 'artifact-versions.describe-v2') return { ok: true, value: row }
    if (contract.actionId === 'artifact-versions.materialize') return { ok: true, value: { destinationPath: input.destinationPath, ref: row.ref } }
    throw new Error(`Unexpected capability: ${contract.actionId}`)
  } } as never)
  const mounted = await mountPanel(client, undefined, { workbench, workspacePreview })
  try {
    assert.ok(mounted.container.querySelector('[data-local-material-registration]'))
    await fillMaterialPath(mounted.container, 'data\\results.csv')
    await submitMaterial(mounted.container)
    const observed = calls.filter(call => call.action === 'artifact-versions.observe')
    assert.equal(observed.length, 1)
    assert.equal(observed[0]!.options.workspaceId, '/workspace/lab')
    assert.equal(observed[0]!.options.approval, undefined)
    assert.equal(observed[0]!.input.path, 'data/results.csv')
    assert.equal(observed[0]!.input.retention, 'snapshot')
    assert.equal(observed[0]!.input.expectedCurrentVersionId, null)
    assert.equal(observed[0]!.input.metadata.registrationSessionId, 'thread-policy')
    assert.equal(observed[0]!.input.metadata.provenanceStatus, 'observed-untracked')
    assert.equal(observed[0]!.input.metadata.runtimeId, undefined, 'registration is not an executed run')
    assert.equal(observed[0]!.input.dependencies, undefined, 'registration must not invent scientific edges')
    assert.equal(observed[0]!.input.contentDigest, undefined, 'the owner hashes actual file bytes')
    assert.match(mounted.container.textContent!, new RegExp(row.ref.contentDigest))
    assert.match(mounted.container.textContent!, /researchDossierMaterialBoundary/)
    assert.equal(mounted.container.querySelectorAll('ol > li').length, 1, 'new material appears in ordinary history')
    await act(async () => { [...mounted.container.querySelectorAll('button')].find(button => button.textContent === 'researchDossierMaterialOpen')!.click(); await tick() })
    assert.equal((navigation!.payload as any).target.versionId, row.ref.versionId)
    assert.equal((navigation!.payload as any).expectedDigest, `sha256:${row.ref.contentDigest}`)
    await act(async () => { mounted.root.render(<ResearchDossierPanel client={client} session={session('thread-policy', 'codex', '/workspace/lab')} active surfaceId="surface-dossier-a" onCollapse={() => undefined} workbench={workbench} workspacePreview={workspacePreview} activation={navigation} />); await tick() })
    await settleReact()
    assert.ok(mounted.container.querySelector('[data-local-material-details]'))
    await act(async () => { [...mounted.container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'researchDossierPreview')!.click(); await tick() })
    const materialized = calls.find(call => call.action === 'artifact-versions.materialize')!
    assert.equal(materialized.input.versionId, row.ref.versionId)
    assert.match(materialized.input.destinationPath, /\.csv$/)
    assert.equal((preview as any).integrity.expectedDigest, `sha256:${row.ref.contentDigest}`)
    assert.equal((preview as any).returnTo.activation.payload.target.versionId, row.ref.versionId)
  } finally { await mounted.unmount() }
})

test('material registration rejects path escapes, displays owner failures and discards late results after a workspace switch', async () => {
  for (const path of ['../secret', '/tmp/file', 'C:\\file', '\\\\server\\file', 'https://example.test/file', 'a/./file', 'a//file', '']) assert.equal(localMaterialPath(path), null, path)
  assert.equal(localMaterialPath('data\\review.csv'), 'data/review.csv')
  const pending = deferred<any>()
  let attempts = 0
  const client = {
    listArtifactVersions: async () => ({ ok: true, value: { items: [] } }),
    readResearchRecordingStatus: async () => ({ ok: true, value: automaticStatus(1, false) }),
    observeArtifactVersion: async () => { attempts++; return attempts === 1 ? { ok: false, issue: { code: 'artifact-not-found', message: 'actual file missing' } } : pending.promise }
  } as never
  const mounted = await mountPanel(client)
  try {
    await fillMaterialPath(mounted.container, '../escape.csv'); await submitMaterial(mounted.container)
    assert.equal(attempts, 0)
    assert.match(mounted.container.textContent!, /researchDossierMaterialPathInvalid/)
    await fillMaterialPath(mounted.container, 'data/results.csv'); await submitMaterial(mounted.container)
    assert.match(mounted.container.textContent!, /actual file missing/)
    assert.equal(mounted.container.querySelector('[data-registered-material-version]'), null)
    await submitMaterial(mounted.container)
    assert.equal(attempts, 2)
    await submitMaterial(mounted.container)
    assert.equal(attempts, 2, 'pending request cannot be duplicated')
    await mounted.rerender(session('thread-next', 'codex', '/workspace/other'))
    const row = historyItem(2)
    await act(async () => { pending.resolve({ ok: true, value: { versions: [{ candidateId: 'local-material', ...row }] } }); await tick() })
    assert.equal(mounted.container.querySelector('[data-registered-material-version]'), null)
    assert.equal((mounted.container.querySelector('input[name="material-path"]') as HTMLInputElement).value, '')
  } finally { await mounted.unmount() }
})
