import assert from 'node:assert/strict'
import test from 'node:test'

import type { DomainRendererHost } from '@sciforge/domain-sdk/host'

import type { ResearchCheckpointCommittedTurnStatusV1 } from '../contract.js'
import {
  RESEARCH_CHECKPOINTS_CHAT_RESULT_PANEL_CONTRIBUTION,
  RESEARCH_CHECKPOINTS_I18N_CONTRIBUTION
} from '../definition.js'
import {
  canOpenCommittedResearchCheckpoint,
  createDomainRendererEntry,
  openCommittedResearchCheckpoint
} from './index.js'

function committedStatus(): ResearchCheckpointCommittedTurnStatusV1 {
  return {
    state: 'committed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-2',
    recordingId: 'research-recording:test-1',
    operationId: `research-checkpoint-operation:${'a'.repeat(64)}`,
    changeReason: 'Updated the statistical definition.',
    attempts: 1,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:01:00.000Z',
    changeKind: 'updated',
    title: 'Treatment response',
    artifactRef: {
      artifactId: 'artifact:research-checkpoint:1',
      versionId: 'artifact-version:research-checkpoint:2',
      contentDigest: 'b'.repeat(64),
      byteLength: 2048,
      mediaType: 'application/json',
      availability: 'available',
      retention: 'snapshot',
      accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
    },
    ordinal: 2,
    inputs: ['data/treatment-response.csv'],
    outputs: ['figures/treatment-response.png'],
    outputArtifacts: [{
      path: 'figures/treatment-response.png',
      role: 'generated',
      capture: 'host-turn-boundary-exact',
      artifactOrdinal: 1,
      ref: {
        artifactId: 'artifact:figure:1',
        versionId: 'artifact-version:figure:1',
        contentDigest: 'c'.repeat(64),
        byteLength: 1024,
        mediaType: 'image/png',
        availability: 'available',
        retention: 'snapshot',
        accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
      }
    }],
    reproduction: { status: 'not-run' },
    provenance: { status: 'incomplete' },
    control: { status: 'untracked' },
    untrackedOperationCount: 1,
    evidence: { status: 'pending' }
  }
}

test('publishes the compact timeline entry and translations', () => {
  const host = {
    capabilityInvoker: {},
    workbench: { openRightPanel: () => undefined }
  } as unknown as DomainRendererHost
  const entry = createDomainRendererEntry(host)
  assert.deepEqual(entry.contributions.map(({ id }) => id), [
    RESEARCH_CHECKPOINTS_CHAT_RESULT_PANEL_CONTRIBUTION.id,
    RESEARCH_CHECKPOINTS_I18N_CONTRIBUTION.id
  ])
  assert.deepEqual(entry.contributions.map(({ kind }) => kind), [
    'renderer.chat-result-panel',
    'renderer.i18n-resource'
  ])
})

test('opens only the exact committed version and expected digest in Research Dossier', () => {
  const opened: unknown[] = []
  const host = {
    capabilityInvoker: {},
    workbench: {
      canOpenResource: (resourceKind: string) => resourceKind === 'artifact-version',
      openResource: (input: unknown) => {
        opened.push(input)
        return true
      }
    }
  } as unknown as DomainRendererHost

  assert.equal(openCommittedResearchCheckpoint(host, 'thread-1', committedStatus()), true)
  assert.deepEqual(opened, [{
    sessionId: 'thread-1',
    resource: {
      resourceKind: 'artifact-version',
      resourceId: 'artifact-version:research-checkpoint:2',
      integrity: {
        algorithm: 'sha256',
        expectedDigest: `sha256:${'b'.repeat(64)}`
      }
    }
  }])
})

test('does not expose exact navigation without an installed resource owner', () => {
  const host = {
    capabilityInvoker: {},
    workbench: {
      canOpenResource: () => false,
      openResource: () => false
    }
  } as unknown as DomainRendererHost

  assert.equal(canOpenCommittedResearchCheckpoint(host, 'thread-1'), false)
  assert.equal(openCommittedResearchCheckpoint(host, 'thread-1', committedStatus()), false)

  const entry = createDomainRendererEntry(host)
  const timeline = entry.contributions.find(
    ({ id }) => id === RESEARCH_CHECKPOINTS_CHAT_RESULT_PANEL_CONTRIBUTION.id
  )
  assert.ok(timeline && 'render' in timeline.value)
  const element = timeline.value.render({ sessionId: 'thread-1', blocks: [] }) as unknown as {
    props: { onOpenExact?: unknown }
  }
  assert.equal(element.props.onOpenExact, undefined)
})
