import type { CuNextTaskId } from './task-map.js';

export type CuNextProjectedAcceptanceStatus = 'multi-app-workflow-passed' | 'needs-confirmation';

export interface CuNextTaskMarkerProjectionRefs {
  traceRef: string;
  requestRef?: string;
  verifierRef: string;
  finalArtifactRef?: string;
  finalVisibleScreenshotRef?: string;
  focusCropRefs: string[];
  groundingDiagnosticsRefs: string[];
  sessionRefs: string[];
  approvalRequestRef?: string;
  guiAskUserRecordRef?: string;
  confirmedRequestRef?: string;
  riskAuditRef?: string;
  sourceApprovalRequestRef?: string;
  sourceGuiAskUserRecordRef?: string;
  sourceRiskAuditRef?: string;
  approvalDecisionRef?: string;
  approvalRef?: string;
  confirmedApprovalRef?: string;
  highRiskAction?: unknown;
  blockedManifestRef?: string;
  repairHintRef?: string;
  continuationRequestRef?: string;
  directoryListingRef?: string;
  denseGroundingRejectionRef?: string;
  denseGroundingTargetDescription?: string;
}

export interface CuNextTaskMarkerProjection {
  status: CuNextProjectedAcceptanceStatus;
  evidenceMarkers: Array<Record<string, unknown>>;
}

export interface CuNextRuntimeArtifactPresentationProjectionInput {
  traceRef?: string;
  finalArtifactRef?: string;
  finalVisibleScreenshotRef?: string;
  guiPresentRecordRef?: string;
  guiPresentPayloadRef?: string;
  guiPresentRecords?: unknown[];
}

export interface CuNextRuntimeArtifactPresentationProjection {
  finalArtifactRef?: string;
  guiPresentDisplayedRefs: string[];
  guiPresentRecordRefs: string[];
  guiPresentArtifactRefs: string[];
  guiPresentEvidenceClaim?: Record<string, unknown>;
}

export function projectCuNextRuntimeArtifactPresentationEvidence(
  input: CuNextRuntimeArtifactPresentationProjectionInput,
): CuNextRuntimeArtifactPresentationProjection {
  const guiPresentRecords = input.guiPresentRecords ?? [];
  const artifactRefs = uniqueRefs([
    input.finalArtifactRef,
    ...guiPresentRecords.flatMap(finalArtifactRefsFromValue),
  ]).filter(isFinalArtifactEvidenceRef);
  const finalArtifactRef = firstRefOrUndefined(input.finalArtifactRef, artifactRefs[0]);
  const displayedRefs = uniqueRefs([
    input.traceRef,
    input.finalVisibleScreenshotRef,
    finalArtifactRef,
    ...guiPresentRecords.flatMap(displayedRefsFromValue),
  ]);
  const guiPresentRecordRefs = uniqueRefs([
    input.guiPresentRecordRef,
    ...guiPresentRecords.flatMap(guiPresentRecordRefsFromValue),
  ]);
  const guiPresentArtifactRefs = uniqueRefs([
    finalArtifactRef,
    ...artifactRefs,
    ...guiPresentRecords.flatMap(artifactRefsFromValue),
  ]).filter(isFinalArtifactEvidenceRef);
  const actualGuiPresentArtifactRefs = uniqueRefs(guiPresentRecords.flatMap(artifactRefsFromValue))
    .filter(isFinalArtifactEvidenceRef);
  const actualGuiPresentDisplayedRefs = uniqueRefs(guiPresentRecords.flatMap(displayedRefsFromValue));
  const guiPresentCarriesFinalArtifact = finalArtifactRef
    && (
      actualGuiPresentArtifactRefs.includes(finalArtifactRef)
      || actualGuiPresentDisplayedRefs.includes(finalArtifactRef)
    );
  const guiPresentEvidenceClaim = input.guiPresentRecordRef && finalArtifactRef && guiPresentCarriesFinalArtifact
    ? {
        id: 'gui-present-record',
        kind: 'gui-present-record',
        ref: input.guiPresentRecordRef,
        refs: uniqueRefs([input.guiPresentRecordRef]),
        recordRefs: guiPresentRecordRefs,
        artifactRefs: uniqueRefs([finalArtifactRef, ...guiPresentArtifactRefs]),
      }
    : undefined;

  return {
    finalArtifactRef,
    guiPresentDisplayedRefs: displayedRefs,
    guiPresentRecordRefs,
    guiPresentArtifactRefs,
    guiPresentEvidenceClaim,
  };
}

export function projectCuNextTaskAcceptanceMarkers(
  taskId: CuNextTaskId | undefined,
  refs: CuNextTaskMarkerProjectionRefs,
): CuNextTaskMarkerProjection {
  const evidenceRef = firstRef(refs.requestRef, refs.traceRef);
  const artifactRef = firstRef(refs.finalArtifactRef, refs.traceRef);
  const visibleRef = firstRef(refs.finalVisibleScreenshotRef, refs.traceRef);
  const focusCropRef = firstRef(refs.focusCropRefs[0], visibleRef);
  const groundingRef = firstRef(refs.groundingDiagnosticsRefs[0], refs.traceRef);
  const sessionRef = firstRef(refs.sessionRefs[0], refs.traceRef);
  const approvalRequestRef = refs.approvalRequestRef;
  const guiAskUserRecordRef = refs.guiAskUserRecordRef;
  const confirmedRequestRef = refs.confirmedRequestRef;
  const riskAuditRef = refs.riskAuditRef;
  const sourceApprovalRequestRef = refs.sourceApprovalRequestRef;
  const sourceGuiAskUserRecordRef = refs.sourceGuiAskUserRecordRef;
  const sourceRiskAuditRef = refs.sourceRiskAuditRef;
  const approvalDecisionRef = refs.approvalDecisionRef;
  const approvalRef = refs.approvalRef ?? refs.confirmedApprovalRef;
  const highRiskAction = refs.highRiskAction;
  const blockedManifestRef = refs.blockedManifestRef;
  const repairHintRef = refs.repairHintRef;
  const continuationRequestRef = refs.continuationRequestRef;
  const directoryListingRef = refs.directoryListingRef;
  const denseGroundingRejectionRef = refs.denseGroundingRejectionRef;
  const denseGroundingTargetDescription = refs.denseGroundingTargetDescription;

  switch (taskId) {
    case 'CU-NEXT-01':
      return {
        status: 'multi-app-workflow-passed',
        evidenceMarkers: [{
          kind: 'briefing-deck',
          deckRef: artifactRef,
          sourceRefs: [evidenceRef],
          outlineRef: refs.verifierRef,
          slideCount: 1,
        }],
      };
    case 'CU-NEXT-02':
      return {
        status: 'multi-app-workflow-passed',
        evidenceMarkers: [{
          kind: 'chart-report',
          reportRef: artifactRef,
          dataRefs: [evidenceRef],
          chartRefs: [visibleRef],
        }],
      };
    case 'CU-NEXT-03':
      return {
        status: 'needs-confirmation',
        evidenceMarkers: [{
          kind: 'needs-confirmation',
          status: 'needs-confirmation',
          highRiskAction,
          approvalRequestRef,
          guiAskUserRecordRef,
          riskAuditRef,
          deniedExecuted: false,
        }],
      };
    case 'CU-NEXT-04':
      return {
        status: 'multi-app-workflow-passed',
        evidenceMarkers: [{
          kind: 'file-index',
          indexRef: artifactRef,
          directoryListingRefs: directoryListingRef ? [directoryListingRef] : [],
          previewRef: visibleRef,
        }],
      };
    case 'CU-NEXT-05':
      return {
        status: 'multi-app-workflow-passed',
        evidenceMarkers: [{
          kind: 'repair-continuity',
          blockedManifestRef,
          repairHintRef,
          continuationRequestRef,
          traceSessionRef: sessionRef,
        }],
      };
    case 'CU-NEXT-06':
      return {
        status: 'multi-app-workflow-passed',
        evidenceMarkers: [{
          kind: 'approval-ref',
          approvalRef,
          approvalRequestRef,
          guiAskUserRecordRef,
          confirmedRequestRef,
          riskAuditRef,
          sourceApprovalRequestRef,
          sourceGuiAskUserRecordRef,
          sourceRiskAuditRef,
          approvalDecisionRef,
          deniedExecuted: false,
        }],
      };
    case 'CU-NEXT-07':
      return {
        status: 'multi-app-workflow-passed',
        evidenceMarkers: [{
          kind: 'dense-grounding',
          targetDescription: denseGroundingTargetDescription,
          coarseWindowScreenshotRef: visibleRef,
          focusCropRef,
          fineGroundingDiagnosticRef: groundingRef,
          rejectedTargetRefs: denseGroundingRejectionRef ? [denseGroundingRejectionRef] : [],
        }],
      };
    default:
      return { status: 'multi-app-workflow-passed', evidenceMarkers: [] };
  }
}

function firstRef(...refs: Array<string | undefined>): string {
  const ref = refs.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
  return ref ?? 'vision-trace.json';
}

function firstRefOrUndefined(...refs: Array<string | undefined>): string | undefined {
  return refs.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function uniqueRefs(refs: Array<string | undefined>): string[] {
  return [...new Set(refs.filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0))];
}

function finalArtifactRefsFromValue(value: unknown): string[] {
  const record = recordValue(value);
  return uniqueRefs([
    stringValue(record.finalArtifactRef),
    stringValue(record.artifactRef),
    stringValue(record.fileArtifactRef),
    stringValue(record.outputRef),
    stringValue(record.path),
    stringValue(record.dataRef),
    ...stringArray(record.finalArtifactRefs),
    ...stringArray(record.artifactRefs),
    ...stringArray(record.fileArtifactRefs),
    ...stringArray(record.visibleArtifactRefs),
    ...records(record.visibleArtifacts).flatMap(finalArtifactRefsFromValue),
  ]);
}

function artifactRefsFromValue(value: unknown): string[] {
  const record = recordValue(value);
  return uniqueRefs([
    ...finalArtifactRefsFromValue(record),
    ...stringArray(record.displayedRefs),
  ]);
}

function displayedRefsFromValue(value: unknown): string[] {
  const record = recordValue(value);
  return uniqueRefs([
    ...stringArray(record.displayedRefs),
    ...stringArray(record.visibleArtifactRefs),
    ...records(record.visibleArtifacts).flatMap(finalArtifactRefsFromValue),
    stringValue(record.finalArtifactRef),
    stringValue(record.artifactRef),
  ]);
}

function guiPresentRecordRefsFromValue(value: unknown): string[] {
  const record = recordValue(value);
  return uniqueRefs([
    stringValue(record.recordRef),
    stringValue(record.guiPresentRef),
    ...stringArray(record.recordRefs),
  ]);
}

function isFinalArtifactEvidenceRef(ref: string): boolean {
  const text = ref.trim();
  if (!text) return false;
  if (/\.(png|jpe?g|webp)$/i.test(text)) return false;
  if (/\/?(vision-trace|host-ports|tool-payload|gui-present|gui-ask-user|approval-request|risk-audit|confirmed-request|blocked-manifest|repair-hint|continuation-request|directory-listing|tui-host-run-task-chain|computer-use-request|gateway-request|request|independent-input-adapter|virtual-remote-session|action-ledger|failure-diagnostics|cu-user-acceptance|cu-l3-independent-input-verifier)\.json$/i.test(text)) {
    return false;
  }
  return /^(artifact|file|workEvidence|ref):/i.test(text)
    || text.startsWith('.sciforge/')
    || text.startsWith('/')
    || /\.(md|txt|csv|tsv|xlsx|pptx?|pdf|docx?|odt|ods|json)$/i.test(text);
}
