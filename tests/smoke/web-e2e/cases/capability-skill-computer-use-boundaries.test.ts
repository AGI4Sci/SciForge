import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CAPABILITY_SKILL_COMPUTER_USE_BOUNDARIES_CASE_ID,
  assertCapabilitySkillComputerUseBoundariesCase,
  assertCodexNativeSkillPromotion,
  assertComputerUseEvidenceFolding,
  runCapabilitySkillComputerUseBoundariesCase,
  type CapabilityDiscoveryRound,
  type CapabilitySkillComputerUseBoundariesCaseResult,
  type ComputerUseEvidenceFold,
  type SkillPromotionProposal,
} from './capability-skill-computer-use-boundaries.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-r-cap-skill-cu-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('R-CAP-01/R-SKILL-01/R-CU-01 fixture covers capability, skill, and Computer Use boundaries', async () => {
  const result = await runCapabilitySkillComputerUseBoundariesCase({ baseDir });

  assert.equal(result.fixture.caseId, CAPABILITY_SKILL_COMPUTER_USE_BOUNDARIES_CASE_ID);
  assertCapabilitySkillComputerUseBoundariesCase(result);
  assert.deepEqual(result.capabilityRounds.map((round) => round.round), [1, 2, 3]);
  assert.deepEqual(
    result.skillPromotion.targets.map((target) => target.targetType).sort(),
    ['mcp', 'plugin', 'skill', 'slash-command'],
  );
  assert.equal(result.computerUseEvidenceFold.uiExecutedComputerUseActions, false);
});

test('R-CAP-01 fails focused verification if capability discovery becomes GUI ranking', async () => {
  const result = await runCapabilitySkillComputerUseBoundariesCase({ baseDir });
  const polluted = structuredClone(result) as CapabilitySkillComputerUseBoundariesCaseResult & {
    capabilityRounds: Array<CapabilityDiscoveryRound & { guiRanking?: unknown }>;
  };
  (polluted.capabilityRounds as unknown as Array<Record<string, unknown>>)[1] = {
    ...polluted.capabilityRounds[1]!,
    guiRanking: [{ route: 'web-research-provider', rankingScore: 0.98 }],
  };

  assert.throws(
    () => assertCapabilitySkillComputerUseBoundariesCase(polluted),
    /GUI ranking must be absent|guiRanking/,
  );
});

test('R-CAP-01 fails focused verification if discovery plan is treated as completion evidence', async () => {
  const result = await runCapabilitySkillComputerUseBoundariesCase({ baseDir });
  const polluted = structuredClone(result) as CapabilitySkillComputerUseBoundariesCaseResult & {
    capabilityRounds: Array<CapabilityDiscoveryRound & {
      discoveryPlanIsCompletionEvidence: boolean;
      completionEvidenceRef?: string;
    }>;
  };
  polluted.capabilityRounds[0] = { ...polluted.capabilityRounds[0]! };
  (polluted.capabilityRounds[0] as unknown as Record<string, unknown>).discoveryPlanIsCompletionEvidence = true;
  (polluted.capabilityRounds[0] as unknown as Record<string, unknown>).completionEvidenceRef = 'artifact:fake-completion-from-plan';

  assert.throws(
    () => assertCapabilitySkillComputerUseBoundariesCase(polluted),
    /discovery plan is not completion evidence|completionEvidenceRef/,
  );
});

test('R-SKILL-01 fails focused verification if promotion is not Codex-native or lacks gates', async () => {
  const result = await runCapabilitySkillComputerUseBoundariesCase({ baseDir });
  const polluted = structuredClone(result.skillPromotion) as SkillPromotionProposal;
  polluted.targets = polluted.targets.filter((target) => target.targetType !== 'mcp');
  polluted.targets[0] = {
    ...polluted.targets[0]!,
    safetyGates: [],
    installCallLocation: 'React browser button handler',
  };

  assert.throws(
    () => assertCodexNativeSkillPromotion(polluted),
    /skill\/plugin\/MCP\/slash-command|safety gates must be explicit|React\/UI-owned/,
  );
});

test('R-CU-01 fails focused verification if raw Computer Use refs become visible or UI executes actions', async () => {
  const result = await runCapabilitySkillComputerUseBoundariesCase({ baseDir });
  const pollutedFold = structuredClone(result.computerUseEvidenceFold) as ComputerUseEvidenceFold & {
    uiExecutedComputerUseActions: boolean;
    reactActionDispatch?: string;
  };
  (pollutedFold as unknown as Record<string, unknown>).uiExecutedComputerUseActions = true;
  (pollutedFold as unknown as Record<string, unknown>).reactActionDispatch = 'ReactComputerUseExecutor.executeComputerUseAction';

  const rawRef = pollutedFold.rawRefs[0]?.ref;
  assert.ok(rawRef, 'test fixture must include a raw CU ref');
  const pollutedBrowser = {
    ...result.browserVisibleState,
    visibleArtifactRefs: [...(result.browserVisibleState.visibleArtifactRefs ?? []), rawRef],
  };

  assert.throws(
    () => assertComputerUseEvidenceFolding(pollutedFold, pollutedBrowser),
    /React\/UI must not execute Computer Use actions|raw CU ref must not be visible artifact delivery/,
  );
});
