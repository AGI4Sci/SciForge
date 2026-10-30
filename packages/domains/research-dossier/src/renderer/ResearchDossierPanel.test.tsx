import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  createResearchDossierActivation,
  researchDossierActivationPayloadV1Schema
} from '../contract.js'
import {
  LegacyImportPanel,
  OverviewPage,
  ResearchRecordingCallout,
  ResearchDossierPanel,
  ReproductionPage,
  parseDossierActivation
} from './ResearchDossierPanel.js'
import { researchDossierMessages } from './research-dossier-messages.js'

const recordingCalloutDefaults = {
  action: null,
  notice: null,
  onStartRecording: () => undefined,
  onStopRecording: () => undefined,
  onOpenLegacyImport: () => undefined
} as const

test('shows an accessible stop control before the first turn and while recording is active', () => {
  const notStarted = renderToStaticMarkup(
    <ResearchRecordingCallout
      {...recordingCalloutDefaults}
      state={{ status: 'ready', recordingMode: 'automatic', automaticEnabled: true, policyRevision: 0, recording: null }}
    />
  )
  assert.match(notStarted, /researchDossierAutomaticWaiting/u)
  assert.match(notStarted, /researchDossierAutomaticWaitingHint/u)
  assert.match(notStarted, /data-research-recording-state="not-started"/u)
  assert.match(notStarted, /data-research-recording-mode="automatic"/u)
  assert.match(notStarted, /aria-label="researchDossierStopRecording"/u)
  assert.match(notStarted, /researchDossierStopRecording/u)
  assert.doesNotMatch(notStarted, /researchDossierStartRecording/u)

  const stoppingBeforeFirstTurn = renderToStaticMarkup(
    <ResearchRecordingCallout
      {...recordingCalloutDefaults}
      action="stop"
      state={{ status: 'ready', recordingMode: 'automatic', automaticEnabled: true, policyRevision: 0, recording: null }}
    />
  )
  assert.match(stoppingBeforeFirstTurn, /researchDossierStoppingRecording/u)
  assert.match(stoppingBeforeFirstTurn, /aria-busy="true"/u)
  assert.match(stoppingBeforeFirstTurn, /disabled=""/u)

  const active = renderToStaticMarkup(
    <ResearchRecordingCallout
      state={{
        status: 'ready',
        recordingMode: 'automatic',
        automaticEnabled: true,
        policyRevision: 1,
        recording: {
          recordingId: 'research-recording:test-1',
          origin: 'live',
          runtimeId: 'codex',
          threadId: 'thread-1',
          title: 'Recorded research',
          state: 'active',
          versionCount: 0,
          createdAt: '2026-08-11T00:00:00.000Z',
          updatedAt: '2026-08-11T00:00:00.000Z'
        }
      }}
      {...recordingCalloutDefaults}
    />
  )
  assert.match(active, /researchDossierRecordingStartedNoVersion/u)
  assert.match(active, /researchDossierRecordingNextTurnHint/u)
  assert.match(active, /aria-label="researchDossierStopRecording"/u)
  assert.match(active, /researchDossierStopRecording/u)
  assert.doesNotMatch(active, /researchDossierStartRecording/u)
  assert.match(active, /researchDossierLegacyImport/u)
  assert.match(active, /data-research-recording-state="active"/u)
  assert.match(active, /data-research-recording-automatic-enabled="true"/u)
})

test('keeps dossier chrome on SciForge theme tokens without a private palette or gradient', () => {
  const source = readFileSync(new URL('ResearchDossierPanel.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\b(?:bg|border|text)-(?:amber|blue|cyan|emerald|indigo|orange|pink|purple|red|rose|sky|teal|violet|yellow)-/u)
  assert.doesNotMatch(source, /(?:linear-gradient|radial-gradient|rgba?\(|hsla?\(|#[\da-f]{3,8})/iu)
  assert.match(source, /(?:\b(?:bg|border|text)-ds-|\b(?:bg|border|text)-accent|var\(--ds-)/u)
})

test('dossier recording controls call the owner capabilities and refresh canonical status', () => {
  const source = readFileSync(new URL('ResearchDossierPanel.tsx', import.meta.url), 'utf8')
  assert.match(source, /\.startResearchRecording\s*\(/u)
  assert.match(source, /\.stopResearchRecording\s*\(/u)
  assert.match(source, /await loadRecording\(false\)/u)
  assert.match(source, /\bonStartRecording\b|\bonStopRecording\b/u)
  assert.match(source, /automaticEnabled/u)
  assert.doesNotMatch(source, /Boolean\(recordingState\.recording\)/u)
  assert.match(source, /\.\.\.\(recording \? \{ recordingId: recording\.recordingId \} : \{\}\)/u)
  assert.match(source, /onOpenLegacyImport/u)
})

test('localizes persistent automatic opt-out and explicit recovery controls', () => {
  assert.match(researchDossierMessages.en.researchDossierAutomaticStopped, /stopped/iu)
  assert.match(researchDossierMessages.en.researchDossierAutomaticStoppedHint, /explicitly start/iu)
  assert.match(researchDossierMessages.en.researchDossierStartRecording, /start automatic recording/iu)
  assert.match(researchDossierMessages.en.researchDossierStopRecording, /stop automatic recording/iu)
  assert.match(researchDossierMessages.zh.researchDossierAutomaticStopped, /已停止/u)
  assert.match(researchDossierMessages.zh.researchDossierAutomaticStoppedHint, /明确重新开启/u)
  assert.match(researchDossierMessages.zh.researchDossierStartRecording, /开启自动记录/u)
  assert.match(researchDossierMessages.zh.researchDossierStopRecording, /停止自动记录/u)
})

test('keeps missing-domain and failed-start recording states explicit', () => {
  const unavailable = renderToStaticMarkup(
    <ResearchRecordingCallout
      {...recordingCalloutDefaults}
      state={{ status: 'unavailable', message: 'Research Checkpoints is disabled.' }}
    />
  )
  assert.match(unavailable, /researchDossierRecordingUnavailable/u)
  assert.match(unavailable, /Research Checkpoints is disabled/u)
  assert.doesNotMatch(unavailable, /researchDossierStartRecording/u)

})

test('stopped recording announces automatic next identity and legacy import stays explicitly incomplete', () => {
  const stopped = renderToStaticMarkup(
    <ResearchRecordingCallout
      state={{
        status: 'ready',
        recordingMode: 'automatic',
        automaticEnabled: true,
        policyRevision: 2,
        recording: {
          recordingId: 'research-recording:stopped',
          origin: 'live',
          runtimeId: 'codex',
          threadId: 'thread-1',
          title: 'Closed research',
          state: 'stopped',
          versionCount: 2,
          artifactId: 'artifact:checkpoint',
          currentVersionId: 'artifact-version:checkpoint-v2',
          currentContentDigest: 'a'.repeat(64),
          currentOrdinal: 2,
          createdAt: '2026-08-11T00:00:00.000Z',
          updatedAt: '2026-08-11T01:00:00.000Z',
          stoppedAt: '2026-08-11T01:00:00.000Z'
        }
      }}
      {...recordingCalloutDefaults}
    />
  )
  assert.match(stopped, /researchDossierAutomaticNext/u)
  assert.match(stopped, /researchDossierAutomaticNextHint/u)
  assert.match(stopped, /aria-label="researchDossierStopRecording"/u)
  assert.match(stopped, /researchDossierStopRecording/u)
  assert.doesNotMatch(stopped, /researchDossierStartRecording/u)

  const disabled = renderToStaticMarkup(
    <ResearchRecordingCallout
      {...recordingCalloutDefaults}
      action="start"
      notice={{ tone: 'error', message: 'Start failed.' }}
      state={{
        status: 'ready',
        recordingMode: 'automatic',
        automaticEnabled: false,
        policyRevision: 3,
        recording: {
          recordingId: 'research-recording:stopped',
          origin: 'live',
          runtimeId: 'codex',
          threadId: 'thread-1',
          title: 'Closed research',
          state: 'stopped',
          versionCount: 2,
          artifactId: 'artifact:checkpoint',
          currentVersionId: 'artifact-version:checkpoint-v2',
          currentContentDigest: 'a'.repeat(64),
          currentOrdinal: 2,
          createdAt: '2026-08-11T00:00:00.000Z',
          updatedAt: '2026-08-11T01:00:00.000Z',
          stoppedAt: '2026-08-11T01:00:00.000Z'
        }
      }}
    />
  )
  assert.match(disabled, /researchDossierAutomaticStopped/u)
  assert.match(disabled, /researchDossierAutomaticStoppedHint/u)
  assert.match(disabled, /aria-label="researchDossierStartRecording"/u)
  assert.match(disabled, /researchDossierStartingRecording/u)
  assert.match(disabled, /aria-busy="true"/u)
  assert.match(disabled, /role="alert"/u)
  assert.match(disabled, /Start failed\./u)
  assert.match(disabled, /data-research-recording-automatic-enabled="false"/u)
  assert.doesNotMatch(disabled, /researchDossierAutomaticNext(?:Hint)?/u)

  const disabledBeforeFirstRecord = renderToStaticMarkup(
    <ResearchRecordingCallout
      {...recordingCalloutDefaults}
      state={{
        status: 'ready',
        recordingMode: 'automatic',
        automaticEnabled: false,
        policyRevision: 4,
        recording: null
      }}
    />
  )
  assert.match(disabledBeforeFirstRecord, /researchDossierAutomaticStopped/u)
  assert.match(disabledBeforeFirstRecord, /aria-label="researchDossierStartRecording"/u)
  assert.match(disabledBeforeFirstRecord, /researchDossierStartRecording/u)
  assert.doesNotMatch(disabledBeforeFirstRecord, /researchDossierStopRecording/u)

  const importer = renderToStaticMarkup(
    <LegacyImportPanel
      state={{
        status: 'ready',
        preview: {
          runtimeId: 'codex',
          threadId: 'thread-1',
          turns: [{
            turnId: 'turn-1',
            status: 'completed',
            completedAt: '2026-08-11T00:00:00.000Z',
            summary: 'Question · Historical finding'
          }],
          selectedTurnIds: [],
          selectedTranscriptDigest: null
        }
      }}
      selectedTurnIds={['turn-1']}
      title="Imported study"
      busy={false}
      notice={null}
      onClose={() => undefined}
      onToggleTurn={() => undefined}
      onTitleChange={() => undefined}
      onImport={() => undefined}
    />
  )
  assert.match(importer, /data-legacy-import-state="ready"/u)
  assert.match(importer, /researchDossierLegacyIncomplete/u)
  assert.match(importer, /aria-pressed="true"/u)
  assert.match(importer, /Question · Historical finding/u)
  assert.doesNotMatch(importer, /latest/iu)
})

test('fails closed on malformed and host-private activation fields', () => {
  assert.equal(parseDossierActivation({
    contributionId: 'research-dossier.workbench-right-panel',
    revision: 1,
    payload: {
      contractVersion: 1,
      target: {
        kind: 'artifact-version',
        versionId: 'artifact-version:figure:1',
        workspaceRoot: '/wrong/workspace'
      },
      page: 'overview'
    }
  }).kind, 'invalid')
  assert.throws(() => researchDossierActivationPayloadV1Schema.parse({
    contractVersion: 1,
    target: { kind: 'artifact-version' },
    page: 'overview'
  }))
})

test('shows only target-applicable dossier pages before the exact owner load', () => {
  const activation = createResearchDossierActivation({
    kind: 'compute-run',
    runId: 'compute-run:plot-1'
  })
  const html = renderToStaticMarkup(
    <ResearchDossierPanel
      client={{} as never}
      session={{ id: 'session-1', workspaceRoot: '/workspace/lab' }}
      activation={activation}
      active
      onCollapse={() => undefined}
      surfaceId="surface-dossier-a"
    />
  )
  assert.match(html, /researchDossierOverview/u)
  assert.match(html, /researchDossierReproduction/u)
  assert.doesNotMatch(html, /researchDossierVersions/u)
})

test('preview round-trip remains integrity-bound to the exact activation', () => {
  const activation = createResearchDossierActivation({
    kind: 'artifact-version',
    versionId: 'artifact-version:figure:2'
  }, {
    page: 'versions',
    expectedDigest: `sha256:${'b'.repeat(64)}`,
    revision: 7
  })
  assert.deepEqual(activation.payload, {
    contractVersion: 1,
    target: {
      kind: 'artifact-version',
      versionId: 'artifact-version:figure:2'
    },
    page: 'versions',
    expectedDigest: `sha256:${'b'.repeat(64)}`
  })
})

test('renders an exact Research Checkpoint as a usable three-page dossier projection', () => {
  const contentDigest = 'd'.repeat(64)
  const checkpointRef = {
    artifactId: 'artifact:research', versionId: 'artifact-version:research:2',
    contentDigest, byteLength: 512,
    mediaType: 'application/vnd.sciforge.research-checkpoint+json',
    availability: 'available', retention: 'snapshot',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  }
  const checkpoint = {
    manifest: {
      contractVersion: 1, kind: 'sciforge.research-checkpoint-manifest.v1',
      recording: {
        recordingId: 'research-recording:study', origin: 'live', runtimeId: 'codex',
        threadId: 'thread-study', workspaceBindingDigest: 'a'.repeat(64)
      },
      turn: {
        turnId: 'turn-2', targetWatermark: '2:event', sequence: 2,
        occurredAt: '2026-08-11T02:00:00.000Z'
      },
      title: 'Study', changeReason: 'Added the sensitivity analysis.',
      narrative: { canonicalText: 'Sensitivity analysis preserved the primary finding.', contentDigest: 'b'.repeat(64) },
      sources: [{ sourceId: 'source:paper', uri: 'https://example.org/paper', title: 'Primary paper' }],
      declaredFiles: [{
        path: 'results/table.csv', role: 'output', capture: 'declared-exact',
        contentDigest: 'c'.repeat(64), byteLength: 10, mediaType: 'text/csv',
        artifactVersionRef: { ...checkpointRef, artifactId: `artifact:research-output:${'9'.repeat(64)}`, versionId: 'artifact-version:table:1', mediaType: 'text/csv', byteLength: 10 }
      }],
      artifactDependencies: [{
        role: 'output', label: 'Result table',
        ref: { ...checkpointRef, artifactId: `artifact:research-output:${'9'.repeat(64)}`, versionId: 'artifact-version:table:1', mediaType: 'text/csv', byteLength: 10 }
      }],
      computeRuns: [{ runId: 'compute-run:analysis', specRef: { ...checkpointRef, artifactId: 'artifact:spec', versionId: 'artifact-version:spec:1' } }],
      gitCheckpoints: [{ checkpointId: 'git-2', provider: 'git-checkpoints', revision: 'abc123' }],
      untrackedOperations: [{ kind: 'terminal', itemId: 'tool-1', summary: 'python scratch.py' }],
      breakpoints: [{ code: 'source-unpinned', blocking: true, message: 'The source is not pinned.' }],
      status: {
        execution: 'mixed', provenance: 'incomplete', control: 'partial',
        reproduction: 'not-run', evidence: 'pending'
      }
    },
    status: {
      state: 'committed', runtimeId: 'codex', threadId: 'thread-study', turnId: 'turn-2',
      recordingId: 'research-recording:study', operationId: `research-checkpoint-operation:${'1'.repeat(64)}`,
      changeReason: 'Added the sensitivity analysis.', attempts: 1,
      createdAt: '2026-08-11T02:00:00.000Z', updatedAt: '2026-08-11T02:00:01.000Z',
      changeKind: 'updated', title: 'Study', artifactRef: checkpointRef, ordinal: 2,
      inputs: [], outputs: ['results/table.csv'], reproduction: { status: 'not-run' },
      provenance: { status: 'incomplete' }, control: { status: 'partial' },
      untrackedOperationCount: 1, evidence: { status: 'stale' }
    }
  }
  const record = {
    kind: 'artifact-version',
    descriptor: {
      artifact: {
        artifactId: checkpointRef.artifactId, kind: 'research-checkpoint', label: 'Study',
        createdAt: '2026-08-11T01:00:00.000Z', updatedAt: '2026-08-11T02:00:00.000Z',
        currentVersionId: checkpointRef.versionId, versionCount: 2
      },
      version: {
        schemaVersion: 1, versionId: checkpointRef.versionId, artifactId: checkpointRef.artifactId,
        sequence: 2, transactionId: 'artifact-commit:2', createdAt: '2026-08-11T02:00:00.000Z',
        intent: 'save', storage: { mode: 'snapshot', contentDigest, byteLength: 512, mediaType: checkpointRef.mediaType },
        dependencies: [], accessPolicy: checkpointRef.accessPolicy, metadata: {}
      },
      ref: checkpointRef, artifactOrdinal: 2, isCurrent: true
    },
    history: { items: [] },
    checkpoint
  } as never

  const overview = renderToStaticMarkup(
    <OverviewPage record={record} canPreview={false} previewBusy={false} onPreview={() => undefined} />
  )
  assert.match(overview, /Sensitivity analysis preserved the primary finding/u)
  assert.match(overview, /Added the sensitivity analysis/u)
  assert.match(overview, /Primary paper/u)
  assert.match(overview, /mixed/u)
  assert.match(overview, /stale/u)
  assert.match(overview, /source-unpinned/u)
  assert.match(overview, /researchDossierTrustSummary/u)
  assert.match(overview, /researchDossierLimitations/u)
  assert.match(overview, /data-research-checkpoint-key-artifacts/u)
  assert.match(overview, /data-technical-details/u)

  const reproduction = renderToStaticMarkup(
    <ReproductionPage record={record} onOpenArtifact={() => undefined} />
  )
  assert.match(reproduction, /results\/table\.csv/u)
  assert.match(reproduction, /compute-run:analysis/u)
  assert.match(reproduction, /git-checkpoints/u)
  assert.match(reproduction, /abc123/u)
  assert.match(reproduction, /python scratch\.py/u)
  assert.match(reproduction, /researchDossierPreview/u)
  assert.doesNotMatch(reproduction, /No exact owner reference/u)
})

test('keeps researcher decisions visible while placing internal identities in collapsed technical details', () => {
  const source = readFileSync(new URL('ResearchDossierPanel.tsx', import.meta.url), 'utf8')
  assert.match(source, /researchDossierTrustSummary/u)
  assert.match(source, /researchDossierLimitations/u)
  assert.match(source, /researchDossierKeyArtifacts/u)
  assert.match(source, /<details[^>]*data-technical-details/u)
  assert.match(source, /exactRecordDigest\(record\)/u)
  assert.match(source, /ExactReferenceRows/u)
  assert.doesNotMatch(source, /return parsed\.value\.target\.kind[\s\S]{0,180}versionId/u)
})

test('overview surfaces owner issues that affect trust without exposing internal targets', () => {
  const record = {
    kind: 'compute-run',
    run: {
      runId: 'compute-run:test', outcome: 'succeeded', state: 'committed',
      provenance: 'complete', control: 'isolated-attested', replication: 'not-run', evidence: 'pending',
      breakpoints: [], outputs: [],
      updatedAt: '2026-08-11T00:00:00.000Z',
      specRef: { contentDigest: 'a'.repeat(64) }
    }
  } as never
  const html = renderToStaticMarkup(
    <OverviewPage
      record={record}
      issues={{ reproduction: 'Exact RunSpec is unavailable.' }}
      canPreview={false}
      previewBusy={false}
      onPreview={() => undefined}
    />
  )
  assert.match(html, /data-research-dossier-owner-issues/u)
  assert.match(html, /Exact RunSpec is unavailable/u)
})

test('plain research outputs do not invent unavailable trust axes', () => {
  const record = {
    kind: 'artifact-version',
    descriptor: {
      artifact: {
        artifactId: 'artifact:output', kind: 'research-output', label: 'summary.csv',
        createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
        currentVersionId: 'artifact-version:output:1', versionCount: 1
      },
      version: { versionId: 'artifact-version:output:1', createdAt: '2026-08-11T00:00:00.000Z', metadata: {} },
      ref: {
        artifactId: 'artifact:output', versionId: 'artifact-version:output:1',
        contentDigest: 'a'.repeat(64), byteLength: 20, mediaType: 'text/csv',
        availability: 'available', retention: 'snapshot',
        accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
      },
      artifactOrdinal: 1,
      isCurrent: true
    },
    history: { items: [] }
  } as never
  const html = renderToStaticMarkup(
    <OverviewPage record={record} canPreview={false} previewBusy={false} onPreview={() => undefined} />
  )
  assert.doesNotMatch(html, /researchDossierTrustSummary/u)
  assert.doesNotMatch(html, /researchDossierStatusUnavailableShort/u)
})

test('groups repeated provenance limitations and keeps raw diagnostics collapsed', () => {
  const record = {
    kind: 'compute-run',
    run: {
      runId: 'compute-run:test', outcome: 'succeeded', state: 'committed',
      provenance: 'incomplete', control: 'untracked', replication: 'not-run', evidence: 'pending',
      breakpoints: [
        { code: 'execution-untracked', blocking: true, message: 'command one' },
        { code: 'execution-untracked', blocking: true, message: 'command two' }
      ],
      outputs: [], updatedAt: '2026-08-11T00:00:00.000Z',
      specRef: { contentDigest: 'a'.repeat(64) }
    }
  } as never
  const html = renderToStaticMarkup(
    <OverviewPage record={record} canPreview={false} previewBusy={false} onPreview={() => undefined} />
  )
  assert.equal((html.match(/researchDossierLimitationUntracked/gu) ?? []).length, 1)
  assert.match(html, /researchDossierLimitationCount/u)
  assert.match(html, /<details[^>]*data-technical-details/u)
})

test('hides document namespaces and legacy ambient files from the researcher summary', () => {
  const ref = {
    artifactId: 'artifact:research', versionId: 'artifact-version:research:legacy',
    contentDigest: 'd'.repeat(64), byteLength: 512,
    mediaType: 'application/vnd.sciforge.research-checkpoint+json',
    availability: 'available', retention: 'snapshot',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  }
  const legacyRef = {
    ...ref, artifactId: 'artifact:legacy-random-uuid', versionId: 'artifact-version:legacy-system',
    mediaType: 'application/json'
  }
  const trustedRef = {
    ...ref, artifactId: `artifact:research-output:${'a'.repeat(64)}`,
    versionId: `artifact-version:research-output:${'b'.repeat(64)}`,
    mediaType: 'text/csv'
  }
  const checkpoint = {
    manifest: {
      contractVersion: 1, kind: 'sciforge.research-checkpoint-manifest.v1',
      recording: {
        recordingId: 'research-recording:legacy', origin: 'live', runtimeId: 'codex',
        threadId: 'thread-legacy', workspaceBindingDigest: 'c'.repeat(64)
      },
      turn: { turnId: 'turn-legacy', targetWatermark: '1:event', occurredAt: '2026-08-11T00:00:00.000Z' },
      title: 'Legacy study', changeReason: 'Added one table.',
      narrative: { canonicalText: 'The result table was updated.', contentDigest: 'e'.repeat(64) },
      sources: [
        { sourceId: 'source:svg', uri: 'http://www.w3.org/2000/svg' },
        { sourceId: 'source:paper', uri: 'https://example.org/paper', title: 'Study paper' }
      ],
      declaredFiles: [
        {
          path: '.codex-runtime/session.jsonl', role: 'modified', capture: 'host-turn-boundary-exact',
          contentDigest: 'f'.repeat(64), byteLength: 20, mediaType: 'application/json', artifactVersionRef: legacyRef
        },
        {
          path: 'outputs/summary.csv', role: 'output', capture: 'host-turn-boundary-exact',
          contentDigest: 'a'.repeat(64), byteLength: 20, mediaType: 'text/csv', artifactVersionRef: trustedRef
        }
      ],
      artifactDependencies: [
        { role: 'output', label: '.codex-runtime/session.jsonl', ref: legacyRef },
        { role: 'output', label: 'outputs/summary.csv', ref: trustedRef }
      ], computeRuns: [], gitCheckpoints: [], untrackedOperations: [],
      breakpoints: [
        { code: 'source-unpinned', blocking: true, message: 'SVG namespace is not pinned.', itemId: 'source:svg' }
      ],
      status: {
        execution: 'not-applicable', provenance: 'incomplete', control: 'untracked',
        reproduction: 'not-run', evidence: 'pending'
      }
    },
    status: {
      state: 'committed', runtimeId: 'codex', threadId: 'thread-legacy', turnId: 'turn-legacy',
      recordingId: 'research-recording:legacy', operationId: `research-checkpoint-operation:${'1'.repeat(64)}`,
      changeReason: 'Added one table.', attempts: 1,
      createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:01.000Z',
      changeKind: 'new', title: 'Legacy study', artifactRef: ref, ordinal: 1,
      inputs: [], outputs: ['outputs/summary.csv'], reproduction: { status: 'not-run' },
      provenance: { status: 'incomplete' }, control: { status: 'untracked' },
      untrackedOperationCount: 0, evidence: { status: 'pending' }
    }
  }
  const record = {
    kind: 'artifact-version',
    descriptor: {
      artifact: {
        artifactId: ref.artifactId, kind: 'research-checkpoint', label: 'Legacy study',
        createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:01.000Z',
        currentVersionId: ref.versionId, versionCount: 1
      },
      version: {
        schemaVersion: 1, versionId: ref.versionId, artifactId: ref.artifactId, sequence: 1,
        transactionId: 'artifact-commit:1', createdAt: '2026-08-11T00:00:00.000Z', intent: 'save',
        storage: { mode: 'snapshot', contentDigest: ref.contentDigest, byteLength: 512, mediaType: ref.mediaType },
        dependencies: [], accessPolicy: ref.accessPolicy, metadata: {}
      },
      ref, artifactOrdinal: 1, isCurrent: true
    },
    history: { items: [] }, checkpoint
  } as never

  const overview = renderToStaticMarkup(
    <OverviewPage record={record} canPreview={false} previewBusy={false} onPreview={() => undefined} />
  )
  assert.match(overview, /Study paper/u)
  assert.match(overview, /outputs\/summary\.csv/u)
  assert.doesNotMatch(overview, /source:svg|SVG namespace|\.codex-runtime/u)

  const reproduction = renderToStaticMarkup(<ReproductionPage record={record} />)
  const defaultText = reproduction.replace(/<details[\s\S]*?<\/details>/gu, '')
  assert.match(defaultText, /outputs\/summary\.csv/u)
  assert.doesNotMatch(defaultText, /\.codex-runtime/u)
  assert.match(reproduction, /data-research-checkpoint-technical-files/u)
  assert.match(reproduction, /\.codex-runtime/u)
})
