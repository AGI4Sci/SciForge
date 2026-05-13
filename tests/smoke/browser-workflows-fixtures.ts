import { buildBuiltInScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import { existsSync, readdirSync } from 'node:fs';

export function browserSmokeTimelineEvent() {
  const now = new Date().toISOString();
  return {
    id: 'timeline-browser-smoke-run',
    actor: 'Browser Smoke',
    action: 'run.failed',
    subject: 'browser-smoke-run · AgentServer offline recovery card',
    artifactRefs: [],
    executionUnitRefs: ['skill-plan.browser-smoke'],
    beliefRefs: [],
    branchId: 'literature-evidence-review',
    visibility: 'project-record',
    decisionStatus: 'not-a-decision',
    createdAt: now,
  };
}

export function structureWorkspaceState(workspacePath: string) {
  const now = new Date().toISOString();
  const structureSession = {
    schemaVersion: 2,
    sessionId: 'session-structure-browser-smoke',
    scenarioId: 'structure-exploration',
    title: 'Structure browser smoke',
    createdAt: now,
    messages: [],
    runs: [],
    uiManifest: [{ componentId: 'structure-viewer', title: 'Structure viewer', artifactRef: 'artifact-structure-browser-smoke', priority: 1 }],
    claims: [],
    executionUnits: [],
    artifacts: [{
      id: 'artifact-structure-browser-smoke',
      type: 'structure-summary',
      producerScenario: 'structure-exploration',
      schemaVersion: '1',
      metadata: { pdbId: 'browser-smoke', ligand: 'ATP', pocketLabel: 'Browser smoke pocket' },
      dataRef: `data:text/plain,${encodeURIComponent(browserSmokePdb())}`,
      data: {
        pdbId: 'browser-smoke',
        ligand: 'ATP',
        pocketLabel: 'Browser smoke pocket',
        atoms: [
          { atomName: 'N', residueName: 'GLY', chain: 'A', residueNumber: '1', element: 'N', x: -1.2, y: 0.1, z: 0.2 },
          { atomName: 'CA', residueName: 'GLY', chain: 'A', residueNumber: '1', element: 'C', x: 0.0, y: 0.3, z: 0.0 },
          { atomName: 'C', residueName: 'GLY', chain: 'A', residueNumber: '1', element: 'C', x: 1.2, y: 0.0, z: -0.2 },
          { atomName: 'O', residueName: 'GLY', chain: 'A', residueNumber: '1', element: 'O', x: 1.8, y: -0.8, z: 0.1 },
          { atomName: 'P', residueName: 'ATP', chain: 'B', residueNumber: '2', element: 'P', x: 0.2, y: 1.4, z: 0.6, hetatm: true },
        ],
      },
      visibility: 'public',
    }],
    notebook: [],
    versions: [],
    updatedAt: now,
  };
  return {
    schemaVersion: 2,
    workspacePath,
    sessionsByScenario: {
      'structure-exploration': structureSession,
    },
    archivedSessions: [],
    alignmentContracts: [],
    updatedAt: now,
  };
}

export function referenceWorkspaceState(workspacePath: string, referencePreviewPath: string) {
  const now = new Date().toISOString();
  const session = {
    schemaVersion: 2,
    sessionId: 'session-reference-browser-smoke',
    scenarioId: 'omics-differential-exploration',
    title: 'Reference follow-up browser smoke',
    createdAt: now,
    messages: [
      {
        id: 'msg-reference-seed-user',
        role: 'user',
        content: 'Seed a browser smoke run with message, chart, table, and file references.',
        createdAt: now,
        status: 'completed',
      },
      {
        id: 'msg-reference-seed-agent',
        role: 'scenario',
        content: 'Browser smoke reference seed message: inspect the UMAP, DE table, and markdown report before the follow-up.',
        createdAt: now,
        status: 'completed',
        objectReferences: [{
          id: 'object-reference-umap-seed',
          title: 'Browser smoke UMAP',
          kind: 'artifact',
          ref: 'artifact:browser-smoke-umap',
          artifactType: 'umap-plot',
          runId: 'run-reference-seed',
          preferredView: 'point-set-viewer',
          actions: ['focus-right-pane', 'compare'],
          status: 'available',
          summary: 'Chart reference used by browser smoke follow-up.',
        }, {
          id: 'object-reference-table-seed',
          title: 'Browser smoke DE table',
          kind: 'artifact',
          ref: 'artifact:browser-smoke-table',
          artifactType: 'differential-expression-table',
          runId: 'run-reference-seed',
          preferredView: 'record-table',
          actions: ['focus-right-pane', 'compare'],
          status: 'available',
          summary: 'Table reference used by browser smoke follow-up.',
        }, {
          id: 'object-reference-report-seed',
          title: 'Reference follow-up report',
          kind: 'file',
          ref: `file:${referencePreviewPath}`,
          artifactType: 'research-report',
          runId: 'run-reference-seed',
          preferredView: 'report-viewer',
          actions: ['focus-right-pane', 'copy-path'],
          status: 'available',
          summary: 'Real workspace markdown file used by browser smoke preview.',
          provenance: { path: referencePreviewPath },
        }],
      },
    ],
    runs: [{
      id: 'run-reference-seed',
      scenarioId: 'omics-differential-exploration',
      status: 'completed',
      prompt: 'Seed browser smoke reference run',
      response: 'Browser smoke reference seed message.',
      createdAt: now,
      completedAt: now,
      objectReferences: [{
        id: 'object-reference-report-seed',
        title: 'Reference follow-up report',
        kind: 'file',
        ref: `file:${referencePreviewPath}`,
        artifactType: 'research-report',
        runId: 'run-reference-seed',
        preferredView: 'report-viewer',
        actions: ['focus-right-pane', 'copy-path'],
        status: 'available',
        summary: 'Real workspace markdown file used by browser smoke preview.',
        provenance: { path: referencePreviewPath },
      }],
    }],
    uiManifest: [
      { componentId: 'point-set-viewer', title: 'Browser smoke UMAP', artifactRef: 'browser-smoke-umap', priority: 1 },
      { componentId: 'record-table', title: 'Browser smoke DE table', artifactRef: 'browser-smoke-table', priority: 2 },
    ],
    claims: [],
    executionUnits: [{
      id: 'eu-reference-browser-smoke',
      tool: 'workspace.reference-smoke',
      params: 'fixture=true',
      status: 'done',
      hash: 'reference-smoke',
      outputRef: '.sciforge/artifacts/reference-followup-report.md',
    }],
    artifacts: [{
      id: 'browser-smoke-umap',
      type: 'umap-plot',
      producerScenario: 'omics-differential-exploration',
      schemaVersion: '1',
      metadata: { title: 'Browser smoke UMAP', path: '.sciforge/artifacts/reference-umap.json' },
      data: {
        points: [
          { x: -1.2, y: 0.1, cluster: 'T cell', label: 'cell-a' },
          { x: -0.4, y: 0.8, cluster: 'T cell', label: 'cell-b' },
          { x: 0.7, y: -0.5, cluster: 'B cell', label: 'cell-c' },
          { x: 1.1, y: 0.4, cluster: 'B cell', label: 'cell-d' },
        ],
      },
      visibility: 'public',
    }, {
      id: 'browser-smoke-table',
      type: 'differential-expression-table',
      producerScenario: 'omics-differential-exploration',
      schemaVersion: '1',
      metadata: { title: 'Browser smoke DE table', path: '.sciforge/artifacts/reference-de-table.csv' },
      data: {
        rows: [
          { gene: 'IL7R', logFC: 1.7, pValue: 0.001, cluster: 'T cell' },
          { gene: 'MS4A1', logFC: 1.4, pValue: 0.003, cluster: 'B cell' },
          { gene: 'LYZ', logFC: -1.2, pValue: 0.011, cluster: 'Myeloid' },
        ],
      },
      visibility: 'public',
    }],
    notebook: [],
    versions: [],
    updatedAt: now,
  };
  return {
    schemaVersion: 2,
    workspacePath,
    sessionsByScenario: {
      'omics-differential-exploration': session,
    },
    archivedSessions: [],
    alignmentContracts: [],
    timelineEvents: [browserSmokeTimelineEvent()],
    updatedAt: now,
  };
}

export function browserSmokeReferenceToolResult(referencePreviewPath: string) {
  const now = new Date().toISOString();
  return {
    message: 'Reference follow-up accepted: preserved the selected message, chart, table, and file references.',
    confidence: 0.91,
    claimType: 'fact',
    evidenceLevel: 'database',
    reasoningTrace: 'Browser smoke mocked workspace tool response for deterministic UI reference coverage.',
    artifacts: [{
      id: 'browser-smoke-reference-followup-report',
      type: 'research-report',
      producerScenario: 'omics-differential-exploration',
      schemaVersion: '1',
      metadata: {
        title: 'Reference follow-up report',
        path: referencePreviewPath,
      },
      path: referencePreviewPath,
      dataRef: referencePreviewPath,
      data: {
        markdown: '# Browser smoke reference follow-up\n\nThis real workspace markdown file verifies inline preview after clicking the final object chip.',
      },
    }],
    objectReferences: [{
      id: 'object-reference-report-final',
      title: 'Reference follow-up report',
      kind: 'file',
      ref: `file:${referencePreviewPath}`,
      artifactType: 'research-report',
      preferredView: 'report-viewer',
      actions: ['focus-right-pane', 'copy-path'],
      status: 'available',
      summary: 'Clicking this final object chip should focus the right pane and preview the real workspace markdown file.',
      provenance: { path: referencePreviewPath },
    }],
    executionUnits: [{
      id: 'eu-reference-followup',
      tool: 'workspace.reference-smoke.followup',
      params: 'references=message,chart,table,file',
      status: 'done',
      hash: 'reference-followup',
      outputRef: '.sciforge/artifacts/reference-followup-report.md',
      time: now,
    }],
    claims: [{
      id: 'claim-reference-followup',
      text: 'The browser follow-up preserved selected message, chart, table, and file references.',
      type: 'fact',
      confidence: 0.91,
      evidenceLevel: 'database',
      supportingRefs: ['message:msg-reference-seed-agent', 'artifact:browser-smoke-umap', 'artifact:browser-smoke-table', 'file:.sciforge/artifacts/reference-followup-report.md'],
    }],
  };
}

export function cursorLikeWorklogResult() {
  const now = new Date().toISOString();
  return {
    message: [
      'Fixture result returned a concise user-facing answer.',
      '',
      '## Execution audit',
      '',
      'ExecutionUnit status and provenance are available for audit.',
      '',
      '```json',
      JSON.stringify({
        executionUnits: [{ id: 'eu-t097-recoverable', status: 'repair-needed', outputRef: '.sciforge/task-results/t097-running-work-process.json' }],
        recoverActions: ['rerun-current-scenario', 'inspect-artifact-schema'],
        auditRefs: ['agentserver://browser-smoke/t097'],
      }, null, 2),
      '```',
      '',
      '## Tool output',
      '',
      '```text',
      [
        'stdout: fixture command completed with partial evidence',
        'stderr: fixture warning preserved for recovery',
        'trace: raw tool payload kept out of the primary answer',
      ].join('\n'),
      '```',
    ].join('\n'),
    confidence: 0.88,
    claimType: 'fact',
    evidenceLevel: 'mock-browser',
    reasoningTrace: 'T097 browser fixture uses structured stream events and a partial-failure payload.',
    displayIntent: {
      primaryGoal: 'Show the partial result artifact and keep execution audit folded',
      requiredArtifactTypes: ['research-report'],
      preferredModules: ['report-viewer'],
      fallbackAcceptable: ['generic-artifact-inspector'],
      acceptanceCriteria: ['artifact visible', 'recover actions visible', 'raw audit folded'],
    },
    uiManifest: [{
      componentId: 'report-viewer',
      title: 'T097 fixture report',
      artifactRef: 'artifact-t097-report',
      priority: 1,
    }],
    executionUnits: [{
      id: 'eu-t097-recoverable',
      tool: 'workspace.generic-fixture',
      params: 'mode=t097-running-work-process',
      status: 'repair-needed',
      hash: 't097-running-work-process',
      outputRef: '.sciforge/task-results/t097-running-work-process.json',
      stdoutRef: '.sciforge/logs/t097.stdout.log',
      stderrRef: '.sciforge/logs/t097.stderr.log',
      failureReason: 'fixture recoverable diagnostic',
      recoverActions: ['rerun-current-scenario', 'inspect-artifact-schema'],
      nextStep: 'Retry after inspecting the artifact schema.',
      time: now,
    }],
    artifacts: [{
      id: 'artifact-t097-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      dataRef: '.sciforge/artifacts/t097-report.json',
      metadata: { title: 'T097 fixture report', status: 'partial', runId: 't097-running-work-process' },
      data: {
        markdown: '# T097 fixture report\n\nA partial artifact remains available while recovery actions are shown.',
      },
    }],
    claims: [],
  };
}

export function contextWindowToolStreamBody(round: number, ratio: number) {
  return [
    JSON.stringify({
      event: {
        type: 'contextWindowState',
        message: `browser smoke context ratio ${Math.round(ratio * 100)}%`,
        contextWindowState: browserSmokeContextWindowState(ratio, ratio >= 0.82 ? 'near-limit' : ratio >= 0.68 ? 'watch' : 'healthy'),
      },
    }),
    JSON.stringify({
      result: {
        message: `Context smoke response ${round}: context meter state stayed consistent for ratio ${Math.round(ratio * 100)}%.`,
        confidence: 0.9,
        claimType: 'fact',
        evidenceLevel: 'mock-browser',
        reasoningTrace: 'Browser smoke mocked context-window usage and compaction UX.',
        claims: [],
        uiManifest: [],
        executionUnits: [{
          id: `eu-context-window-${round}`,
          tool: 'workspace.context-window-smoke',
          params: `round=${round}`,
          status: 'done',
          hash: `context-window-${round}`,
        }],
        artifacts: [],
      },
    }),
    '',
  ].join('\n');
}

export function browserSmokeContextWindowState(ratio: number, status: 'healthy' | 'watch' | 'near-limit') {
  return {
    backend: 'codex',
    provider: 'codex',
    model: 'browser-smoke-context-model',
    usedTokens: Math.round(100_000 * ratio),
    input: Math.round(80_000 * ratio),
    output: Math.round(20_000 * ratio),
    windowTokens: 100_000,
    ratio,
    source: 'agentserver',
    status,
    compactCapability: 'agentserver',
    autoCompactThreshold: 0.82,
    watchThreshold: 0.68,
    nearLimitThreshold: 0.86,
    auditRefs: [`agentserver://browser-smoke/context/${status}`],
  };
}

export function browserSmokeWorkspaceState(workspacePath: string) {
  return {
    schemaVersion: 2,
    workspacePath,
    sessionsByScenario: {},
    archivedSessions: [],
    alignmentContracts: [],
    timelineEvents: [browserSmokeTimelineEvent()],
    updatedAt: new Date().toISOString(),
  };
}

export function failedRunRestoreWorkspaceState(workspacePath: string) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    workspacePath,
    sessionsByScenario: {
      'literature-evidence-review': {
        schemaVersion: 2,
        sessionId: 'session-failed-run-restore',
        scenarioId: 'literature-evidence-review',
        title: 'Failed run restore browser smoke',
        createdAt: now,
        messages: [{
          id: 'msg-failed-run-user',
          role: 'user',
          content: 'Restore directly to the failed literature run without using timeline search.',
          createdAt: now,
          status: 'completed',
        }, {
          id: 'msg-failed-run-system',
          role: 'system',
          content: 'The previous run stopped at a recoverable failure boundary.',
          createdAt: now,
          status: 'failed',
        }],
        runs: [{
          id: 'run-browser-failed-restore',
          scenarioId: 'literature-evidence-review',
          status: 'failed',
          prompt: 'Download papers and build the report',
          response: 'PDF retrieval partially failed after preserving downloaded full text and metadata refs.',
          createdAt: now,
          completedAt: now,
          raw: {
            failureReason: 'PDF retrieval partially failed after preserving downloaded full text and metadata refs.',
            recoverActions: ['inspect diagnostics without rerun', 'reuse downloaded full text and metadata refs', 'rerun failed PDF downloads only after explicit confirmation'],
            refs: [
              'file:.sciforge/task-results/failed-restore.bundle.json',
              'artifact:failed-restore-partial-report',
              'execution-unit:EU-failed-restore-fetch',
            ],
            resultPresentation: {
              conversationProjection: {
                schemaVersion: 'sciforge.conversation-projection.v1',
                conversationId: 'session-failed-run-restore',
                currentTurn: {
                  id: 'msg-failed-run-user',
                  prompt: 'Restore directly to the failed literature run without using timeline search.',
                },
                visibleAnswer: {
                  status: 'repair-needed',
                  diagnostic: 'PDF retrieval partially failed after preserving downloaded full text and metadata refs.',
                  artifactRefs: ['artifact:failed-restore-partial-report'],
                },
                activeRun: {
                  id: 'run-browser-failed-restore',
                  status: 'repair-needed',
                },
                artifacts: [{
                  ref: 'artifact:failed-restore-partial-report',
                  mime: 'research-report',
                  label: 'Failed restore partial report',
                }],
                executionProcess: [{
                  eventId: 'execution-unit:EU-failed-restore-fetch',
                  type: 'external-provider-blocked',
                  summary: 'PDF retrieval partially failed; durable partial report and refs were retained.',
                  timestamp: now,
                }],
                recoverActions: ['inspect diagnostics without rerun', 'reuse downloaded full text and metadata refs', 'rerun failed PDF downloads only after explicit confirmation'],
                verificationState: {
                  status: 'failed',
                  verifierRef: 'verification:failed-restore',
                  verdict: 'external-provider blocked partial PDF retrieval',
                },
                auditRefs: [
                  'file:.sciforge/task-results/failed-restore.bundle.json',
                  'artifact:failed-restore-partial-report',
                  'execution-unit:EU-failed-restore-fetch',
                  'verification:failed-restore',
                ],
                diagnostics: [{
                  severity: 'error',
                  code: 'external-provider.pdf-download.partial-failure',
                  message: 'PDF retrieval partially failed: one timeout, one HTTP 403, one file exceeded max download bytes.',
                  refs: [
                    { ref: 'file:.sciforge/task-results/pdfs/downloaded-paper.pdf' },
                    { ref: 'file:.sciforge/data/downloaded-paper.metadata.json' },
                    { ref: 'file:.sciforge/logs/failed-restore.stderr.log' },
                  ],
                }],
              },
              taskRunCard: {
                schemaVersion: 'sciforge.task-run-card.v1',
                id: 'task-card:failed-restore',
                goal: 'Download papers and build the report',
                status: 'needs-work',
                protocolStatus: 'protocol-failed',
                taskOutcome: 'needs-work',
                rounds: [],
                refs: [
                  { kind: 'bundle', ref: 'file:.sciforge/task-results/failed-restore.bundle.json' },
                  { kind: 'execution-unit', ref: 'execution-unit:EU-failed-restore-fetch' },
                  { kind: 'artifact', ref: 'artifact:failed-restore-partial-report', status: 'partial' },
                  { kind: 'file', ref: 'file:.sciforge/task-results/pdfs/downloaded-paper.pdf', label: 'downloaded full text' },
                  { kind: 'file', ref: 'file:.sciforge/data/downloaded-paper.metadata.json', label: 'metadata' },
                ],
                executionUnitRefs: ['execution-unit:EU-failed-restore-fetch'],
                verificationRefs: ['verification:failed-restore'],
                failureSignatures: [{
                  schemaVersion: 'sciforge.failure-signature.v1',
                  id: 'failure:browser-smoke-pdf-download-boundary',
                  kind: 'external-transient',
                  dedupeKey: 'external-transient:pdf-download-boundary',
                  layer: 'external-provider',
                  retryable: true,
                  message: 'PDF retrieval partially failed: one timeout, one HTTP 403, one file exceeded max download bytes.',
                  normalizedMessage: 'pdf retrieval partially failed one timeout one http 403 one file exceeded max download bytes',
                  operation: 'pdf-download',
                  refs: [
                    'file:.sciforge/task-results/pdfs/downloaded-paper.pdf',
                    'file:.sciforge/data/downloaded-paper.metadata.json',
                    'file:.sciforge/logs/failed-restore.stderr.log',
                  ],
                }],
                genericAttributionLayer: 'external-provider',
                nextStep: 'Open diagnostics and reuse retained refs first; rerun PDF downloads only after an explicit continue/retry request.',
                noHardcodeReview: {
                  status: 'pass',
                  checkedAt: now,
                  generalityStatement: 'Browser smoke fixture uses generic failed run refs and recovery actions.',
                  prohibitedMatches: [],
                },
                updatedAt: now,
              },
            },
          },
          objectReferences: [{
            id: 'object-failed-restore-run',
            title: 'Failed restore run',
            kind: 'run',
            ref: 'run:run-browser-failed-restore',
            runId: 'run-browser-failed-restore',
            status: 'available',
            summary: 'Recoverable failed run with durable refs.',
          }],
        }],
        uiManifest: [],
        claims: [],
        executionUnits: [{
          id: 'EU-failed-restore-fetch',
          tool: 'workspace.fetch-papers',
          params: 'limit=4',
          status: 'repair-needed',
          hash: 'failed-restore-fetch',
          outputRef: 'file:.sciforge/task-results/failed-restore.bundle.json',
          stdoutRef: 'file:.sciforge/logs/failed-restore.stdout.log',
          stderrRef: 'file:.sciforge/logs/failed-restore.stderr.log',
          failureReason: 'PDF retrieval partially failed: one timeout, one HTTP 403, one file exceeded max download bytes.',
          recoverActions: [
            'show diagnostics without automatically rerunning the historical literature task',
            'reuse downloaded full text and metadata refs for the next partial report',
            'rerun only the failed PDF downloads after explicit user confirmation',
          ],
          nextStep: 'Inspect failure boundary and retained refs; no restore-time rerun is allowed.',
          time: now,
        }],
        artifacts: [{
          id: 'failed-restore-partial-report',
          type: 'research-report',
          producerScenario: 'literature-evidence-review',
          schemaVersion: '1',
          metadata: { title: 'Failed restore partial report', status: 'partial', runId: 'run-browser-failed-restore' },
          data: {
            markdown: '# Failed restore partial report\n\nPartial refs remain available after refresh.',
          },
        }],
        notebook: [],
        versions: [],
        hiddenResultSlotIds: [],
        updatedAt: now,
      },
    },
    archivedSessions: [],
    alignmentContracts: [],
    timelineEvents: [browserSmokeTimelineEvent()],
    updatedAt: now,
  };
}

export function browserSmokeScenarioPackage() {
  const pkg = buildBuiltInScenarioPackage('biomedical-knowledge-graph', '2026-04-25T00:00:00.000Z');
  return {
    ...pkg,
    id: 'browser-smoke-imported-package',
    version: '1.0.0',
    status: 'draft',
    scenario: {
      ...pkg.scenario,
      id: 'browser-smoke-imported-package',
      title: 'Browser Smoke Imported Package',
      source: 'workspace',
    },
    versions: [{
      version: '1.0.0',
      status: 'draft',
      createdAt: '2026-04-25T00:00:00.000Z',
      summary: 'Browser smoke imported package fixture.',
      scenarioHash: 'browser-smoke',
    }],
  };
}

export function browserExecutablePath() {
  const candidates = [
    process.env.SCIFORGE_BROWSER_EXECUTABLE,
    ...playwrightChromiumCandidates(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('No Chromium-compatible browser found. Set SCIFORGE_BROWSER_EXECUTABLE to run browser smoke.');
}

function playwrightChromiumCandidates() {
  const home = process.env.HOME;
  if (!home) return [];
  const cacheDir = `${home}/Library/Caches/ms-playwright`;
  try {
    return readdirSync(cacheDir)
      .filter((entry) => /^chromium-\d+$/.test(entry))
      .sort()
      .reverse()
      .map((entry) => `${cacheDir}/${entry}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`);
  } catch {
    return [];
  }
}

function browserSmokePdb() {
  return [
    'ATOM      1 N    GLY A   1      -1.200   0.100   0.200  1.00 20.00           N',
    'ATOM      2 CA   GLY A   1       0.000   0.300   0.000  1.00 20.00           C',
    'ATOM      3 C    GLY A   1       1.200   0.000  -0.200  1.00 20.00           C',
    'ATOM      4 O    GLY A   1       1.800  -0.800   0.100  1.00 20.00           O',
    'HETATM    5 P    ATP B   2       0.200   1.400   0.600  1.00 20.00           P',
    'END',
  ].join('\n');
}
