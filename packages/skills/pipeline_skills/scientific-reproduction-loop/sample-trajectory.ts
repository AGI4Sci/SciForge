import {
  SCIENTIFIC_REPRODUCTION_TRAJECTORY_SCHEMA_VERSION,
  type ScientificReproductionTrajectory,
} from './trajectory-contract';

export function buildSampleScientificReproductionTrajectory(): ScientificReproductionTrajectory {
  return {
    schemaVersion: SCIENTIFIC_REPRODUCTION_TRAJECTORY_SCHEMA_VERSION,
    attemptRef: 'attempt:scientific-reproduction:sample',
    runbookRef: 'docs/runbooks/sciforge-web-reproduction.md',
    workspaceRef: 'workspace:.sciforge',
    subject: {
      title: 'Generic paper reproduction attempt',
      topic: 'Reproduce or falsify the main claims using available data and explicit evidence refs.',
      scenarioId: 'literature-evidence-review',
      paperRefs: [
        {
          ref: 'artifact:paper-source:sample',
          kind: 'artifact',
          description: 'Paper PDF or structured source ref selected in the SciForge UI.',
        },
      ],
    },
    actors: [
      { id: 'operator.codex-worker-d', role: 'codex-worker' },
      { id: 'sciforge.web-ui', role: 'human-operator' },
      { id: 'local.vision-sense', role: 'computer-use-bridge' },
      { id: 'agentserver.backend', role: 'sciforge-backend' },
    ],
    steps: [
      {
        id: 'step-001-open',
        kind: 'open-app',
        timestamp: '2026-05-11T00:00:00.000Z',
        action: {
          modality: 'vision-sense',
          command: 'open http://127.0.0.1:5173/ and focus the SciForge window',
          target: 'SciForge web UI',
          screenBeforeRefs: [
            {
              ref: 'screen:before-open',
              captureKind: 'window-metadata',
              summary: 'Desktop state before the SciForge tab is focused.',
            },
          ],
          screenAfterRefs: [
            {
              ref: 'screen:sciforge-home',
              captureKind: 'screenshot',
              summary: 'SciForge home or current workspace state is visible.',
            },
          ],
          traceRefs: [{ ref: 'trace:vision-sense:open', kind: 'trace' }],
        },
        observation: {
          summary: 'The application is visible and ready for workspace selection.',
          toolResultRefs: [{ ref: 'workEvidence:vision-sense-computer-use:open', kind: 'execution-unit' }],
          artifactRefs: [{ ref: 'artifact:ui-session-state:open', kind: 'artifact' }],
        },
      },
      {
        id: 'step-002-prompt',
        kind: 'prompt',
        timestamp: '2026-05-11T00:01:00.000Z',
        prompt: {
          role: 'human-researcher',
          text: 'Read this paper ref and propose the smallest evidence-backed reproduction plan. Separate product failures from scientific negative results.',
          intent: 'Create a bounded reproduction plan from selected paper refs.',
          selectedRefs: [{ ref: 'artifact:paper-source:sample', kind: 'artifact' }],
        },
        action: {
          modality: 'keyboard',
          command: 'type prompt and submit',
          inputSummary: 'Human-like research prompt with selected paper ref.',
          screenBeforeRefs: [
            {
              ref: 'screen:prompt-editor-ready',
              captureKind: 'screenshot',
              summary: 'Prompt editor is focused with paper ref selected.',
            },
          ],
          screenAfterRefs: [
            {
              ref: 'screen:streaming-plan',
              captureKind: 'vision-summary',
              summary: 'SciForge is streaming a plan and artifact list.',
            },
          ],
          traceRefs: [{ ref: 'trace:vision-sense:prompt-submit', kind: 'trace' }],
        },
        observation: {
          summary: 'SciForge emitted an analysis plan artifact and explicit missing-evidence checks.',
          toolResultRefs: [{ ref: 'EU-agentserver-plan-sample', kind: 'execution-unit' }],
          artifactRefs: [
            { ref: 'artifact:analysis-plan:sample', kind: 'artifact' },
            { ref: 'artifact:dataset-inventory:sample', kind: 'artifact' },
          ],
        },
        rationale: {
          question: 'Why start with a plan instead of analysis code?',
          reason: 'The selected paper needs claim, data, and figure mapping before execution can be audited.',
          alternativesConsidered: ['Run code immediately', 'Summarize the paper only'],
          evidenceRefs: [{ ref: 'artifact:paper-source:sample', kind: 'artifact' }],
        },
      },
      {
        id: 'step-003-repair',
        kind: 'repair',
        timestamp: '2026-05-11T00:02:00.000Z',
        observation: {
          summary: 'A dataset accession could not be resolved through the current backend capability.',
          toolResultRefs: [{ ref: 'EU-dataset-lookup-failed-sample', kind: 'execution-unit' }],
          artifactRefs: [{ ref: 'artifact:missing-data-report:sample', kind: 'artifact' }],
          stderrRef: { ref: 'artifact:dataset-lookup-stderr:sample', kind: 'artifact' },
        },
        repair: {
          failureKind: 'blocked-missing-evidence',
          symptom: 'Dataset lookup returned no downloadable source.',
          diagnosis: 'The accession may be embargoed, renamed, or unavailable to the configured retrieval capability.',
          repairAction: 'Record missing-data report and ask for public alternatives or processed tables.',
          retestObservationRefs: [{ ref: 'artifact:missing-data-report:sample', kind: 'artifact' }],
          outcome: 'converted-to-negative-result',
        },
      },
      {
        id: 'step-004-self-prompt',
        kind: 'self-prompt-recommendation',
        timestamp: '2026-05-11T00:03:00.000Z',
        observation: {
          summary: 'Next round should inspect whether processed supplemental tables can support a partial verdict.',
          toolResultRefs: [],
          artifactRefs: [{ ref: 'artifact:analysis-plan:sample', kind: 'artifact' }],
        },
        selfPromptRecommendation: {
          nextPrompt: 'Using the missing-data report and analysis plan, identify the strongest partial reproduction that does not require unavailable raw data.',
          requiredRefs: [
            { ref: 'artifact:missing-data-report:sample', kind: 'artifact' },
            { ref: 'artifact:analysis-plan:sample', kind: 'artifact' },
          ],
          stopCondition: 'Stop if no evidence-bearing table, code, or public accession is available.',
          qualityGate: 'The next response must cite artifact refs and label product blockage separately from scientific failure.',
          mode: 'shadow-only',
        },
      },
    ],
    repairHistory: [
      {
        failureKind: 'blocked-missing-evidence',
        symptom: 'Dataset lookup returned no downloadable source.',
        diagnosis: 'The accession may be embargoed, renamed, or unavailable to the configured retrieval capability.',
        repairAction: 'Record missing-data report and ask for public alternatives or processed tables.',
        retestObservationRefs: [{ ref: 'artifact:missing-data-report:sample', kind: 'artifact' }],
        outcome: 'converted-to-negative-result',
      },
    ],
    selfPromptRecommendations: [
      {
        nextPrompt: 'Using the missing-data report and analysis plan, identify the strongest partial reproduction that does not require unavailable raw data.',
        requiredRefs: [{ ref: 'artifact:missing-data-report:sample', kind: 'artifact' }],
        stopCondition: 'Stop if no evidence-bearing table, code, or public accession is available.',
        qualityGate: 'The next response must cite artifact refs and label product blockage separately from scientific failure.',
        mode: 'shadow-only',
      },
    ],
    finalVerdict: 'in-progress',
    exportNotes: {
      redactionPolicy: 'Replace local absolute paths, secrets, and transient filenames with workspace refs before export.',
      replayInstructions: [
        'Open the runbookRef.',
        'Replay steps in timestamp order.',
        'Resolve every workspace ref through .sciforge workspace state or artifact storage.',
      ],
    },
  };
}
