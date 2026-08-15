import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type {
  ResearchCheckpointCommittedTurnStatusV1,
  ResearchCheckpointTurnStatusV1
} from '../contract.js'
import {
  ResearchCheckpointStatusCard,
  ResearchCheckpointTimelinePanel
} from './ResearchCheckpointTimelinePanel.js'
import {
  automaticPendingPollDelay,
  automaticUnrecordedPollDelay,
  shouldProbeUnrecordedCheckpoint
} from './research-checkpoint-timeline-polling.js'
import type { ResearchCheckpointsRendererClient } from './research-checkpoints-capability-client.js'

function operationBase() {
  return {
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-2',
    recordingId: 'research-recording:test-1',
    operationId: `research-checkpoint-operation:${'a'.repeat(64)}`,
    changeReason: 'Refined the statistical definition.',
    attempts: 2,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:01:00.000Z'
  } as const
}

function committed(): ResearchCheckpointCommittedTurnStatusV1 {
  const outputRef = {
    artifactId: 'artifact:figure:treatment-response',
    versionId: 'artifact-version:figure:treatment-response:2',
    contentDigest: 'c'.repeat(64),
    byteLength: 4096,
    mediaType: 'image/png',
    availability: 'available' as const,
    retention: 'snapshot' as const,
    accessPolicy: { visibility: 'workspace' as const, principals: [], allowExport: true }
  }
  return {
    ...operationBase(),
    state: 'committed',
    changeKind: 'updated',
    title: 'Treatment response analysis',
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
    outputs: ['figures/treatment-response.png', 'results/declared-only.csv'],
    outputArtifacts: [{
      path: 'figures/treatment-response.png',
      role: 'generated',
      capture: 'host-turn-boundary-exact',
      artifactOrdinal: 2,
      ref: outputRef
    }],
    reproduction: { status: 'not-run' },
    provenance: { status: 'incomplete' },
    control: { status: 'untracked' },
    untrackedOperationCount: 2,
    evidence: { status: 'pending' }
  }
}

test('does not flash a loading card before an unrecorded turn status is known', () => {
  const client = {
    readStatus: async () => ({
      ok: true as const,
      value: {
        recordingMode: 'automatic' as const,
        automaticEnabled: true,
        policyRevision: 0,
        recording: null
      }
    }),
    readTurnStatus: async () => ({
      ok: true as const,
      value: {
        state: 'unrecorded' as const,
        runtimeId: 'codex',
        threadId: 'thread-1',
        turnId: 'turn-1'
      }
    }),
  } satisfies Pick<
    ResearchCheckpointsRendererClient,
    'readStatus' | 'readTurnStatus'
  >
  const html = renderToStaticMarkup(
    <ResearchCheckpointTimelinePanel
      client={client}
      workspaceRoot="/workspace/lab"
      runtimeId="codex"
      threadId="thread-1"
      turnId="turn-1"
    />
  )
  assert.equal(html, '')
})

test('renders a neutral exact-Dossier entry without the research card, badge, outputs, or warnings', () => {
  const html = renderToStaticMarkup(
    <ResearchCheckpointStatusCard
      status={committed()}
      onOpenExact={() => undefined}
    />
  )
  assert.match(html, /data-research-checkpoint-state="committed"/u)
  assert.match(html, /data-research-checkpoint-version-id="artifact-version:research-checkpoint:2"/u)
  assert.match(html, /researchCheckpointOpenDossier/u)
  const visibleText = html.replace(/<[^>]+>/gu, '')
  assert.equal(visibleText, 'researchCheckpointOpenDossier')
  assert.doesNotMatch(visibleText, /Treatment response analysis|artifact|version|sha256|treatment-response|not run|incomplete|untracked|pending|image\/png/iu)
  assert.doesNotMatch(html, /title="[^"]*(?:artifact|version|sha256)/iu)
})

test('polls a committed checkpoint until late Evidence reaches a terminal status', () => {
  const lateEvidenceStatuses: ResearchCheckpointCommittedTurnStatusV1[] = [
    committed(),
    { ...committed(), evidence: { status: 'committed' } }
  ]
  let completedPolls = 0
  let readCount = 0
  let status = lateEvidenceStatuses[readCount]

  while (status) {
    readCount += 1
    const delay = automaticPendingPollDelay(status, completedPolls)
    if (delay === undefined) break
    completedPolls += 1
    status = lateEvidenceStatuses[readCount]
  }

  assert.equal(readCount, 2)
  assert.equal(completedPolls, 1)
  assert.equal(status?.evidence.status, 'committed')
  assert.equal(automaticPendingPollDelay(committed(), 8), undefined)
})

test('retries an initially unrecorded latest turn only after terminal completion in an active recording', () => {
  const unrecorded: ResearchCheckpointTurnStatusV1 = {
    state: 'unrecorded',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-2'
  }
  const active = {
    phase: 'active' as const,
    revision: 'turn-2-active',
    isLatest: true,
    status: 'running'
  }
  const completed = {
    phase: 'terminal' as const,
    revision: 'turn-2-completed',
    isLatest: true,
    status: 'completed'
  }

  assert.equal(shouldProbeUnrecordedCheckpoint(unrecorded, active, true), false)
  assert.equal(shouldProbeUnrecordedCheckpoint(unrecorded, completed, false), false)
  assert.equal(shouldProbeUnrecordedCheckpoint(unrecorded, completed, true), true)
  assert.equal(shouldProbeUnrecordedCheckpoint(unrecorded, { ...completed, isLatest: false }, true), false)
  assert.equal(automaticUnrecordedPollDelay(0), 250)
  assert.equal(automaticUnrecordedPollDelay(4), 1_500)
  assert.equal(automaticUnrecordedPollDelay(10), 5_000)
  assert.equal(automaticUnrecordedPollDelay(15), 5_000)
  assert.equal(automaticUnrecordedPollDelay(16), undefined)
  assert.equal(
    Array.from({ length: 16 }, (_, index) => automaticUnrecordedPollDelay(index) ?? 0)
      .reduce((total, delay) => total + delay, 0),
    52_500
  )
  assert.equal(shouldProbeUnrecordedCheckpoint(committed(), completed, true), false)
})

test('renders no chat UI for pending, stale conflict, or failed checkpoint states', () => {
  const statuses: ResearchCheckpointTurnStatusV1[] = [
    { ...operationBase(), state: 'pending' },
    { ...operationBase(), state: 'stale-conflict', error: 'Current version changed.', retryable: true },
    { ...operationBase(), state: 'failed', error: 'Artifact owner unavailable.', retryable: true }
  ]
  const html = statuses.map((status) => renderToStaticMarkup(
    <ResearchCheckpointStatusCard
      status={status as Exclude<ResearchCheckpointTurnStatusV1, { state: 'unrecorded' }>}
    />
  )).join('\n')
  assert.equal(html, '\n\n')
})

test('keeps the compact chat entry on neutral SciForge tokens only', () => {
  const source = readFileSync(new URL('ResearchCheckpointTimelinePanel.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\b(?:bg|border|text)-(?:amber|blue|cyan|emerald|indigo|orange|pink|purple|red|rose|sky|teal|violet|yellow)-/u)
  assert.doesNotMatch(source, /(?:linear-gradient|radial-gradient|rgba?\(|hsla?\(|#[\da-f]{3,8})/iu)
  assert.doesNotMatch(source, /(?:\b(?:bg|border|text)-(?:accent|ds-danger|ds-success)|var\(--ds-warning)/u)
  assert.match(source, /\b(?:bg|border|text)-ds-(?:card|border|hover|ink|muted|faint)/u)
  assert.doesNotMatch(source, /data-research-checkpoint-output-artifacts|data-exact-output-preview/u)
})
