import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildReleaseGateAudit,
  releaseGateAllowsSync,
} from '@sciforge-ui/runtime-contract/release-gate';
import { attachIntentFirstVerification } from '../../src/runtime/gateway/intent-first-verification.js';
import { applyRuntimeVerificationPolicy } from '../../src/runtime/gateway/verification-policy.js';
import type { GatewayRequest, ToolPayload } from '../../src/runtime/runtime-types.js';

const RELEASE_GATE_REQUIRED_COMMAND = 'npm run verify:full';
const RELEASE_GATE_POLICY = {
  requiredCommand: RELEASE_GATE_REQUIRED_COMMAND,
  syncActionSignals: ['git push'],
};

const readyAudit = buildReleaseGateAudit({
  policy: RELEASE_GATE_POLICY,
  changeSummary: 'Release gate blocks GitHub push until full verification evidence is present.',
  currentBranch: 'main',
  targetRemote: 'origin',
  targetBranch: 'main',
  auditRefs: ['audit:release-gate'],
  gitRefs: ['commit:abc123'],
  steps: [{
    kind: 'release-verify',
    status: 'passed',
    command: RELEASE_GATE_REQUIRED_COMMAND,
    evidenceRefs: ['run:verify-full'],
  }, {
    kind: 'service-restart',
    status: 'passed',
    evidenceRefs: ['service:workspace-writer', 'service:agentserver'],
  }],
});

assert.equal(readyAudit.syncAllowed, true);
assert.equal(releaseGateAllowsSync(readyAudit), true);

const blockedAudit = buildReleaseGateAudit({
  policy: RELEASE_GATE_POLICY,
  changeSummary: 'Summary exists, but full verification has not run.',
  currentBranch: 'main',
  targetRemote: 'origin',
  auditRefs: ['audit:release-gate'],
  steps: [{
    kind: 'service-restart',
    status: 'passed',
    evidenceRefs: ['service:agentserver'],
  }],
});

assert.equal(blockedAudit.syncAllowed, false);
assert.ok(blockedAudit.missing.includes(RELEASE_GATE_REQUIRED_COMMAND));

const intentPayload = attachIntentFirstVerification(basePayload({
  displayIntent: {
    releaseGate: {
      policy: RELEASE_GATE_POLICY,
      changeSummary: 'Summary exists, but full verification has not run.',
      currentBranch: 'main',
      targetRemote: 'origin',
      auditRefs: ['audit:release-gate'],
      steps: [{
        kind: 'service-restart',
        status: 'passed',
        evidenceRefs: ['service:agentserver'],
      }],
    },
  },
}), baseRequest({
  prompt: 'git push after npm run verify:full.',
  uiState: {
    sessionId: 'session-release-gate',
    sessionCreatedAt: '2026-05-13T00:00:00.000Z',
    releaseGatePolicy: RELEASE_GATE_POLICY,
  },
}), { runWorkVerify: true });

const intentEnvelope = intentPayload.displayIntent?.intentFirstVerification as {
  routing?: { mode?: string; blockingPolicy?: string };
  jobs?: Array<{ command?: string; status?: string; releaseGate?: { syncAllowed?: boolean } }>;
  verdicts?: Array<{ verdict?: string }>;
} | undefined;

assert.equal(intentEnvelope?.routing?.mode, 'release');
assert.equal(intentEnvelope?.routing?.blockingPolicy, 'release');
assert.equal(intentEnvelope?.jobs?.[0]?.command, RELEASE_GATE_REQUIRED_COMMAND);
assert.equal(intentEnvelope?.jobs?.[0]?.releaseGate?.syncAllowed, false);
assert.equal(intentEnvelope?.verdicts?.[0]?.verdict, 'pending');

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-release-gate-'));
try {
  const blocked = await applyRuntimeVerificationPolicy(basePayload({
    displayIntent: {
      releaseGate: {
        policy: RELEASE_GATE_POLICY,
        changeSummary: 'Summary exists, but full verification has not run.',
        currentBranch: 'main',
        targetRemote: 'origin',
        auditRefs: ['audit:release-gate'],
        steps: [{
          kind: 'service-restart',
          status: 'passed',
          evidenceRefs: ['service:agentserver'],
        }],
      },
    },
    executionUnits: [{
      id: 'push-blocked',
      tool: 'git',
      command: 'git push origin main',
      status: 'done',
      outputRef: '.sciforge/task-results/release-push-blocked.json',
    }],
  }), baseRequest({ workspacePath: workspace, prompt: '等完整验证通过再推 GitHub。' }));

  assert.equal(blocked.verificationResults?.[0]?.verdict, 'needs-human');
  assert.equal(blocked.executionUnits[0]?.status, 'needs-human');
  assert.match(blocked.verificationResults?.[0]?.critique ?? '', /Do not complete/);

  const allowed = await applyRuntimeVerificationPolicy(basePayload({
    displayIntent: {
      releaseGate: {
        policy: RELEASE_GATE_POLICY,
        changeSummary: 'Release gate blocks GitHub push until full verification evidence is present.',
        currentBranch: 'main',
        targetRemote: 'origin',
        targetBranch: 'main',
        auditRefs: ['audit:release-gate'],
        gitRefs: ['commit:abc123'],
        steps: [{
          kind: 'release-verify',
          status: 'passed',
          command: RELEASE_GATE_REQUIRED_COMMAND,
          evidenceRefs: ['run:verify-full'],
        }, {
          kind: 'service-restart',
          status: 'passed',
          evidenceRefs: ['service:workspace-writer', 'service:agentserver'],
        }],
      },
    },
    executionUnits: [{
      id: 'push-allowed',
      tool: 'git',
      command: 'git push origin main',
      status: 'done',
      outputRef: '.sciforge/task-results/release-push-allowed.json',
    }],
  }), baseRequest({ workspacePath: workspace, prompt: '等完整验证通过再推 GitHub。' }));

  assert.equal(allowed.verificationResults?.[0]?.verdict, 'pass');
  assert.equal(allowed.executionUnits[0]?.status, 'done');
  const allowedVerification = allowed.displayIntent?.verification as { verdict?: string } | undefined;
assert.equal(allowedVerification?.verdict, 'pass');

const customPolicy = {
  requiredCommand: 'python -m verifier.release --strict',
  syncActionLabel: 'artifact publish',
  syncActionSignals: ['publish artifact bundle'],
  requiredStepKinds: ['release-verify', 'audit-record'] as const,
};
const customPolicyPayload = attachIntentFirstVerification(basePayload({
  displayIntent: {
    releaseGate: {
      auditRefs: ['audit:artifact-publish'],
      steps: [{
        kind: 'release-verify',
        status: 'passed',
        command: customPolicy.requiredCommand,
        evidenceRefs: ['verification:artifact-publish'],
      }],
    },
  },
  executionUnits: [{
    id: 'publish-custom',
    tool: 'artifact-publisher',
    command: 'publish artifact bundle',
    status: 'done',
  }],
}), baseRequest({
  prompt: 'publish artifact bundle after python -m verifier.release --strict.',
  uiState: {
    sessionId: 'session-release-gate-custom',
    sessionCreatedAt: '2026-05-13T00:00:00.000Z',
    releaseGatePolicy: customPolicy,
  },
}), { runWorkVerify: true });
const customIntentEnvelope = customPolicyPayload.displayIntent?.intentFirstVerification as {
  jobs?: Array<{ command?: string; releaseGate?: { status?: string; syncAllowed?: boolean; policy?: { syncActionLabel?: string } } }>;
  verdicts?: Array<{ verdict?: string }>;
} | undefined;
assert.equal(customIntentEnvelope?.jobs?.[0]?.command, customPolicy.requiredCommand);
assert.equal(customIntentEnvelope?.jobs?.[0]?.releaseGate?.policy?.syncActionLabel, customPolicy.syncActionLabel);
assert.equal(customIntentEnvelope?.jobs?.[0]?.releaseGate?.syncAllowed, true);
assert.equal(customIntentEnvelope?.verdicts?.[0]?.verdict, 'passed');
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log('[ok] release gate requires configured verification, service health, summary, git refs, and audit refs before external sync');

function baseRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    skillDomain: 'knowledge',
    prompt: 'Summarize the current result.',
    workspacePath: process.cwd(),
    artifacts: [],
    uiState: {
      sessionId: 'session-release-gate',
      sessionCreatedAt: '2026-05-13T00:00:00.000Z',
    },
    ...overrides,
  };
}

function basePayload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    message: 'Completed the requested work.',
    confidence: 0.9,
    claimType: 'execution',
    evidenceLevel: 'runtime',
    reasoningTrace: 'release gate smoke',
    claims: [],
    uiManifest: [],
    executionUnits: [],
    artifacts: [],
    ...overrides,
  };
}
