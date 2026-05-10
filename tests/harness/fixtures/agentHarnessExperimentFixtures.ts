import type { HarnessInput } from '../../../packages/agent-harness/src/contracts';

export interface HarnessExperimentFixture {
  id: string;
  description: string;
  input: HarnessInput;
}

export const freshResearchFixture: HarnessExperimentFixture = {
  id: 'fresh-research',
  description: 'Fresh literature-style request with public refs and research candidates.',
  input: {
    requestId: 't124-fresh-research',
    intentMode: 'fresh',
    prompt: 'Compare two CRISPR screening papers and cite the stronger evidence.',
    contextRefs: ['paper:crispr-screen-a', 'paper:crispr-screen-b'],
    requiredContextRefs: ['paper:crispr-screen-a'],
    candidateCapabilities: [
      {
        kind: 'skill',
        id: 'literature.retrieval',
        manifestRef: 'capability:literature.retrieval@fixture',
        score: 0.91,
        reasons: ['fresh research request needs paper retrieval'],
        providerAvailability: [{ providerId: 'fixture-local', available: true }],
      },
      {
        kind: 'verifier',
        id: 'citation.verification',
        manifestRef: 'capability:citation.verification@fixture',
        score: 0.86,
        reasons: ['research answer must verify citation refs'],
      },
    ],
  },
};

export const repairAfterValidationFailureFixture: HarnessExperimentFixture = {
  id: 'repair-after-validation-failure',
  description: 'Repair turn seeded by payload validation failure metadata.',
  input: {
    requestId: 't124-repair-validation-failure',
    profileId: 'debug-repair',
    intentMode: 'repair',
    prompt: 'Repair the failed payload without repeating successful retrieval work.',
    contextRefs: ['attempt:previous-success', 'validation:missing-artifact-ref'],
    requiredContextRefs: ['validation:missing-artifact-ref'],
    conversationSignals: {
      validationFailure: {
        code: 'missing_required_artifact',
        field: 'artifacts[0].ref',
        previousAttemptRef: 'attempt:previous-success',
      },
    },
  },
};

export const fileGroundedSummaryFixture: HarnessExperimentFixture = {
  id: 'file-grounded-summary',
  description: 'File-grounded summarization that must stay inside provided workspace refs.',
  input: {
    requestId: 't124-file-grounded-summary',
    intentMode: 'file-grounded',
    prompt: 'Summarize the uploaded methods notes and list any missing experimental metadata.',
    contextRefs: ['file:methods-notes.md', 'artifact:sample-metadata-table'],
    requiredContextRefs: ['file:methods-notes.md'],
    candidateCapabilities: [
      {
        kind: 'skill',
        id: 'workspace.summary',
        manifestRef: 'capability:workspace.summary@fixture',
        score: 0.82,
        reasons: ['summary must be grounded in supplied workspace files'],
      },
      {
        kind: 'verifier',
        id: 'artifact.reference-check',
        manifestRef: 'capability:artifact.reference-check@fixture',
        score: 0.74,
        reasons: ['summary should preserve file and artifact refs'],
      },
    ],
  },
};

export const silentStreamCancelFixture: HarnessExperimentFixture = {
  id: 'silent-stream-cancel',
  description: 'Interactive run with stream silence and a user cancel signal.',
  input: {
    requestId: 't124-silent-stream-cancel',
    intentMode: 'interactive',
    prompt: 'Stop the stalled run and report the last durable state.',
    contextRefs: ['run:stalled-agent-42', 'trace:stream-heartbeats'],
    requiredContextRefs: ['run:stalled-agent-42'],
    conversationSignals: {
      streamSilence: {
        lastEventAgeMs: 65000,
        silenceTimeoutMs: 30000,
      },
      cancelRequested: {
        requestedBy: 'user',
        reason: 'stalled stream',
      },
    },
  },
};

export const capabilityBudgetExhaustionFixture: HarnessExperimentFixture = {
  id: 'capability-budget-exhaustion',
  description: 'Request with exhausted capability budget and a blocked private ref.',
  input: {
    requestId: 't124-capability-budget-exhaustion',
    prompt: 'Return a partial answer from already available references only.',
    contextRefs: ['ref:public-digest', 'ref:private-upload'],
    blockedContextRefs: ['ref:private-upload'],
    candidateCapabilities: [
      {
        kind: 'tool',
        id: 'web.search',
        manifestRef: 'capability:web.search@fixture',
        score: 0.7,
        reasons: ['would normally broaden evidence, but budget is exhausted'],
      },
      {
        kind: 'tool',
        id: 'local.reference-digest',
        manifestRef: 'capability:local.reference-digest@fixture',
        score: 0.66,
        reasons: ['uses existing refs only'],
      },
    ],
    budgetOverrides: {
      toolBudget: {
        maxWallMs: 120000,
        maxContextTokens: 8000,
        maxToolCalls: 0,
        maxObserveCalls: 2,
        maxActionSteps: 0,
        maxNetworkCalls: 0,
        maxProviders: 0,
        maxDownloadBytes: 0,
        maxResultItems: 20,
        maxRetries: 1,
        perProviderTimeoutMs: 30000,
        costUnits: 10,
        exhaustedPolicy: 'fail-with-reason',
      },
      contextBudget: {
        maxPromptTokens: 1200,
        maxHistoryTurns: 2,
        maxReferenceDigests: 1,
        maxFullTextRefs: 0,
      },
    },
  },
};

export const harnessExperimentFixtures = [
  freshResearchFixture,
  repairAfterValidationFailureFixture,
  fileGroundedSummaryFixture,
  silentStreamCancelFixture,
  capabilityBudgetExhaustionFixture,
] as const;
