import {
  approvalChainSidecarRefsFromMarker,
  highRiskActionFromApprovalChainSidecars,
  isSessionDerivedApprovalRef,
  validateCuNextApprovalChainSidecars,
  validateCuNextNeedsConfirmationSidecars,
} from './approval-chain.js';
import {
  browserRuntimeDomAxObservationSchema,
  domAxHintClaimKinds,
  forbiddenLegacyBackendPattern,
  markerAliases,
  shortcutClaimKinds,
  type CuNextLiveAcceptanceIssue,
  type CuNextLiveAcceptanceMarkerKind,
  type CuNextLiveAcceptanceTaskRule,
  type MarkerCandidate,
} from './live-acceptance-rules.js';

export function validateTaskMarker(
  evidence: Record<string, unknown>,
  rule: CuNextLiveAcceptanceTaskRule,
  refRecords?: Record<string, unknown>,
): { markerFound: boolean; issues: CuNextLiveAcceptanceIssue[] } {
  const marker = findTaskMarker(evidence, rule.markerKind);
  if (!marker) {
    return {
      markerFound: false,
      issues: [
        {
          id: 'missing-task-marker',
          reason: `${rule.taskId} requires a structured ${rule.label} evidence marker.`,
        },
      ],
    };
  }

  const markerIssues = validateMarkerFields(rule.markerKind, marker.record, evidence, refRecords).map((issue) => ({
    ...issue,
    path: issue.path ? `${marker.path}.${issue.path}` : marker.path,
  }));
  return {
    markerFound: true,
    issues: markerIssues,
  };
}

export function validateMarkerFields(
  kind: CuNextLiveAcceptanceMarkerKind,
  marker: Record<string, unknown>,
  evidence: Record<string, unknown>,
  refRecords?: Record<string, unknown>,
): CuNextLiveAcceptanceIssue[] {
  switch (kind) {
    case 'briefing-deck':
      return [
        ...requireMarkerRef(marker, evidence, 'briefing deck artifact', ['deckRef', 'artifactRef', 'finalArtifactRef'], 'finalArtifactRef'),
        ...requireMarkerRefs(marker, 'literature/source refs', ['sourceRefs', 'literatureRefs', 'citationRefs', 'inputRefs']),
        ...requireAnyMarkerShape(marker, 'slide outline or slide refs', ['outlineRef', 'slideRefs'], ['slideCount']),
      ];
    case 'chart-report':
      return [
        ...requireMarkerRef(marker, evidence, 'chart report artifact', ['reportRef', 'artifactRef', 'finalArtifactRef'], 'finalArtifactRef'),
        ...requireMarkerRefs(marker, 'spreadsheet/table source refs', ['dataRefs', 'tableRefs', 'spreadsheetRefs', 'sourceRefs']),
        ...requireMarkerRefs(marker, 'chart or figure refs', ['chartRefs', 'plotRefs', 'figureRefs', 'imageRefs']),
      ];
    case 'needs-confirmation':
      return [
        ...requireNeedsConfirmationStatus(marker),
        ...requireMarkerRefs(marker, 'approval request refs', ['approvalRequestRef', 'approvalRequestRefs']),
        ...requireMarkerRefs(marker, 'gui.ask_user refs', ['guiAskUserRef', 'guiAskUserRecordRef', 'guiAskUserRefs']),
        ...requireMarkerRefs(marker, 'risk audit refs', ['riskAuditRef', 'riskAuditRefs']),
        ...requireMarkerValue(marker, 'high-risk action', ['highRiskAction', 'actionKind', 'sideEffectClass']),
        ...rejectMarkerRefs(marker, 'confirmed request refs', ['confirmedRequestRef', 'confirmedRequestRefs', 'confirmedRequest', 'confirmedRequestSidecar']),
        ...requireDeniedExecutionFalse(marker),
        ...requireNeedsConfirmationSidecars(marker, refRecords),
      ];
    case 'file-index':
      return [
        ...requireMarkerRefs(marker, 'file index ref', ['indexRef', 'fileIndexRef', 'artifactRef']),
        ...requireMarkerRefs(marker, 'directory/file listing refs', ['directoryListingRefs', 'fileRefs', 'organizedFileRefs', 'movedFileRefs']),
        ...requireMarkerRefs(marker, 'file preview refs', ['previewRef', 'previewRefs', 'finalVisibleScreenshotRef']),
      ];
    case 'desktop-file-save':
      return [
        ...requireMarkerRefs(marker, 'target window ref', ['targetWindowRef', 'windowRef', 'targetWindowRefs']),
        ...requireMarkerRefs(marker, 'before screenshot ref', ['beforeScreenshotRef', 'beforeScreenshotRefs']),
        ...requireMarkerRefs(marker, 'before AX evidence ref', ['beforeAxRef', 'beforeAxRefs', 'beforeAccessibilityRef']),
        ...requireMarkerRefs(marker, 'GUI save command ref', ['guiSaveCommandRef', 'saveCommandRef', 'saveIntentRef']),
        ...requireMarkerRefs(marker, 'executor event ref', ['executorEventRef', 'executorEventRefs']),
        ...requireMarkerRefs(marker, 'after screenshot ref', ['afterScreenshotRef', 'afterScreenshotRefs']),
        ...requireMarkerRefs(marker, 'after AX evidence ref', ['afterAxRef', 'afterAxRefs', 'afterAccessibilityRef']),
        ...requireMarkerRef(marker, evidence, 'saved file artifact ref', ['artifactRef', 'fileArtifactRef', 'finalArtifactRef'], 'finalArtifactRef'),
        ...requireMarkerRef(marker, evidence, 'artifact validation ref', ['artifactValidationRef', 'fileValidationRef'], 'artifactValidationRef'),
        ...requireDesktopFileSaveCausality(marker),
      ];
    case 'repair-continuity':
      return [
        ...requireMarkerRefs(marker, 'blocked manifest ref', ['blockedManifestRef', 'blockedRunRef']),
        ...requireMarkerRefs(marker, 'repair hint ref', ['repairHintRef', 'repairInstructionRef']),
        ...requireMarkerRefs(marker, 'continuation request ref', ['continuationRequestRef', 'resumeRequestRef']),
        ...requireRepairSessionContinuity(marker, evidence),
      ];
    case 'approval-ref':
      return [
        ...requireApprovalRef(marker),
        ...requireMarkerRefs(marker, 'approval request refs', ['approvalRequestRef', 'approvalRequestRefs']),
        ...requireMarkerRefs(marker, 'gui.ask_user refs', ['guiAskUserRef', 'guiAskUserRecordRef', 'guiAskUserRefs']),
        ...requireMarkerRefs(marker, 'confirmed request refs', ['confirmedRequestRef', 'confirmedRequestRefs']),
        ...requireMarkerRefs(marker, 'risk audit refs', ['riskAuditRef', 'riskAuditRefs']),
        ...requireMarkerRefs(marker, 'source approval request refs', ['sourceApprovalRequestRef', 'sourceApprovalRequestRefs']),
        ...requireMarkerRefs(marker, 'source gui.ask_user refs', ['sourceGuiAskUserRef', 'sourceGuiAskUserRecordRef', 'sourceGuiAskUserRefs']),
        ...requireMarkerRefs(marker, 'source risk audit refs', ['sourceRiskAuditRef', 'sourceRiskAuditRefs']),
        ...requireMarkerRefs(marker, 'approval decision refs', ['approvalDecisionRef', 'approvalDecisionRefs']),
        ...requireDeniedExecutionFalse(marker),
        ...requireApprovalChainSidecars(marker, refRecords),
      ];
    case 'dense-grounding':
      return [
        ...requireMarkerValue(marker, 'target description', ['targetDescription', 'targetLabel']),
        ...requireMarkerRefs(marker, 'coarse window screenshot ref', ['coarseWindowScreenshotRef', 'coarseScreenshotRef', 'windowScreenshotRef']),
        ...requireMarkerRef(marker, evidence, 'focus crop ref', ['focusCropRef', 'focusCropRefs'], 'focusCropRefs'),
        ...requireMarkerRef(marker, evidence, 'fine grounding diagnostic ref', ['fineGroundingDiagnosticRef', 'groundingDiagnosticRef', 'groundingDiagnosticsRefs'], 'groundingDiagnosticsRefs'),
        ...requireMarkerRefs(marker, 'rejected or excluded target refs', ['rejectedTargetRefs', 'excludedTargetRefs', 'negativeTargetRefs']),
        ...requireDenseGroundingRejectionEvidence(marker, refRecords),
      ];
  }
}

export function requireDesktopFileSaveCausality(marker: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const owner = stringValue(marker.fileCreationOwner) ?? stringValue(marker.creationOwner) ?? stringValue(marker.artifactCreationOwner);
  if (owner !== 'scoped-gui-save' && owner !== 'native-gui-save') {
    issues.push({
      id: 'invalid-task-marker',
      path: 'fileCreationOwner',
      reason: 'desktop-file-save marker must prove a scoped/native GUI save owner; workspace-file-writer-assisted or shell writes cannot satisfy Evolve T1.',
    });
  }
  if (marker.sharedSystemInputUsed === true || stringValue(marker.inputOwnership)?.match(/shared-system|system mouse|system keyboard/i)) {
    issues.push({
      id: 'invalid-task-marker',
      path: 'sharedSystemInputUsed',
      reason: 'desktop-file-save marker must not use shared system input; it must be scoped to the target desktop session.',
    });
  }
  if (marker.shellDirectArtifactWrite === true || marker.directShellArtifactWrite === true) {
    issues.push({
      id: 'invalid-task-marker',
      path: 'shellDirectArtifactWrite',
      reason: 'desktop-file-save marker must not use shell/direct file writes as the artifact creation path.',
    });
  }
  return issues;
}

export function requireNeedsConfirmationStatus(marker: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const status = stringValue(marker.status) ?? stringValue(marker.initialStatus) ?? stringValue(marker.resultStatus);
  if (status === 'needs-confirmation' || marker.needsConfirmation === true) return [];
  return [{
    id: 'invalid-task-marker',
    path: 'status',
    reason: 'needs-confirmation marker must carry status=needs-confirmation or needsConfirmation=true.',
  }];
}

export function rejectMarkerRefs(
  marker: Record<string, unknown>,
  label: string,
  keys: string[],
): CuNextLiveAcceptanceIssue[] {
  const entries = markerRefEntriesFromKeys(marker, keys);
  if (entries.length === 0) return [];
  return [{
    id: 'invalid-task-marker',
    path: keys[0],
    reason: `needs-confirmation marker must not include ${label}.`,
  }];
}

export function requireDeniedExecutionFalse(marker: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  if (marker.deniedExecuted === undefined || marker.deniedExecuted === false) return [];
  return [{
    id: 'invalid-task-marker',
    path: 'deniedExecuted',
    reason: 'Denied high-risk actions must be recorded as not executed.',
  }];
}

export function requireRepairSessionContinuity(
  marker: Record<string, unknown>,
  evidence: Record<string, unknown>,
): CuNextLiveAcceptanceIssue[] {
  const sessionRef = firstString(marker, ['traceSessionRef', 'sessionRef', 'continuationSessionRef']);
  if (!sessionRef) {
    return [{
      id: 'invalid-task-marker',
      path: 'traceSessionRef',
      reason: 'repair continuity marker must include traceSessionRef or sessionRef.',
    }];
  }
  if (!isEvidenceBundleLocalFileRef(sessionRef)) {
    return [{
      id: 'invalid-task-marker',
      path: 'traceSessionRef',
      reason: `repair continuity traceSessionRef must use an evidence-bundle-local file ref; got ${describeMarkerRef(sessionRef)}.`,
    }];
  }
  const evidenceSessionRefs = collectSessionRefs(evidence);
  if (!evidenceSessionRefs.includes(sessionRef)) {
    return [{
      id: 'invalid-task-marker',
      path: 'traceSessionRef',
      reason: `repair continuity session ${sessionRef} must also appear in evidence sessionRefs.`,
    }];
  }
  return [];
}

export function requireApprovalRef(marker: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const approvalRef = stringValue(marker.approvalRef);
  if (!isApprovalRefToken(approvalRef)) {
    issues.push({
      id: 'invalid-task-marker',
      path: 'approvalRef',
      reason: 'approvalRef marker must include canonical approvalRef with a non-empty approval: token.',
    });
  } else if (isSessionDerivedApprovalRef(approvalRef)) {
    issues.push({
      id: 'invalid-task-marker',
      path: 'approvalRef',
      reason: 'approvalRef marker must come from confirmed-request sidecar content, not a session, trace, or request-derived token.',
    });
  }
  issues.push(...invalidMarkerRefIssues(
    markerRefEntriesFromKeys(marker, ['humanApprovalRef', 'confirmedApprovalRef']),
    'approval alias refs',
    { allowApproval: true },
  ));
  return issues;
}

export function requireNeedsConfirmationSidecars(
  marker: Record<string, unknown>,
  refRecords: Record<string, unknown> | undefined,
): CuNextLiveAcceptanceIssue[] {
  const refs = approvalChainSidecarRefsFromMarker(marker);
  const sidecars = {
    approvalRequest: marker.approvalRequestSidecar ?? marker.approvalRequest ?? recordForRef(refRecords, refs.approvalRequestRef),
    guiAskUser: marker.guiAskUserSidecar ?? marker.guiAskUserRecord ?? marker.guiAskUser ?? recordForRef(refRecords, refs.guiAskUserRecordRef),
    confirmedRequest: marker.confirmedRequestSidecar ?? marker.confirmedRequest ?? recordForRef(refRecords, refs.confirmedRequestRef),
    riskAudit: marker.riskAuditSidecar ?? marker.riskAudit ?? recordForRef(refRecords, refs.riskAuditRef),
  };
  const issues = validateCuNextNeedsConfirmationSidecars({
    sidecars,
    marker,
    refs,
  }).map((issue) => ({
    id: 'invalid-task-marker',
    path: issue.path,
    reason: issue.reason,
  }));
  const markerAction = firstString(marker, ['highRiskAction', 'actionKind', 'sideEffectClass']);
  const sidecarAction = highRiskActionFromApprovalChainSidecars(sidecars, 'needs-confirmation');
  if (markerAction && !highRiskActionMatches(markerAction, sidecarAction)) {
    issues.push({
      id: 'invalid-task-marker',
      path: 'highRiskAction',
      reason: 'needs-confirmation highRiskAction must match the action derived from approval sidecar evidence.',
    });
  }
  return issues;
}

export function requireApprovalChainSidecars(
  marker: Record<string, unknown>,
  refRecords: Record<string, unknown> | undefined,
): CuNextLiveAcceptanceIssue[] {
  const refs = approvalChainSidecarRefsFromMarker(marker);
  const sidecars = {
    approvalRequest: marker.approvalRequestSidecar ?? marker.approvalRequest ?? recordForRef(refRecords, refs.approvalRequestRef),
    guiAskUser: marker.guiAskUserSidecar ?? marker.guiAskUserRecord ?? marker.guiAskUser ?? recordForRef(refRecords, refs.guiAskUserRecordRef),
    confirmedRequest: marker.confirmedRequestSidecar ?? marker.confirmedRequest ?? recordForRef(refRecords, refs.confirmedRequestRef),
    riskAudit: marker.riskAuditSidecar ?? marker.riskAudit ?? recordForRef(refRecords, refs.riskAuditRef),
    sourceApprovalRequest: marker.sourceApprovalRequestSidecar ?? marker.sourceApprovalRequest ?? recordForRef(refRecords, refs.sourceApprovalRequestRef),
    sourceGuiAskUser: marker.sourceGuiAskUserSidecar ?? marker.sourceGuiAskUserRecord ?? marker.sourceGuiAskUser ?? recordForRef(refRecords, refs.sourceGuiAskUserRecordRef),
    sourceRiskAudit: marker.sourceRiskAuditSidecar ?? marker.sourceRiskAudit ?? recordForRef(refRecords, refs.sourceRiskAuditRef),
    approvalDecision: marker.approvalDecisionSidecar ?? marker.approvalDecision ?? recordForRef(refRecords, refs.approvalDecisionRef),
  };
  return validateCuNextApprovalChainSidecars({
    sidecars,
    marker,
    refs,
  }).map((issue) => ({
    id: 'invalid-task-marker',
    path: issue.path,
    reason: issue.reason,
  }));
}

export function requireDenseGroundingRejectionEvidence(
  marker: Record<string, unknown>,
  refRecords: Record<string, unknown> | undefined,
): CuNextLiveAcceptanceIssue[] {
  const refs = markerRefEntriesFromKeys(marker, ['rejectedTargetRefs', 'excludedTargetRefs', 'negativeTargetRefs']);
  const issues: CuNextLiveAcceptanceIssue[] = [];
  for (const entry of refs) {
    if (/cu-l3-independent-input-verifier\.json$/i.test(entry.ref)) {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejectedTargetRefs must point to dedicated rejected-target evidence, not the generic verifier.',
      });
      continue;
    }
    const record = asRecord(recordForRef(refRecords, entry.ref)) ?? {};
    if (record.schemaVersion !== 'sciforge.computer-use.dense-grounding-rejections.v1') {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejected target evidence must use schemaVersion=sciforge.computer-use.dense-grounding-rejections.v1.',
      });
      continue;
    }
    if (record.status !== 'recorded' && record.status !== 'passed') {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejected target evidence must record status=recorded or passed.',
      });
    }
    if (!asRecord(record.selectedTarget)) {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejected target evidence must include selectedTarget.',
      });
    }
    const rejectedTargets = Array.isArray(record.rejectedTargets)
      ? record.rejectedTargets.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
      : [];
    if (rejectedTargets.length === 0) {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejected target evidence must include non-empty rejectedTargets.',
      });
    }
    if (!stringValue(record.coarseWindowScreenshotRef) || !stringValue(record.focusCropRef) || !stringValue(record.fineGroundingDiagnosticRef)) {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejected target evidence must bind coarse screenshot, focus crop, and fine grounding diagnostic refs.',
      });
    }
  }
  return issues;
}

export function recordForRef(refRecords: Record<string, unknown> | undefined, ref: string | undefined): unknown {
  if (!refRecords || !ref) return undefined;
  return refRecords[ref] ?? refRecords[ref.replace(/^\.\//, '')];
}

export function requireMarkerRef(
  marker: Record<string, unknown>,
  evidence: Record<string, unknown>,
  label: string,
  markerKeys: readonly string[],
  evidenceFallbackKey: string,
): CuNextLiveAcceptanceIssue[] {
  const markerRefs = markerRefEntriesFromKeys(marker, markerKeys);
  const markerRefIssues = invalidMarkerRefIssues(markerRefs, label);
  if (markerRefIssues.length > 0) return markerRefIssues;
  if (markerRefs.length > 0) return [];
  const fallbackRefs = markerRefEntriesFromKeys(evidence, [evidenceFallbackKey]);
  if (fallbackRefs.some((entry) => isEvidenceBundleLocalFileRef(entry.ref))) return [];
  if (fallbackRefs.length > 0) {
    return [{
      id: 'invalid-task-marker',
      reason: `${label} fallback ${evidenceFallbackKey} must use an evidence-bundle-local file ref.`,
    }];
  }
  return [{
    id: 'invalid-task-marker',
    reason: `Missing ${label}.`,
  }];
}

export function requireMarkerRefs(
  marker: Record<string, unknown>,
  label: string,
  keys: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  const refs = markerRefEntriesFromKeys(marker, keys);
  const refIssues = invalidMarkerRefIssues(refs, label);
  if (refIssues.length > 0) return refIssues;
  if (refs.length > 0) return [];
  return [{
    id: 'invalid-task-marker',
    reason: `Missing ${label}.`,
  }];
}

export function requireMarkerValue(
  marker: Record<string, unknown>,
  label: string,
  keys: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  if (keys.some((key) => isNonEmptyString(marker[key]) || Boolean(asRecord(marker[key]) && Object.keys(asRecord(marker[key]) ?? {}).length > 0))) return [];
  return [{
    id: 'invalid-task-marker',
    reason: `Missing ${label}.`,
  }];
}

export function requireAnyMarkerShape(
  marker: Record<string, unknown>,
  label: string,
  refKeys: readonly string[],
  numberKeys: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  const refs = markerRefEntriesFromKeys(marker, refKeys);
  const refIssues = invalidMarkerRefIssues(refs, label);
  if (refIssues.length > 0) return refIssues;
  const hasRef = refs.length > 0;
  const hasNumber = numberKeys.some((key) => {
    const value = marker[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  });
  if (hasRef || hasNumber) return [];
  return [{
    id: 'invalid-task-marker',
    reason: `Missing ${label}.`,
  }];
}

export function findTaskMarker(
  evidence: Record<string, unknown>,
  kind: CuNextLiveAcceptanceMarkerKind,
): MarkerCandidate | undefined {
  const candidates = records(evidence.evidenceMarkers)
    .map((record, index) => ({ path: `$.evidenceMarkers[${index}]`, record }))
    .filter((candidate) => recordHasMarkerIdentity(candidate.record, kind));
  const valid = candidates.find((candidate) => validateMarkerFields(kind, candidate.record, evidence).length === 0);
  return valid ?? candidates[0];
}

export interface MarkerRefEntry {
  path: string;
  ref: string;
}

export function markerRefEntriesFromKeys(record: Record<string, unknown>, keys: readonly string[]): MarkerRefEntry[] {
  return keys.flatMap((key) => {
    const value = record[key];
    if (isNonEmptyString(value)) return [{ path: key, ref: value }];
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => (
        isNonEmptyString(item) ? [{ path: `${key}[${index}]`, ref: item }] : []
      ));
    }
    return [];
  });
}

export function invalidMarkerRefIssues(
  refs: readonly MarkerRefEntry[],
  label: string,
  options: { allowApproval?: boolean } = {},
): CuNextLiveAcceptanceIssue[] {
  return refs
    .filter((entry) => !isAllowedMarkerRef(entry.ref, options))
    .map((entry) => ({
      id: 'invalid-task-marker',
      path: entry.path,
      reason: `${label} must use evidence-bundle-local file refs${options.allowApproval ? ' or approval: tokens' : ''}; got ${describeMarkerRef(entry.ref)}.`,
    }));
}

export function isAllowedMarkerRef(ref: string, options: { allowApproval?: boolean } = {}): boolean {
  return isEvidenceBundleLocalFileRef(ref) || (options.allowApproval === true && isApprovalRefToken(ref));
}

export function isEvidenceBundleLocalFileRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return false;
  const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (!parts.every((part) => part !== '' && part !== '.' && part !== '..')) return false;
  const fileName = parts.at(-1) ?? '';
  return /\.[a-z0-9][a-z0-9-]{0,15}$/i.test(fileName);
}

export function isApprovalRefToken(ref: string | undefined): boolean {
  if (!ref) return false;
  const trimmed = ref.trim();
  return trimmed.startsWith('approval:')
    && trimmed.slice('approval:'.length).trim().length > 0;
}

export function describeMarkerRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return '(empty)';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme) return `${scheme}: ref`;
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

export function recordHasMarkerIdentity(
  record: Record<string, unknown>,
  kind: CuNextLiveAcceptanceMarkerKind,
): boolean {
  return ['kind', 'type', 'markerKind', 'marker', 'id'].some((key) => {
    const value = stringValue(record[key]);
    return value !== undefined && markerTokenMatches(value, kind);
  });
}

export function markerTokenMatches(value: string, kind: CuNextLiveAcceptanceMarkerKind): boolean {
  const token = normalizeToken(value);
  return markerAliases[kind].some((alias) => normalizeToken(alias) === token);
}

export function collectScenarioIds(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => collectScenarioIds(item, seen)));
  }
  const record = value as Record<string, unknown>;
  const ids: string[] = [];
  for (const [key, child] of Object.entries(record)) {
    if (
      (key === 'scenarioId' || key === 'primaryScenarioId' || key === 'cuLongScenarioId')
      && typeof child === 'string'
      && /^CU-LONG-\d{3}$/.test(child)
    ) {
      ids.push(child);
    }
    if (
      (key === 'scenarioIds' || key === 'longScenarioIds')
      && Array.isArray(child)
    ) {
      ids.push(...child.filter((item): item is string => typeof item === 'string' && /^CU-LONG-\d{3}$/.test(item)));
    }
    ids.push(...collectScenarioIds(child, seen));
  }
  return uniqueStrings(ids);
}

export function collectSessionRefs(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return uniqueStrings(value.flatMap((item) => collectSessionRefs(item, seen)));
  const record = value as Record<string, unknown>;
  const refs = stringArray(record.sessionRefs);
  for (const child of Object.values(record)) refs.push(...collectSessionRefs(child, seen));
  return uniqueStrings(refs);
}

export function requireRef(
  issues: CuNextLiveAcceptanceIssue[],
  path: string,
  ref: string | undefined,
): void {
  if (ref) return;
  issues.push({
    id: 'missing-required-ref',
    path,
    reason: `${path} is required.`,
  });
}

export function requireRefs(
  issues: CuNextLiveAcceptanceIssue[],
  path: string,
  refs: string[],
): void {
  if (refs.length > 0) return;
  issues.push({
    id: 'missing-required-ref',
    path,
    reason: `${path} must include at least one ref.`,
  });
}

export function requireCustomRef(
  issues: CuNextLiveAcceptanceIssue[],
  id: string,
  path: string,
  ref: string | undefined,
): void {
  if (ref) return;
  issues.push({
    id,
    path,
    reason: `${path} is required.`,
  });
}

export function requireCustomRefs(
  issues: CuNextLiveAcceptanceIssue[],
  id: string,
  path: string,
  refs: string[],
): void {
  if (refs.length > 0) return;
  issues.push({
    id,
    path,
    reason: `${path} must include at least one ref.`,
  });
}

export function hasClaimWithRefs(
  claims: Array<Record<string, unknown>>,
  kind: string,
): boolean {
  return claims.some((claim) => claim.kind === kind && refsFromClaim(claim).length > 0);
}

export function hasIndependentInputAdapterClaim(claims: Array<Record<string, unknown>>): boolean {
  return claims.some((claim) => (
    claim.kind === 'independent-input-adapter'
    && refsFromClaim(claim).length > 0
    && stringArray(claim.sessionRefs).length > 0
  ));
}

export function hasSciForgeChatOriginClaim(
  claims: Array<Record<string, unknown>>,
  requestRef: string | undefined,
): boolean {
  if (!requestRef) return false;
  return claims.some((claim) => (
    claim.kind === 'sciForge-chat-origin'
    && claim.status === 'present'
    && refsFromClaim(claim).includes(requestRef)
    && stringArray(claim.sessionRefs).length > 0
    && isSciForgeChatOrigin(claim.origin)
  ));
}

export function hasGuiPresentClaim(
  claims: Array<Record<string, unknown>>,
  guiPresentRecordRef: string | undefined,
  displayedRefs: string[],
  finalArtifactRef: string | undefined,
): boolean {
  if (!guiPresentRecordRef || !finalArtifactRef || displayedRefs.length === 0) return false;
  return claims.some((claim) => {
    if (claim.kind !== 'gui-present-record') return false;
    const claimRefs = refsFromClaim(claim);
    return claimRefs.includes(guiPresentRecordRef)
      && displayedRefs.includes(finalArtifactRef)
      && (claimRefs.includes(finalArtifactRef) || stringArray(claim.artifactRefs).includes(finalArtifactRef));
  });
}

export function isSciForgeChatOrigin(value: unknown): boolean {
  const origin = asRecord(value);
  if (!origin) return false;
  return origin.schemaVersion === 'sciforge.computer-use.chat-origin.v1'
    && origin.handoffSource === 'ui-chat'
    && origin.entrypoint === 'sciforge-chat'
    && origin.terminalEquivalentText === true;
}

export function refsFromClaim(claim: Record<string, unknown>): string[] {
  return refsFromKeys(claim, ['ref', 'refs', 'recordRefs', 'evidenceRefs', 'artifactRefs']);
}

export function isAllowedDomAxObservationHintClaim(claim: Record<string, unknown>): boolean {
  const kind = String(claim.kind ?? '').toLowerCase();
  if (!domAxHintClaimKinds.has(kind)) return false;
  const use = normalizeToken(
    stringValue(claim.observationUse)
      ?? stringValue(claim.evidenceUse)
      ?? stringValue(claim.use)
      ?? '',
  );
  const refs = refsFromClaim(claim);
  return (use === 'observe-before-mutate-hint' || use === 'grounding-hint')
    && refs.length > 0
    && refs.every(isEvidenceBundleLocalFileRef)
    && !hasDomAxSubstituteFlag(claim);
}

export function hasDomAxSubstituteFlag(value: Record<string, unknown>): boolean {
  const substituteFlagKeys = new Set([
    'executorLeaseSubstitute',
    'guiActionSubstitute',
    'artifactValidationSubstitute',
    'artifactCausalitySubstitute',
    'completionEvidence',
    'completionEvidenceEligible',
    'completionEvidenceSubstitute',
    'completionSubstitute',
    'finalArtifactSubstitute',
    'userLevelCompletionSubstitute',
  ]);
  return findRecordValue(value, (key, child) => (
    substituteFlagKeys.has(key)
    && child === true
  ));
}

export function refsFromKeys(record: Record<string, unknown>, keys: readonly string[]): string[] {
  return uniqueStrings(keys.flatMap((key) => {
    const value = record[key];
    if (isNonEmptyString(value)) return [value];
    if (Array.isArray(value)) return value.filter(isNonEmptyString);
    return [];
  }));
}

export function freshnessRecordRefs(record: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const collect = (value: unknown, seen = new Set<unknown>()) => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collect(item, seen);
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) {
      if (/ref$/i.test(childKey) && isNonEmptyString(childValue)) refs.push(childValue);
      if (/refs$/i.test(childKey) && Array.isArray(childValue)) refs.push(...childValue.filter(isNonEmptyString));
      collect(childValue, seen);
    }
  };
  collect(record);
  return uniqueStrings(refs);
}

export function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (isNonEmptyString(value)) return value;
  }
  return undefined;
}

export function findRecordValue(
  value: unknown,
  predicate: (key: string, value: unknown) => boolean,
  seen = new Set<unknown>(),
): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => findRecordValue(item, predicate, seen));
  for (const [key, child] of Object.entries(value)) {
    if (predicate(key, child)) return true;
    if (findRecordValue(child, predicate, seen)) return true;
  }
  return false;
}

export function isModeKey(key: string): boolean {
  return key === 'kind'
    || key === 'evidenceKind'
    || key === 'sourceKind'
    || key === 'sourceMode'
    || key === 'evidenceMode'
    || key === 'runMode'
    || key === 'mode';
}

export function isOriginKey(key: string): boolean {
  return key === 'origin'
    || key === 'evidenceOrigin'
    || key === 'provenance'
    || key === 'source'
    || key === 'generatedFrom'
    || key === 'materializedFrom';
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

export function stringValue(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function containsForbiddenLegacyBackendMarker(values: Array<string | undefined>): boolean {
  return values.some((value) => value !== undefined && forbiddenLegacyBackendPattern.test(value));
}

export function highRiskActionMatches(markerAction: string, sidecarAction: unknown): boolean {
  const marker = normalizeToken(markerAction);
  if (!marker) return false;
  if (isNonEmptyString(sidecarAction)) return normalizeToken(sidecarAction) === marker;
  const record = asRecord(sidecarAction);
  if (!record) return false;
  const candidates = [
    stringValue(record.actionKind),
    stringValue(record.action_kind),
    stringValue(record.kind),
    stringValue(record.type),
    stringValue(record.sideEffectClass),
    stringValue(record.side_effect_class),
    stringValue(record.targetDescription),
    stringValue(record.target),
  ].filter(isNonEmptyString).map(normalizeToken);
  return candidates.some((candidate) => candidate === marker || marker.includes(candidate) || candidate.includes(marker));
}

export function validateActorCursorEvents(
  evidence: Record<string, unknown>,
  cursorRecords: readonly Record<string, unknown>[],
  screenIds: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const events = [
    ...records(evidence.cursorEvents),
    ...records(evidence.actorCursorEvents),
    ...records(asRecord(evidence.virtualDesktopSession)?.cursorEvents),
  ];
  const eventTypes = new Set(events.map((event) => normalizeToken(
    stringValue(event.eventType) ?? stringValue(event.kind) ?? stringValue(event.type) ?? '',
  )));
  for (const required of ['move', 'point', 'annotate']) {
    if (!eventTypes.has(required)) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: 'cursorEvents',
        reason: `Actor cursor event log must include read-only ${required} events.`,
      });
    }
  }
  const knownPairs = new Set(cursorRecords.flatMap((cursor) => {
    const actorId = stringValue(cursor.actorId);
    const cursorId = stringValue(cursor.cursorId);
    return actorId && cursorId ? [`${actorId}::${cursorId}`] : [];
  }));
  for (const [index, event] of events.entries()) {
    const eventType = normalizeToken(stringValue(event.eventType) ?? stringValue(event.kind) ?? stringValue(event.type) ?? '');
    if (!['move', 'point', 'annotate'].includes(eventType)) continue;
    const actorId = stringValue(event.actorId);
    const cursorId = stringValue(event.cursorId);
    const screenId = stringValue(event.screenId);
    if (!actorId || !cursorId || !screenId) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `cursorEvents[${index}]`,
        reason: 'Read-only actor cursor events must include actorId, cursorId, and screenId.',
      });
    }
    if (actorId && cursorId && knownPairs.size > 0 && !knownPairs.has(`${actorId}::${cursorId}`)) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `cursorEvents[${index}]`,
        reason: 'Read-only actor cursor events must match declared actor/cursor provenance.',
      });
    }
    if (screenId && screenIds.length > 0 && !screenIds.includes(screenId)) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `cursorEvents[${index}].screenId`,
        reason: `Read-only actor cursor event screenId ${screenId} must match a declared screen.`,
      });
    }
    if (!firstString(event, ['cursorEventLogRef', 'actorCursorLogRef', 'ref', 'eventRef'])) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `cursorEvents[${index}].cursorEventLogRef`,
        reason: 'Read-only actor cursor events must bind a cursor event log ref.',
      });
    }
    if (event.readOnlyCursorEvent !== true || event.mutatingGuiAction === true || stringValue(event.executorEventRef)) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `cursorEvents[${index}]`,
        reason: 'move/point/annotate actor cursor events must be read-only and must not project into executor events.',
      });
    }
  }
  return issues;
}

export function validateNativeQueueBindings(
  queueRecords: readonly Record<string, unknown>[],
  screenIds: readonly string[],
  actorCursorPairs: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const pairSet = new Set(actorCursorPairs);
  for (const [index, record] of queueRecords.entries()) {
    const kind = leaseKindFromRecord(record);
    if (!kind) continue;
    const scope = asRecord(record.leaseScope)
      ?? asRecord(record.scope)
      ?? asRecord(record.proposalScope)
      ?? asRecord(record.queueScope)
      ?? {};
    const screenId = stringValue(record.screenId) ?? stringValue(scope.screenId);
    if (!screenId || (screenIds.length > 0 && !screenIds.includes(screenId))) {
      issues.push({
        id: 'missing-native-queue-semantics',
        path: `queueRecords[${index}].screenId`,
        reason: 'Native queue/proposal records must bind a declared screenId.',
      });
    }
    if (kind === 'window-local' && stringValue(record.proposalId) && !(stringValue(record.windowId) ?? stringValue(scope.windowId))) {
      issues.push({
        id: 'missing-native-queue-semantics',
        path: `queueRecords[${index}].windowId`,
        reason: 'window-local queue/proposal records must bind windowId.',
      });
    }
    if (stringValue(record.proposalId)) {
      const actorId = stringValue(record.actorId);
      const cursorId = stringValue(record.cursorId);
      if (!actorId || !cursorId || (pairSet.size > 0 && !pairSet.has(`${actorId}::${cursorId}`))) {
        issues.push({
          id: 'missing-native-queue-semantics',
          path: `queueRecords[${index}]`,
          reason: 'Action proposals must bind declared actorId/cursorId provenance.',
        });
      }
      if (!firstString(record, ['proposalRef', 'evidenceRef', 'recordRef'])) {
        issues.push({
          id: 'missing-native-queue-semantics',
          path: `queueRecords[${index}].proposalRef`,
          reason: 'Action proposals must include a proposal/evidence ref.',
        });
      }
    }
    if (stringValue(record.queueId) && stringArray(record.leaseOwnerRefs).length === 0) {
      issues.push({
        id: 'missing-native-queue-semantics',
        path: `queueRecords[${index}].leaseOwnerRefs`,
        reason: 'Executor queue records must include leaseOwnerRefs.',
      });
    }
  }
  return issues;
}

export function computerUseScreenRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  const screens = [
    ...records(evidence.screens),
    ...records(evidence.virtualScreens),
    ...records(asRecord(evidence.virtualDisplayGroup)?.screens),
    ...records(asRecord(evidence.virtualDesktopSession)?.screens),
  ];
  const visibleScreenRefs = stringArray(evidence.visibleScreenRefs);
  if (visibleScreenRefs.length > 0) {
    screens.push(...visibleScreenRefs.map((ref, index) => ({
      screenId: stringArray(evidence.screenIds)[index] ?? stringValue(evidence.screenId),
      ref,
    })));
  }
  return screens;
}

export function computerUseCursorRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  return [
    ...records(evidence.actorCursorProvenance),
    ...records(evidence.actorCursors),
    ...records(evidence.visibleCursorRefs).map((cursorRef, index) => ({
      actorId: stringArray(evidence.actorIds)[index] ?? stringValue(evidence.actorId),
      cursorId: stringArray(evidence.cursorIds)[index] ?? stringValue(evidence.cursorId),
      screenId: stringArray(evidence.screenIds)[index] ?? stringValue(evidence.screenId),
      ref: stringValue(cursorRef.ref) ?? String(cursorRef),
    })),
    ...records(asRecord(evidence.virtualDesktopSession)?.actorCursors),
  ];
}

export function computerUseMutatingActionRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  return [
    ...records(evidence.mutatingActions),
    ...records(evidence.actionCausality),
    ...records(evidence.executorEvents),
    ...records(evidence.inputEvents).filter((event) => isMutatingActionKind(stringValue(event.kind) ?? stringValue(event.actionKind))),
  ].filter((action) => {
    const kind = stringValue(action.kind) ?? stringValue(action.actionKind) ?? stringValue(asRecord(action.action)?.kind);
    return !kind || isMutatingActionKind(kind);
  });
}

export function computerUseActionRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  return [
    ...computerUseMutatingActionRecords(evidence),
    ...records(evidence.evidenceLedgerActions),
    ...records(asRecord(evidence.evidenceLedger)?.actions),
    ...records(asRecord(evidence.evidenceLedger)?.actionRecords),
  ];
}

export function hasIndependentEvidenceLedgerRecords(
  evidence: Record<string, unknown>,
  actionLedgerRef: string | undefined,
): boolean {
  const ledger = asRecord(evidence.evidenceLedger) ?? asRecord(evidence.actionLedger);
  const ledgerActions = [
    ...records(ledger?.actions),
    ...records(ledger?.actionRecords),
    ...records(ledger?.mutatingActions),
    ...records(ledger?.entries),
    ...records(ledger?.records),
    ...records(evidence.evidenceLedgerActions),
  ];
  const ledgerRefs = uniqueStrings([
    stringValue(ledger?.ref),
    stringValue(ledger?.actionLedgerRef),
    ...stringArray(ledger?.refs),
    ...stringArray(ledger?.evidenceRefs),
    ...stringArray(ledger?.actionCausalityRefs),
  ].filter(isNonEmptyString));
  const hasLedgerAction = ledgerActions.some((action) => (
    Boolean(firstString(action, ['executorEventRef', 'executeEventRef', 'eventRef', 'ref']))
    && (
      stringArray(action.beforeEvidenceRefs).length > 0
      || stringArray(action.afterEvidenceRefs).length > 0
      || stringArray(action.verificationRefs).length > 0
      || stringArray(action.artifactRefs).length > 0
    )
  ));
  return hasLedgerAction
    && (!actionLedgerRef || ledgerRefs.includes(actionLedgerRef) || stringValue(ledger?.ref) === actionLedgerRef);
}

export function computerUseQueueRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  const recordsFromTopLevel = [
    ...records(evidence.actionProposals),
    ...records(evidence.proposals),
    ...records(evidence.executorQueue),
    ...records(evidence.leaseQueue),
    ...records(evidence.schedulerQueue),
    ...records(evidence.executorLeases),
    ...records(evidence.leases),
    ...computerUseMutatingActionRecords(evidence),
  ];
  const executorLease = asRecord(evidence.executorLease);
  return executorLease ? [executorLease, ...recordsFromTopLevel] : recordsFromTopLevel;
}

export function leaseKindFromRecord(record: Record<string, unknown>): 'window-local' | 'screen-global' | undefined {
  const scope = asRecord(record.leaseScope)
    ?? asRecord(record.scope)
    ?? asRecord(record.proposalScope)
    ?? asRecord(record.queueScope);
  const candidates = [
    stringValue(record.leaseKind),
    stringValue(record.queueKind),
    stringValue(record.kind),
    stringValue(record.scope),
    stringValue(scope?.kind),
    stringValue(scope?.scope),
  ].filter(isNonEmptyString).map(normalizeToken);
  if (candidates.some((candidate) => candidate === 'window-local' || candidate === 'window')) return 'window-local';
  if (candidates.some((candidate) => candidate === 'screen-global' || candidate === 'screen')) return 'screen-global';
  return undefined;
}

export function browserRuntimeObservationRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  const recordsFromArrays = [
    ...records(evidence.browserRuntimeDomAxObservations),
    ...records(evidence.browserRuntimeObservationHints),
    ...records(evidence.domAxObservationHints),
  ];
  return [
    asRecord(evidence.browserRuntimeDomAxObservation),
    asRecord(evidence.browserRuntimeObservation),
    asRecord(evidence.browserRuntimeObservationHint),
    asRecord(evidence.domAxObservation),
    ...recordsFromArrays,
  ].filter((item): item is Record<string, unknown> => Boolean(item));
}

export function browserRuntimeObservationRefs(observation: Record<string, unknown>): string[] {
  return refsFromKeys(observation, [
    'ref',
    'observationRef',
    'visibleDomRef',
    'accessibilitySnapshotRef',
    'playwrightEvaluateRef',
    'pageQueryRef',
    'stableRef',
    'stableRefs',
    'stableElementRefs',
    'groundingHintRef',
    'groundingHintRefs',
  ]);
}

export function browserRuntimeRefsBoundToActions(evidence: Record<string, unknown>): string[] {
  const observeBeforeMutate = asRecord(evidence.observeBeforeMutate);
  return [
    ...refsFromKeys(observeBeforeMutate ?? {}, [
      'browserRuntimeObservationRef',
      'browserRuntimeVisibleDomRef',
      'browserRuntimeAccessibilitySnapshotRef',
      'browserRuntimePlaywrightEvaluateRef',
      'browserRuntimePageQueryRef',
      'browserRuntimeStableRef',
      'browserRuntimeStableRefs',
      'browserRuntimeGroundingHintRef',
      'browserRuntimeGroundingHintRefs',
      'beforeEvidenceRefs',
      'groundingRefs',
    ]),
    ...computerUseMutatingActionRecords(evidence).flatMap((action) => refsFromKeys(action, [
      'beforeEvidenceRefs',
      'groundingRefs',
      'browserRuntimeObservationRef',
      'browserRuntimeGroundingHintRef',
      'browserRuntimeGroundingHintRefs',
    ])),
  ];
}

export function isMutatingActionKind(kind: string | undefined): boolean {
  if (!kind) return true;
  return !new Set(['observe', 'capture', 'crop', 'ocr', 'vlm_describe', 'cursor_move', 'move_cursor', 'point', 'annotate', 'proposal']).has(normalizeToken(kind));
}

export function isBareGlobalCoordinateAction(action: Record<string, unknown>): boolean {
  const target = asRecord(action.target) ?? action;
  const coordinateSpace = stringValue(target.coordinateSpace) ?? stringValue(target.coordinate_space);
  const hasGlobalCoordinateSpace = coordinateSpace ? /^(global|system|desktop)$/i.test(coordinateSpace) : false;
  const hasXy = typeof target.x === 'number' && typeof target.y === 'number';
  const hasScopedBinding = Boolean(
    target.screenId
    || target.windowId
    || target.elementRef
    || target.regionRef
    || target.bounds
    || target.targetRef
  );
  return hasGlobalCoordinateSpace || (hasXy && !hasScopedBinding);
}

export function isForbiddenCrossBundleEvidenceRef(value: string): boolean {
  const trimmed = value.trim();
  if (!/\.(json|png|jpe?g|webp|txt|md|pptx|docx|csv|html)$/i.test(trimmed)) return false;
  if (trimmed.startsWith('../') || trimmed.includes('/../')) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith('approval:');
}

export function collectAllEvidenceFileRefs(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && isPotentialEvidenceFileRef(value) && isEvidenceBundleLocalFileRef(value) ? [value] : [];
  }
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => collectAllEvidenceFileRefs(item, seen)));
  }
  return uniqueStrings(Object.values(value).flatMap((item) => collectAllEvidenceFileRefs(item, seen)));
}

export function isPotentialEvidenceFileRef(value: string): boolean {
  return /\/|\.json$|\.png$|\.jpe?g$|\.webp$|\.txt$|\.md$|\.pptx$|\.docx$|\.csv$|\.html$|\.xlsx$/i.test(value.trim());
}

export function currentBundleRootFromRef(ref: string): string {
  const normalized = ref.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
  if (!normalized || normalized === '.') return '.';
  if (/\.[a-z0-9][a-z0-9-]{0,15}$/i.test(normalized.split('/').at(-1) ?? '')) {
    return normalized.split('/').slice(0, -1).join('/') || '.';
  }
  return normalized;
}

export function isEvidenceRefInCurrentBundle(ref: string, bundleRoot: string): boolean {
  if (!isEvidenceBundleLocalFileRef(ref)) return false;
  const normalizedRef = ref.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
  const normalizedRoot = bundleRoot.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '') || '.';
  if (normalizedRoot === '.') {
    return !normalizedRef.startsWith('.sciforge/vision-runs/');
  }
  return normalizedRef === normalizedRoot || normalizedRef.startsWith(`${normalizedRoot}/`);
}

export function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function uniqueIssues(issues: CuNextLiveAcceptanceIssue[]): CuNextLiveAcceptanceIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.id}:${issue.path ?? ''}:${issue.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
