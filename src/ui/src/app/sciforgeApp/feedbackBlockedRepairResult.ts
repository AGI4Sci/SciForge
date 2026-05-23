import type { FeedbackRepairResultInput } from '../../api/workspaceClient';
import { makeId, type FeedbackCommentRecord, type FeedbackRepairRunRecord, type PeerInstance, type RuntimeCodexBrowserAcceptanceManifest, type RuntimeProviderPreflightManifest } from '../../domain';
import { repairReadinessSummary, type RepairPeerReadinessByName, type RepairPeerReadinessProbe } from './feedbackRepairReadiness';

export const DEFAULT_FEEDBACK_REPAIR_CONFIRMATION_POLICY = {
  commit: 'requires-user-confirmation',
  push: 'requires-second-confirmation',
  pr: 'requires-second-confirmation',
  merge: 'never',
} as const;

export type RepairBlockedFailureKind = 'missing-repair-peer' | 'runtime-provider-preflight-blocked' | 'repair-peer-readiness-blocked' | 'runtime-codex-handoff-failed';

export function buildBlockedRepairHandoffResultInput(input: {
  item: FeedbackCommentRecord;
  failureKind: RepairBlockedFailureKind;
  message: string;
  completedAt: string;
  repairRun?: FeedbackRepairRunRecord;
  target?: PeerInstance;
  peerReadiness?: RepairPeerReadinessProbe;
  repairReadiness: ReturnType<typeof repairReadinessSummary>;
  peerReadinessByName: RepairPeerReadinessByName;
  runtimePreflightManifest?: RuntimeProviderPreflightManifest;
  browserAcceptanceManifest?: RuntimeCodexBrowserAcceptanceManifest;
  sourceWorkspacePath?: string;
  initialGuidance?: string;
}): FeedbackRepairResultInput {
  return {
    id: makeId('feedback-repair-blocked'),
    repairRunId: input.repairRun?.id,
    verdict: 'needs-follow-up',
    status: 'blocked',
    summary: blockedRepairSummary(input.failureKind, input.message),
    changedFiles: [],
    evidenceRefs: [
      'docs/test-artifacts/runtime-provider-preflight/manifest.json',
      'docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
      ...feedbackEvidenceRefList(input.item),
    ],
    testResults: [{
      name: 'repair-readiness',
      command: 'feedback-inbox repair readiness gate',
      status: 'failed',
      summary: input.message,
    }],
    humanVerification: {
      status: 'not-run',
      conclusion: 'Live DeepSeek repair did not start; resolve readiness blockers and rerun from the feedback inbox.',
      evidenceRefs: [
        'docs/test-artifacts/runtime-provider-preflight/manifest.json',
        'docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
      ],
    },
    metadata: {
      handoffKind: 'feedback-repair',
      executorBackend: 'runtime-codex',
      failureKind: input.failureKind,
      failedClosedAt: input.completedAt,
      failureMessage: input.message,
      repairReadiness: input.repairReadiness,
      peerReadiness: input.peerReadiness,
      peerReadinessByName: input.peerReadinessByName,
      runtimePreflightManifest: input.runtimePreflightManifest,
      browserAcceptanceManifest: input.browserAcceptanceManifest,
      sourceWorkspacePath: input.sourceWorkspacePath,
      initialTerminalGuidance: input.initialGuidance,
      targetWorkspacePath: input.target?.workspacePath,
      targetWorkspaceWriterUrl: input.target?.workspaceWriterUrl,
      terminalMirrorRef: input.repairRun?.terminalMirrorRef,
      confirmationPolicy: DEFAULT_FEEDBACK_REPAIR_CONFIRMATION_POLICY,
    },
  };
}

function blockedRepairSummary(failureKind: RepairBlockedFailureKind, message: string) {
  if (failureKind === 'missing-repair-peer') {
    return 'Repair blocked before executor dispatch: no enabled repair-trust peer instance is configured.';
  }
  if (failureKind === 'runtime-provider-preflight-blocked') {
    return 'Repair blocked before executor dispatch: Runtime Codex provider preflight is not release-ready.';
  }
  if (failureKind === 'repair-peer-readiness-blocked') {
    return 'Repair blocked before executor dispatch: repair peer health or manifest readiness is not proven.';
  }
  return `Repair handoff failed closed before completion: ${message}`;
}

function feedbackEvidenceRefList(item: FeedbackCommentRecord) {
  return [
    item.evidenceBundleRef,
    item.screenshotRef,
    item.rawScreenshotRef,
    item.annotatedScreenshotRef,
    item.screenshot?.rawScreenshotRef,
    item.screenshot?.annotatedScreenshotRef,
  ].filter((value): value is string => Boolean(value?.trim()));
}
