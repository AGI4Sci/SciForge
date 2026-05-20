import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import type { RuntimeExecutionUnit } from '@sciforge-ui/runtime-contract';
import type { ConversationProjection } from '../../../../src/runtime/conversation-kernel/index.js';
import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  verifyWebE2eContract,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import type { JsonRecord, WebE2eFixtureWorkspace } from '../types.js';

export const CAPABILITY_SKILL_COMPUTER_USE_BOUNDARIES_CASE_ID = 'SA-WEB-36';

export type CapabilityRoute = 'workspace-ref-reader' | 'web-research-provider' | 'desktop-perception-bridge';
export type CodexNativePromotionTarget = 'skill' | 'plugin' | 'mcp' | 'slash-command';
export type ComputerUseRawEvidenceKind = 'screenshot' | 'desktop-log';

export interface CapabilityDiscoveryRound {
  round: 1 | 2 | 3;
  userIntent: string;
  tuiPlanningRef: string;
  chosenRoute: CapabilityRoute;
  alternatives: CapabilityRoute[];
  reason: string;
  discoveryPlanIsCompletionEvidence: false;
  guiRanking?: never;
  completionEvidenceRef?: never;
}

export interface SkillPromotionProposalTarget {
  targetType: CodexNativePromotionTarget;
  name: string;
  scope: string[];
  safetyGates: string[];
  validationCommands: string[];
  installCallLocation: string;
}

export interface SkillPromotionProposal {
  artifactRef: string;
  workspaceProposalRef: string;
  stagingOnly: true;
  targets: SkillPromotionProposalTarget[];
}

export interface ComputerUseRawEvidenceRef {
  kind: ComputerUseRawEvidenceKind;
  ref: string;
  auditOnly: true;
  foldedIntoRef: string;
}

export interface ComputerUseEvidenceFold {
  task: string;
  perceptionSummary: string;
  actionSummary: string;
  foldedEvidenceRef: string;
  rawRefs: ComputerUseRawEvidenceRef[];
  uiExecutedComputerUseActions: false;
  reactActionDispatch?: never;
}

export interface CapabilitySkillComputerUseBoundariesCaseResult {
  fixture: WebE2eFixtureWorkspace;
  capabilityRounds: CapabilityDiscoveryRound[];
  skillPromotion: SkillPromotionProposal;
  computerUseEvidenceFold: ComputerUseEvidenceFold;
  browserVisibleState: WebE2eBrowserVisibleState;
  verifierInput: WebE2eContractVerifierInput;
}

const now = '2026-05-20T00:00:00.000Z';
const sessionId = 'session-sa-web-r-cap-skill-cu';
const scenarioId = 'scenario-sa-web-r-cap-skill-cu';
const runId = 'run-sa-web-r-cap-skill-cu-current';
const visibleAnswerText = [
  'Capability, skill promotion, and Computer Use boundary fixture completed.',
  'Capability discovery remained a TUI-native progressive plan with alternatives and a route change, not GUI ranking or completion evidence.',
  'Skill promotion was staged as Codex-native skill/plugin/MCP/slash-command targets with scope, safety gates, validation commands, and install-call locations.',
  'Computer Use raw screenshots and desktop logs were folded into audit-only refs, and React/UI did not execute Computer Use actions.',
].join(' ');

export async function runCapabilitySkillComputerUseBoundariesCase(options: {
  baseDir?: string;
  now?: string;
} = {}): Promise<CapabilitySkillComputerUseBoundariesCaseResult> {
  const fixedNow = options.now ?? now;
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: CAPABILITY_SKILL_COMPUTER_USE_BOUNDARIES_CASE_ID,
    baseDir: options.baseDir,
    scenarioId,
    sessionId,
    runId,
    now: fixedNow,
    title: 'Capability, skill, and Computer Use boundary Web E2E case',
    prompt: 'Exercise R-CAP-01, R-SKILL-01, and R-CU-01 as offline fixture-level contracts.',
  });
  const capabilityRounds = capabilityDiscoveryTranscript();
  const skillPromotion = skillPromotionProposal();
  const computerUseEvidenceFold = computerUseFold();
  await finalizeCapabilitySkillComputerUseFixture(
    fixture,
    capabilityRounds,
    skillPromotion,
    computerUseEvidenceFold,
    fixedNow,
  );

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const browserVisibleState = browserVisibleStateFromExpected(fixture);
  const verifierInput: WebE2eContractVerifierInput = {
    caseId: fixture.caseId,
    expected: fixture.expectedProjection,
    browserVisibleState,
    kernelProjection: fixture.expectedProjection.conversationProjection,
    sessionBundle: { session, workspaceState: fixture.workspaceState },
    runAudit: runAuditFromSession(session, fixture.expectedProjection),
    artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, fixture.expectedProjection),
  };
  assertWebE2eContract(verifierInput);

  const result: CapabilitySkillComputerUseBoundariesCaseResult = {
    fixture,
    capabilityRounds,
    skillPromotion,
    computerUseEvidenceFold,
    browserVisibleState,
    verifierInput,
  };
  assertCapabilitySkillComputerUseBoundariesCase(result);
  return result;
}

export function assertCapabilitySkillComputerUseBoundariesCase(
  result: CapabilitySkillComputerUseBoundariesCaseResult,
): void {
  const verification = verifyWebE2eContract(result.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));

  assertCapabilityDiscoveryProgressiveDisclosure(result.capabilityRounds);
  assertCodexNativeSkillPromotion(result.skillPromotion);
  assertComputerUseEvidenceFolding(result.computerUseEvidenceFold, result.browserVisibleState);

  const transcriptBlob = JSON.stringify({
    capabilityRounds: result.capabilityRounds,
    skillPromotion: result.skillPromotion,
    computerUseEvidenceFold: result.computerUseEvidenceFold,
    projection: result.fixture.expectedProjection.conversationProjection,
    browserVisibleState: result.browserVisibleState,
  });
  assert.doesNotMatch(transcriptBlob, /\bguiRanking\b|\brankingScore\b|\brankedCards\b/i);
  assert.doesNotMatch(transcriptBlob, /\bcompletionEvidenceRef\b|\bplanCompletedTask\b/i);
  assert.doesNotMatch(transcriptBlob, /\bReactComputerUseExecutor\b|\bexecuteComputerUseAction\b|\bdesktopBridge\.click\b/i);
}

export function assertCapabilityDiscoveryProgressiveDisclosure(rounds: CapabilityDiscoveryRound[]): void {
  assert.deepEqual(rounds.map((round) => round.round), [1, 2, 3], 'R-CAP-01 must cover three progressive turns');
  assert.equal(rounds[0]?.chosenRoute, 'workspace-ref-reader', 'round 1 should pick a conservative initial capability route');
  assert.equal(rounds[2]?.chosenRoute, 'web-research-provider', 'round 3 must continue after an explicit route change');
  assert.notEqual(rounds[0]?.chosenRoute, rounds[2]?.chosenRoute, 'route change must be visible in the contract');

  for (const round of rounds) {
    assert.match(round.tuiPlanningRef, /^tui-plan:\/\/r-cap-01\//, `round ${round.round}: discovery must be TUI-native planning`);
    assert.ok(round.alternatives.length > 0, `round ${round.round}: alternatives must be present`);
    assert.equal(round.discoveryPlanIsCompletionEvidence, false, `round ${round.round}: discovery plan is not completion evidence`);
    assert.equal(hasOwn(round, 'guiRanking'), false, `round ${round.round}: GUI ranking must be absent`);
    assert.equal(hasOwn(round, 'completionEvidenceRef'), false, `round ${round.round}: completion evidence ref must be absent`);
  }

  assert.ok(
    rounds[1]?.alternatives.includes('web-research-provider') && rounds[1]?.alternatives.includes('desktop-perception-bridge'),
    'round 2 must explain alternatives, not only the chosen route',
  );
}

export function assertCodexNativeSkillPromotion(proposal: SkillPromotionProposal): void {
  assert.match(proposal.artifactRef, /^artifact:/, 'skill promotion proposal must be a durable artifact');
  assert.match(proposal.workspaceProposalRef, /^file:/, 'workspace proposal must be staging evidence');
  assert.equal(proposal.stagingOnly, true, 'workspace proposal is staging evidence only');
  assert.deepEqual(
    proposal.targets.map((target) => target.targetType).sort(),
    ['mcp', 'plugin', 'skill', 'slash-command'],
    'promotion proposal must cover Codex-native skill/plugin/MCP/slash-command shapes',
  );

  for (const target of proposal.targets) {
    assert.ok(target.scope.length > 0, `${target.targetType}: scope must be explicit`);
    assert.ok(target.safetyGates.length > 0, `${target.targetType}: safety gates must be explicit`);
    assert.ok(target.validationCommands.length > 0, `${target.targetType}: validation commands must be explicit`);
    assert.match(target.installCallLocation, /\S/, `${target.targetType}: install/call location must be explicit`);
    assert.doesNotMatch(target.installCallLocation, /React|browser button|renderer/i, `${target.targetType}: install location must not be React/UI-owned`);
  }
}

export function assertComputerUseEvidenceFolding(
  fold: ComputerUseEvidenceFold,
  browserVisibleState: WebE2eBrowserVisibleState,
): void {
  assert.match(fold.perceptionSummary, /\bscreenshot\b|\bGUI perception\b/i, 'CU perception summary must explain perceived evidence');
  assert.match(fold.actionSummary, /\bdesktop bridge\b|\bComputer Use\b/i, 'CU action summary must explain action ownership');
  assert.match(fold.foldedEvidenceRef, /^audit:\/\/r-cu-01\/folded\//, 'CU evidence must fold into an audit ref');
  assert.equal(fold.uiExecutedComputerUseActions, false, 'React/UI must not execute Computer Use actions');
  assert.equal(hasOwn(fold, 'reactActionDispatch'), false, 'React/UI CU dispatch must be absent');
  assert.ok(fold.rawRefs.length >= 2, 'CU contract must include screenshot and log raw refs');
  assert.ok(fold.rawRefs.some((ref) => ref.kind === 'screenshot'), 'raw screenshot ref must be represented');
  assert.ok(fold.rawRefs.some((ref) => ref.kind === 'desktop-log'), 'raw desktop log ref must be represented');

  for (const rawRef of fold.rawRefs) {
    assert.equal(rawRef.auditOnly, true, `${rawRef.ref}: raw CU evidence must be audit-only`);
    assert.equal(rawRef.foldedIntoRef, fold.foldedEvidenceRef, `${rawRef.ref}: raw CU evidence must fold into the summary audit ref`);
    assert.match(rawRef.ref, /^audit-raw:\/\/r-cu-01\//, `${rawRef.ref}: raw CU refs must remain audit-raw refs`);
    assert.equal(browserVisibleState.visibleArtifactRefs?.includes(rawRef.ref), false, `${rawRef.ref}: raw CU ref must not be visible artifact delivery`);
    assert.equal(browserVisibleState.primaryArtifactRefs?.includes(rawRef.ref), false, `${rawRef.ref}: raw CU ref must not be primary delivery`);
    assert.equal(browserVisibleState.supportingArtifactRefs?.includes(rawRef.ref), false, `${rawRef.ref}: raw CU ref must not be supporting delivery`);
  }
}

function capabilityDiscoveryTranscript(): CapabilityDiscoveryRound[] {
  return [
    {
      round: 1,
      userIntent: 'Repeat a prior analysis task where the required capability is not obvious from the prompt alone.',
      tuiPlanningRef: 'tui-plan://r-cap-01/round-1-required-capability-unclear',
      chosenRoute: 'workspace-ref-reader',
      alternatives: ['web-research-provider', 'desktop-perception-bridge'],
      reason: 'Start with durable workspace refs because the selected artifact may already contain the needed evidence.',
      discoveryPlanIsCompletionEvidence: false,
    },
    {
      round: 2,
      userIntent: 'Explain why that tool/provider was chosen and name alternatives.',
      tuiPlanningRef: 'tui-plan://r-cap-01/round-2-explain-route-and-alternatives',
      chosenRoute: 'workspace-ref-reader',
      alternatives: ['web-research-provider', 'desktop-perception-bridge'],
      reason: 'Workspace refs are lowest-risk, web research is appropriate when freshness is required, and desktop perception is reserved for GUI-only evidence.',
      discoveryPlanIsCompletionEvidence: false,
    },
    {
      round: 3,
      userIntent: 'Change to another capability route and continue the same task.',
      tuiPlanningRef: 'tui-plan://r-cap-01/round-3-route-change-to-web-research',
      chosenRoute: 'web-research-provider',
      alternatives: ['workspace-ref-reader', 'desktop-perception-bridge'],
      reason: 'The user requested freshness after seeing the alternatives, so the task continues through the web research provider route.',
      discoveryPlanIsCompletionEvidence: false,
    },
  ];
}

function skillPromotionProposal(): SkillPromotionProposal {
  return {
    artifactRef: 'artifact:r-skill-01-codex-native-promotion-proposal',
    workspaceProposalRef: 'file:.sciforge/task-results/r-skill-01-promotion-proposal.md',
    stagingOnly: true,
    targets: [
      promotionTarget('skill', 'capability-route-planner', 'CODEX_HOME/skills/capability-route-planner/SKILL.md'),
      promotionTarget('plugin', 'capability-boundary-plugin', '.agents/plugins/capability-boundary/.codex-plugin/plugin.json'),
      promotionTarget('mcp', 'capability-boundary-mcp', 'Codex MCP config mcpServers.capability-boundary'),
      promotionTarget('slash-command', 'capability-route', 'Codex slash-command registry /capability-route'),
    ],
  };
}

function promotionTarget(
  targetType: CodexNativePromotionTarget,
  name: string,
  installCallLocation: string,
): SkillPromotionProposalTarget {
  return {
    targetType,
    name,
    scope: [
      'Capture repeatable capability planning decisions only.',
      'Keep task outputs and provider secrets outside the reusable asset.',
    ],
    safetyGates: [
      'Fail closed when required capability evidence is missing.',
      'Require explicit user confirmation before installing or invoking mutable workspace commands.',
    ],
    validationCommands: [
      'node --import tsx --test tests/smoke/web-e2e/cases/capability-skill-computer-use-boundaries.test.ts',
      'git diff --check',
    ],
    installCallLocation,
  };
}

function computerUseFold(): ComputerUseEvidenceFold {
  const foldedEvidenceRef = 'audit://r-cu-01/folded/gui-perception-and-action-summary';
  return {
    task: 'Inspect a GUI-only state, explain perception/action evidence, then export a bounded audit.',
    perceptionSummary: 'GUI perception used screenshot refs to summarize visible state without exposing raw screenshot payloads.',
    actionSummary: 'Computer Use actions were owned by the desktop bridge runtime; React/UI only displayed folded refs and status.',
    foldedEvidenceRef,
    rawRefs: [
      {
        kind: 'screenshot',
        ref: 'audit-raw://r-cu-01/screenshot/initial-visible-state.png',
        auditOnly: true,
        foldedIntoRef: foldedEvidenceRef,
      },
      {
        kind: 'desktop-log',
        ref: 'audit-raw://r-cu-01/desktop-log/bridge-actions.jsonl',
        auditOnly: true,
        foldedIntoRef: foldedEvidenceRef,
      },
    ],
    uiExecutedComputerUseActions: false,
  };
}

async function finalizeCapabilitySkillComputerUseFixture(
  fixture: WebE2eFixtureWorkspace,
  capabilityRounds: CapabilityDiscoveryRound[],
  skillPromotion: SkillPromotionProposal,
  computerUseEvidenceFold: ComputerUseEvidenceFold,
  fixedNow: string,
): Promise<void> {
  const auditRefs = uniqueStrings([
    ...fixture.expectedProjection.runAuditRefs,
    ...capabilityRounds.map((round) => round.tuiPlanningRef),
    skillPromotion.artifactRef,
    skillPromotion.workspaceProposalRef,
    computerUseEvidenceFold.foldedEvidenceRef,
    ...computerUseEvidenceFold.rawRefs.map((ref) => ref.ref),
  ]);
  const projection: ConversationProjection = {
    ...fixture.expectedProjection.conversationProjection,
    visibleAnswer: {
      status: 'satisfied',
      text: visibleAnswerText,
      artifactRefs: fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
    },
    activeRun: { id: fixture.runId, status: 'satisfied' },
    executionProcess: [
      ...capabilityRounds.map((round) => ({
        eventId: `r-cap-01-round-${round.round}`,
        type: 'HarnessDecisionRecorded' as const,
        summary: `Capability discovery used ${round.chosenRoute} via TUI-native planning; alternatives remained visible.`,
        timestamp: fixedNow,
      })),
      {
        eventId: 'r-skill-01-promotion-proposal',
        type: 'HarnessDecisionRecorded' as const,
        summary: 'Skill promotion stayed Codex-native and workspace proposal stayed staging-only.',
        timestamp: fixedNow,
      },
      {
        eventId: 'r-cu-01-evidence-folded',
        type: 'HarnessDecisionRecorded' as const,
        summary: 'Computer Use raw screenshots/logs were folded into audit-only refs; React/UI did not execute CU actions.',
        timestamp: fixedNow,
      },
    ],
    recoverActions: [],
    auditRefs,
    diagnostics: [{
      severity: 'info',
      code: 'capability-skill-computer-use-boundaries',
      message: 'R-CAP-01, R-SKILL-01, and R-CU-01 boundary contracts were exercised as offline fixture evidence.',
      refs: auditRefs.map((ref) => ({ ref })),
    }],
  };
  fixture.expectedProjection.conversationProjection = projection;
  fixture.expectedProjection.runAuditRefs = auditRefs;

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = {
    ...session,
    title: 'Capability, skill, and Computer Use boundary Web E2E case',
    messages: session.messages.map((message) => message.role === 'scenario'
      ? { ...message, content: visibleAnswerText, status: 'completed' }
      : message),
    runs: session.runs.map((run) => run.id === fixture.runId
      ? {
        ...run,
        status: 'completed',
        response: visibleAnswerText,
        completedAt: fixedNow,
        raw: {
          ...(isRecord(run.raw) ? run.raw : {}),
          displayIntent: {
            ...(isRecord(run.raw) && isRecord(run.raw.displayIntent) ? run.raw.displayIntent : {}),
            source: 'runtime-dispatch',
            conversationProjection: projection,
            capabilityDiscovery: capabilityRounds,
            skillPromotion,
            computerUseEvidenceFold,
          },
          resultPresentation: { conversationProjection: projection },
        },
      }
      : run),
    executionUnits: [
      ...(session.executionUnits ?? []),
      ...executionUnits(capabilityRounds, skillPromotion, computerUseEvidenceFold, fixedNow),
    ],
    updatedAt: fixedNow,
  };
  await writeJson(fixture.expectedProjectionPath, fixture.expectedProjection);
  await writeJson(fixture.workspaceStatePath, fixture.workspaceState);
}

function executionUnits(
  capabilityRounds: CapabilityDiscoveryRound[],
  skillPromotion: SkillPromotionProposal,
  computerUseEvidenceFold: ComputerUseEvidenceFold,
  fixedNow: string,
): RuntimeExecutionUnit[] {
  return [
    ...capabilityRounds.map((round): RuntimeExecutionUnit => ({
      id: `EU-r-cap-01-${round.round}`,
      tool: 'codex.tui.capabilityPlan',
      params: `round=${round.round} route=${round.chosenRoute}`,
      status: 'done',
      hash: `r-cap-01-${round.round}`,
      runId,
      outputRef: round.tuiPlanningRef,
      outputArtifacts: [],
      time: fixedNow,
    })),
    {
      id: 'EU-r-skill-01-proposal',
      tool: 'codex.skillPromotionProposal',
      params: 'targets=skill,plugin,mcp,slash-command',
      status: 'done',
      hash: 'r-skill-01-proposal',
      runId,
      outputRef: skillPromotion.artifactRef,
      outputArtifacts: [skillPromotion.workspaceProposalRef],
      time: fixedNow,
    },
    {
      id: 'EU-r-cu-01-folded-evidence',
      tool: 'desktopBridge.computerUseEvidenceFold',
      params: 'rawRefs=audit-only uiExecution=false',
      status: 'done',
      hash: 'r-cu-01-folded-evidence',
      runId,
      outputRef: computerUseEvidenceFold.foldedEvidenceRef,
      outputArtifacts: computerUseEvidenceFold.rawRefs.map((ref) => ref.ref),
      time: fixedNow,
    },
  ];
}

function browserVisibleStateFromExpected(fixture: WebE2eFixtureWorkspace): WebE2eBrowserVisibleState {
  return {
    status: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
    visibleAnswerText,
    visibleArtifactRefs: [
      ...fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
      ...fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
    ],
    primaryArtifactRefs: fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
    supportingArtifactRefs: fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
