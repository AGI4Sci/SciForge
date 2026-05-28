export interface CuNextApprovalChainSidecarRefs {
  approvalRequestRef?: string;
  guiAskUserRecordRef?: string;
  confirmedRequestRef?: string;
  riskAuditRef?: string;
  sourceApprovalRequestRef?: string;
  sourceGuiAskUserRecordRef?: string;
  sourceRiskAuditRef?: string;
  approvalDecisionRef?: string;
}

export interface CuNextApprovalChainSidecars {
  approvalRequest?: unknown;
  guiAskUser?: unknown;
  confirmedRequest?: unknown;
  riskAudit?: unknown;
  sourceApprovalRequest?: unknown;
  sourceGuiAskUser?: unknown;
  sourceRiskAudit?: unknown;
  approvalDecision?: unknown;
}

export interface CuNextApprovalChainIssue {
  id: string;
  reason: string;
  path?: string;
}

export type CuNextApprovalChainMode = 'needs-confirmation' | 'confirmed';

interface ApprovalChainFields {
  label: string;
  path: string;
  record?: Record<string, unknown>;
  approvalRequestId?: string;
  riskActionHash?: string;
  approvalRef?: string;
}

export function approvalChainSidecarRefsFromEvidence(evidence: unknown): CuNextApprovalChainSidecarRefs {
  const markers = records(recordValue(evidence).evidenceMarkers);
  const marker = markers
    .find((candidate) => markerKind(candidate) === 'approval-ref' || markerKind(candidate) === 'approvalref')
    ?? markers.find((candidate) => markerKind(candidate) === 'needs-confirmation' || markerKind(candidate) === 'needsconfirmation');
  return approvalChainSidecarRefsFromMarker(marker);
}

export function approvalChainSidecarRefsFromMarker(marker: unknown): CuNextApprovalChainSidecarRefs {
  const record = recordValue(marker);
  return {
    approvalRequestRef: firstStringFromKeys(record, ['approvalRequestRef', 'approvalRequestRefs']),
    guiAskUserRecordRef: firstStringFromKeys(record, ['guiAskUserRecordRef', 'guiAskUserRef', 'guiAskUserRefs']),
    confirmedRequestRef: firstStringFromKeys(record, ['confirmedRequestRef', 'confirmedRequestRefs']),
    riskAuditRef: firstStringFromKeys(record, ['riskAuditRef', 'riskAuditRefs']),
    sourceApprovalRequestRef: firstStringFromKeys(record, ['sourceApprovalRequestRef', 'sourceApprovalRequestRefs']),
    sourceGuiAskUserRecordRef: firstStringFromKeys(record, ['sourceGuiAskUserRecordRef', 'sourceGuiAskUserRef', 'sourceGuiAskUserRefs']),
    sourceRiskAuditRef: firstStringFromKeys(record, ['sourceRiskAuditRef', 'sourceRiskAuditRefs']),
    approvalDecisionRef: firstStringFromKeys(record, ['approvalDecisionRef', 'approvalDecisionRefs']),
  };
}

export function canonicalApprovalRefFromConfirmedSidecar(sidecar: unknown): string | undefined {
  const record = recordValue(sidecar);
  return stringValue(record.approvalRef) ?? stringValue(record.canonicalApprovalRef);
}

export function isSessionDerivedApprovalRef(value: string | undefined): boolean {
  if (!value) return false;
  const token = value.trim().slice(value.trim().startsWith('approval:') ? 'approval:'.length : 0);
  return /(?:^|[._:/-])(?:session|computer-use-session|vision-trace|request|computer-use-request)(?:[._:/-]|$)/i.test(token)
    || /\.(?:json|png|jpe?g|webp|txt|md|csv|tsv|docx?|pptx?|xlsx?)\b/i.test(token);
}

export function validateCuNextApprovalChainSidecars(input: {
  sidecars: CuNextApprovalChainSidecars;
  marker?: Record<string, unknown>;
  refs?: CuNextApprovalChainSidecarRefs;
  mode?: CuNextApprovalChainMode;
}): CuNextApprovalChainIssue[] {
  const issues: CuNextApprovalChainIssue[] = [];
  const mode = input.mode ?? 'confirmed';
  const confirmedFields = [
    approvalFields('approval-request', '$.approvalRequest', input.sidecars.approvalRequest),
    approvalFields('gui-ask-user', '$.guiAskUser', input.sidecars.guiAskUser),
    approvalFields('confirmed-request', '$.confirmedRequest', input.sidecars.confirmedRequest),
    approvalFields('risk-audit', '$.riskAudit', input.sidecars.riskAudit),
  ];
  const fields = mode === 'needs-confirmation'
    ? confirmedFields.filter((field) => field.label !== 'confirmed-request')
    : confirmedFields;

  if (mode === 'needs-confirmation') {
    const hasConfirmedRequest = Boolean(
      input.refs?.confirmedRequestRef
      || input.refs?.sourceApprovalRequestRef
      || input.refs?.sourceGuiAskUserRecordRef
      || input.refs?.sourceRiskAuditRef
      || input.refs?.approvalDecisionRef
      || input.marker?.confirmedRequestRef
      || input.marker?.confirmedRequestRefs
      || input.marker?.sourceApprovalRequestRef
      || input.marker?.sourceGuiAskUserRecordRef
      || input.marker?.sourceRiskAuditRef
      || input.marker?.approvalDecisionRef
      || recordOrUndefined(input.sidecars.confirmedRequest),
    );
    if (hasConfirmedRequest) {
      issues.push({
        id: 'unexpected-confirmed-sidecar',
        path: '$.confirmedRequest',
        reason: 'CU-NEXT-03 needs-confirmation evidence must not include confirmed-request sidecar refs or content.',
      });
    }
  }

  for (const field of fields) {
    if (!field.record) {
      issues.push({
        id: 'missing-approval-sidecar',
        path: field.path,
        reason: `${mode === 'needs-confirmation' ? 'CU-NEXT-03' : 'CU-NEXT-06'} requires ${field.label} sidecar content.`,
      });
      continue;
    }
    issues.push(...validateSidecarFlags(field));
    issues.push(...validateSidecarStatus(field, mode));
    issues.push(...validateSidecarShape(field));
    for (const key of ['approvalRequestId', 'riskActionHash', 'approvalRef'] as const) {
      if (!field[key]) {
        issues.push({
          id: 'invalid-approval-sidecar',
          path: `${field.path}.${key}`,
          reason: `${field.label} sidecar must carry ${key}.`,
        });
      }
    }
  }

  const canonicalApprovalRef = mode === 'confirmed'
    ? canonicalApprovalRefFromConfirmedSidecar(input.sidecars.confirmedRequest)
    : firstString(fields.map((field) => field.approvalRef));
  if (!isApprovalRefToken(canonicalApprovalRef)) {
    issues.push({
      id: 'invalid-approval-sidecar',
      path: mode === 'confirmed' ? '$.confirmedRequest.approvalRef' : '$.approvalRequest.approvalRef',
      reason: mode === 'confirmed'
        ? 'confirmed-request sidecar must carry the canonical approvalRef token.'
        : 'needs-confirmation approval sidecars must carry a canonical approvalRef token.',
    });
  } else if (isSessionDerivedApprovalRef(canonicalApprovalRef)) {
    issues.push({
      id: 'invalid-approval-sidecar',
      path: mode === 'confirmed' ? '$.confirmedRequest.approvalRef' : '$.approvalRequest.approvalRef',
      reason: `${mode === 'confirmed' ? 'confirmed-request' : 'needs-confirmation'} approvalRef must not be derived from a session, trace, or request ref.`,
    });
  }

  if (!hasHighRiskAction(highRiskActionFromApprovalChainSidecars(input.sidecars, mode))) {
    issues.push({
      id: 'invalid-approval-sidecar',
      path: mode === 'confirmed' ? '$.approvalBoundary.highRiskAction' : '$.riskAudit.highRiskAction',
      reason: `${mode === 'confirmed' ? 'confirmed' : 'needs-confirmation'} approval chain must carry the source high-risk action from sidecar or trace evidence.`,
    });
  }

  const markerApprovalRef = stringValue(input.marker?.approvalRef);
  if (markerApprovalRef && canonicalApprovalRef && markerApprovalRef !== canonicalApprovalRef) {
    issues.push({
      id: 'invalid-approval-sidecar',
      path: '$.marker.approvalRef',
      reason: mode === 'confirmed'
        ? 'approval-ref marker approvalRef must equal the canonical approvalRef in confirmed-request.json.'
        : 'needs-confirmation marker approvalRef must equal the canonical approvalRef in approval sidecars.',
    });
  }

  issues.push(...sameFieldIssues(fields, 'approvalRequestId'));
  issues.push(...sameFieldIssues(fields, 'riskActionHash'));
  issues.push(...sameFieldIssues(fields, 'approvalRef'));
  if (mode === 'confirmed') {
    issues.push(...validateConfirmedApprovalProvenance(fields, input.refs, input.sidecars));
  }
  issues.push(...validateExpectedRefs(input.sidecars, input.refs));
  return uniqueIssues(issues);
}

export function validateCuNextNeedsConfirmationSidecars(input: {
  sidecars: CuNextApprovalChainSidecars;
  marker?: Record<string, unknown>;
  refs?: CuNextApprovalChainSidecarRefs;
}): CuNextApprovalChainIssue[] {
  return validateCuNextApprovalChainSidecars({ ...input, mode: 'needs-confirmation' });
}

export function highRiskActionFromApprovalChainSidecars(
  sidecars: CuNextApprovalChainSidecars,
  mode: CuNextApprovalChainMode = 'confirmed',
): unknown {
  const candidates = [
    recordValue(sidecars.riskAudit).highRiskAction,
    recordValue(sidecars.approvalRequest).highRiskAction,
    recordValue(recordValue(sidecars.approvalRequest).approvalRequest).highRiskAction,
    recordValue(recordValue(recordValue(sidecars.guiAskUser).payload).approvalRequest).highRiskAction,
    recordValue(recordValue(sidecars.riskAudit).approvalBoundary).highRiskAction,
    ...(mode === 'confirmed' ? [
      recordValue(sidecars.confirmedRequest).highRiskAction,
      recordValue(recordValue(sidecars.confirmedRequest).approvalBoundary).highRiskAction,
      recordValue(recordValue(sidecars.approvalDecision).approvalBoundary).highRiskAction,
      recordValue(sidecars.sourceRiskAudit).highRiskAction,
      recordValue(recordValue(sidecars.sourceApprovalRequest).approvalRequest).highRiskAction,
    ] : []),
  ];
  return candidates.find((candidate) => {
    if (stringValue(candidate)) return true;
    return Boolean(recordOrUndefined(candidate) && Object.keys(recordValue(candidate)).length > 0);
  });
}

function approvalFields(label: string, path: string, value: unknown): ApprovalChainFields {
  const record = recordOrUndefined(value);
  const nestedApprovalRequest = recordValue(record?.approvalRequest ?? recordValue(record?.payload).approvalRequest);
  const metadata = recordValue(nestedApprovalRequest.metadata);
  return {
    label,
    path,
    record,
    approvalRequestId: firstString([
      record?.approvalRequestId,
      record?.approval_request_id,
      nestedApprovalRequest.id,
      metadata.approvalRequestId,
      metadata.approval_request_id,
    ]),
    riskActionHash: firstString([
      record?.riskActionHash,
      record?.risk_action_hash,
      nestedApprovalRequest.riskActionHash,
      nestedApprovalRequest.risk_action_hash,
      metadata.riskActionHash,
      metadata.risk_action_hash,
    ]),
    approvalRef: firstString([
      record?.approvalRef,
      record?.approval_ref,
      record?.canonicalApprovalRef,
      nestedApprovalRequest.approvalRef,
      nestedApprovalRequest.approval_ref,
      metadata.approvalRef,
      metadata.approval_ref,
    ]),
  };
}

function validateSidecarStatus(field: ApprovalChainFields, mode: CuNextApprovalChainMode): CuNextApprovalChainIssue[] {
  const record = field.record;
  if (!record) return [];
  const expected = mode === 'needs-confirmation' || field.label === 'approval-request' || field.label === 'gui-ask-user'
    ? 'needs-confirmation'
    : 'confirmed';
  if (record.status === expected) return [];
  return [{
    id: 'invalid-approval-sidecar',
    path: `${field.path}.status`,
    reason: `${field.label} sidecar must carry status=${expected}.`,
  }];
}

function validateSidecarShape(field: ApprovalChainFields): CuNextApprovalChainIssue[] {
  const record = field.record;
  if (!record) return [];
  const issues: CuNextApprovalChainIssue[] = [];
  const expectedSchema = expectedSchemaVersion(field.label);
  if (stringValue(record.schemaVersion) !== expectedSchema) {
    issues.push({
      id: 'invalid-approval-sidecar',
      path: `${field.path}.schemaVersion`,
      reason: `${field.label} sidecar must carry schemaVersion=${expectedSchema}.`,
    });
  }
  if (field.label === 'gui-ask-user') {
    if (record.port !== 'gui.ask_user') {
      issues.push({
        id: 'invalid-approval-sidecar',
        path: `${field.path}.port`,
        reason: 'gui-ask-user sidecar must be a refs-first gui.ask_user record.',
      });
    }
    const approvalRequest = recordValue(recordValue(record.payload).approvalRequest);
    if (!stringValue(approvalRequest.id) && !stringValue(approvalRequest.approvalRequestId)) {
      issues.push({
        id: 'invalid-approval-sidecar',
        path: `${field.path}.payload.approvalRequest`,
        reason: 'gui-ask-user sidecar must carry payload.approvalRequest content.',
      });
    }
  }
  if (field.label === 'approval-request') {
    const approvalRequest = recordValue(record.approvalRequest);
    if (!stringValue(approvalRequest.id) && !stringValue(approvalRequest.approvalRequestId)) {
      issues.push({
        id: 'invalid-approval-sidecar',
        path: `${field.path}.approvalRequest`,
        reason: 'approval-request sidecar must carry approvalRequest content.',
      });
    }
  }
  return issues;
}

function expectedSchemaVersion(label: string): string {
  switch (label) {
    case 'approval-request':
      return 'sciforge.computer-use.approval-request-sidecar.v1';
    case 'gui-ask-user':
      return 'sciforge.computer-use.tui-host-actions.v1';
    case 'confirmed-request':
      return 'sciforge.computer-use.confirmed-request-sidecar.v1';
    case 'risk-audit':
      return 'sciforge.computer-use.risk-audit-sidecar.v1';
    default:
      return '';
  }
}

function validateSidecarFlags(field: ApprovalChainFields): CuNextApprovalChainIssue[] {
  const record = field.record;
  if (!record) return [];
  const issues: CuNextApprovalChainIssue[] = [];
  if (record.deniedExecuted !== false) {
    issues.push({
      id: 'invalid-approval-sidecar',
      path: `${field.path}.deniedExecuted`,
      reason: `${field.label} sidecar must explicitly record deniedExecuted=false.`,
    });
  }
  if (record.packageMayCallGuiDirectly !== false) {
    issues.push({
      id: 'invalid-approval-sidecar',
      path: `${field.path}.packageMayCallGuiDirectly`,
      reason: `${field.label} sidecar must explicitly record packageMayCallGuiDirectly=false.`,
    });
  }
  return issues;
}

function validateConfirmedApprovalProvenance(
  fields: ApprovalChainFields[],
  refs: CuNextApprovalChainSidecarRefs | undefined,
  sidecars: CuNextApprovalChainSidecars,
): CuNextApprovalChainIssue[] {
  const issues: CuNextApprovalChainIssue[] = [];
  const confirmed = fields.find((field) => field.label === 'confirmed-request');
  const canonical = {
    approvalRequestId: confirmed?.approvalRequestId,
    riskActionHash: confirmed?.riskActionHash,
    approvalRef: confirmed?.approvalRef,
  };
  const requiredSourceRefs = [
    ['sourceApprovalRequestRef', refs?.sourceApprovalRequestRef],
    ['sourceGuiAskUserRecordRef', refs?.sourceGuiAskUserRecordRef],
    ['sourceRiskAuditRef', refs?.sourceRiskAuditRef],
    ['approvalDecisionRef', refs?.approvalDecisionRef],
  ] as const;
  for (const [key, value] of requiredSourceRefs) {
    if (!stringValue(value)) {
      issues.push({
        id: 'missing-approval-provenance',
        path: `$.refs.${key}`,
        reason: `confirmed approval chain requires ${key} copied into the current evidence bundle.`,
      });
    }
  }
  const sourceRefs: CuNextApprovalChainSidecarRefs = {
    approvalRequestRef: refs?.sourceApprovalRequestRef,
    guiAskUserRecordRef: refs?.sourceGuiAskUserRecordRef,
    riskAuditRef: refs?.sourceRiskAuditRef,
  };
  const sourceIssues = validateCuNextNeedsConfirmationSidecars({
    sidecars: {
      approvalRequest: sidecars.sourceApprovalRequest,
      guiAskUser: sidecars.sourceGuiAskUser,
      riskAudit: sidecars.sourceRiskAudit,
    },
    refs: sourceRefs,
  }).map((issue) => ({
    ...issue,
    id: issue.id === 'unexpected-confirmed-sidecar' ? issue.id : 'invalid-approval-provenance',
    path: `$.approvalBoundary.source${issue.path ? issue.path.slice(1) : ''}`,
    reason: `source fail-closed approval request is invalid: ${issue.reason}`,
  }));
  issues.push(...sourceIssues);
  issues.push(...validateSourceCopyIdentity(sidecars, canonical));
  issues.push(...validateApprovalDecision(sidecars.approvalDecision, refs, canonical));

  for (const field of fields) {
    if (!field.record) continue;
    const boundary = approvalBoundaryRecord(field.record);
    if (boundary.source !== 'prior-fail-closed-request') {
      issues.push({
        id: 'invalid-approval-provenance',
        path: `${field.path}.approvalBoundary.source`,
        reason: `${field.label} sidecar must prove it comes from a prior fail-closed approval request, not a self-contained confirmed retry.`,
      });
      continue;
    }
    const sourceStatus = stringValue(boundary.sourceStatus) ?? stringValue(boundary.status);
    if (sourceStatus !== 'needs-confirmation') {
      issues.push({
        id: 'invalid-approval-provenance',
        path: `${field.path}.approvalBoundary.sourceStatus`,
        reason: `${field.label} approval provenance must reference a needs-confirmation source request.`,
      });
    }
    if (stringValue(boundary.sourceApprovalRequestRef) !== refs?.sourceApprovalRequestRef) {
      issues.push({
        id: 'invalid-approval-provenance',
        path: `${field.path}.approvalBoundary.sourceApprovalRequestRef`,
        reason: `${field.label} approval provenance must reference the copied source approval-request sidecar ref.`,
      });
    }
    if (stringValue(boundary.sourceGuiAskUserRecordRef) !== refs?.sourceGuiAskUserRecordRef) {
      issues.push({
        id: 'invalid-approval-provenance',
        path: `${field.path}.approvalBoundary.sourceGuiAskUserRecordRef`,
        reason: `${field.label} approval provenance must reference the copied source gui.ask_user sidecar ref.`,
      });
    }
    if (stringValue(boundary.sourceRiskAuditRef) !== refs?.sourceRiskAuditRef) {
      issues.push({
        id: 'invalid-approval-provenance',
        path: `${field.path}.approvalBoundary.sourceRiskAuditRef`,
        reason: `${field.label} approval provenance must reference the copied source risk-audit sidecar ref.`,
      });
    }
    if (stringValue(boundary.approvalDecisionRef) !== refs?.approvalDecisionRef) {
      issues.push({
        id: 'invalid-approval-provenance',
        path: `${field.path}.approvalBoundary.approvalDecisionRef`,
        reason: `${field.label} approval provenance must reference an approval decision sidecar.`,
      });
    }
    for (const key of ['approvalRequestId', 'riskActionHash', 'approvalRef'] as const) {
      const actual = stringValue(boundary[key]);
      const expected = canonical[key];
      if (expected && actual !== expected) {
        issues.push({
          id: 'invalid-approval-provenance',
          path: `${field.path}.approvalBoundary.${key}`,
          reason: `${field.label} approval provenance ${key} must match the confirmed approval chain.`,
        });
      }
    }
  }
  return issues;
}

function validateSourceCopyIdentity(
  sidecars: CuNextApprovalChainSidecars,
  canonical: { approvalRequestId?: string; riskActionHash?: string; approvalRef?: string },
): CuNextApprovalChainIssue[] {
  const issues: CuNextApprovalChainIssue[] = [];
  const sourceFields = [
    approvalFields('source-approval-request', '$.sourceApprovalRequest', sidecars.sourceApprovalRequest),
    approvalFields('source-gui-ask-user', '$.sourceGuiAskUser', sidecars.sourceGuiAskUser),
    approvalFields('source-risk-audit', '$.sourceRiskAudit', sidecars.sourceRiskAudit),
  ];
  for (const field of sourceFields) {
    if (!field.record) continue;
    if (stringValue(field.record.sourceCopyPolicy) !== 'verbatim-except-bundle-local-refs') {
      issues.push({
        id: 'invalid-approval-provenance',
        path: `${field.path}.sourceCopyPolicy`,
        reason: `${field.label} must be a verbatim source sidecar copy except for bundle-local refs; rebuilt source identity is not accepted.`,
      });
    }
    if (!stringValue(field.record.originalRef)) {
      issues.push({
        id: 'invalid-approval-provenance',
        path: `${field.path}.originalRef`,
        reason: `${field.label} must retain originalRef for the prior fail-closed sidecar it copied.`,
      });
    }
    for (const key of ['approvalRequestId', 'riskActionHash', 'approvalRef'] as const) {
      const originalKey = `original${key[0].toUpperCase()}${key.slice(1)}`;
      const original = stringValue(field.record[originalKey]);
      const actual = field[key];
      if (!original) {
        issues.push({
          id: 'invalid-approval-provenance',
          path: `${field.path}.${originalKey}`,
          reason: `${field.label} must retain ${originalKey} from the copied prior fail-closed sidecar.`,
        });
      } else if (actual !== original) {
        issues.push({
          id: 'invalid-approval-provenance',
          path: `${field.path}.${key}`,
          reason: `${field.label} ${key} must match its retained ${originalKey}; source sidecar identity cannot be rewritten.`,
        });
      }
      const expected = canonical[key];
      if (expected && actual !== expected) {
        issues.push({
          id: 'invalid-approval-provenance',
          path: `${field.path}.${key}`,
          reason: `${field.label} ${key} must match the confirmed approval chain; confirmed retry must use the original prior approval identity.`,
        });
      }
    }
  }
  return issues;
}

function validateApprovalDecision(
  value: unknown,
  refs: CuNextApprovalChainSidecarRefs | undefined,
  canonical: { approvalRequestId?: string; riskActionHash?: string; approvalRef?: string },
): CuNextApprovalChainIssue[] {
  const record = recordOrUndefined(value);
  if (!record) {
    return [{
      id: 'missing-approval-provenance',
      path: '$.approvalDecision',
      reason: 'confirmed approval chain requires approval-decision sidecar content.',
    }];
  }
  const issues: CuNextApprovalChainIssue[] = [];
  if (stringValue(record.schemaVersion) !== 'sciforge.computer-use.approval-decision-sidecar.v1') {
    issues.push({
      id: 'invalid-approval-provenance',
      path: '$.approvalDecision.schemaVersion',
      reason: 'approval decision sidecar must carry schemaVersion=sciforge.computer-use.approval-decision-sidecar.v1.',
    });
  }
  if (record.status !== 'confirmed' || record.decision !== 'approved') {
    issues.push({
      id: 'invalid-approval-provenance',
      path: '$.approvalDecision.decision',
      reason: 'approval decision sidecar must record status=confirmed and decision=approved.',
    });
  }
  const expected = {
    approvalRequestId: canonical.approvalRequestId,
    riskActionHash: canonical.riskActionHash,
    approvalRef: canonical.approvalRef,
    sourceApprovalRequestRef: refs?.sourceApprovalRequestRef,
    sourceGuiAskUserRecordRef: refs?.sourceGuiAskUserRecordRef,
    sourceRiskAuditRef: refs?.sourceRiskAuditRef,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!expectedValue) continue;
    const actual = stringValue(record[key]);
    if (actual !== expectedValue) {
      issues.push({
        id: 'invalid-approval-provenance',
        path: `$.approvalDecision.${key}`,
        reason: `approval decision ${key} must match the confirmed approval chain.`,
      });
    }
  }
  if (record.packageMayCallGuiDirectly !== false) {
    issues.push({
      id: 'invalid-approval-provenance',
      path: '$.approvalDecision.packageMayCallGuiDirectly',
      reason: 'approval decision sidecar must explicitly record packageMayCallGuiDirectly=false.',
    });
  }
  return issues;
}

function hasHighRiskAction(value: unknown): boolean {
  if (stringValue(value)) return true;
  const record = recordOrUndefined(value);
  if (!record) return false;
  return Object.keys(record).some((key) => stringValue(record[key]) || typeof record[key] === 'number' || record[key] === true);
}

function approvalBoundaryRecord(record: Record<string, unknown>): Record<string, unknown> {
  return recordValue(record.approvalBoundary ?? record.approvalProvenance ?? record.provenance);
}

function sameFieldIssues(
  fields: ApprovalChainFields[],
  key: 'approvalRequestId' | 'riskActionHash' | 'approvalRef',
): CuNextApprovalChainIssue[] {
  const values = fields
    .filter((field) => field.record && field[key])
    .map((field) => ({ label: field.label, value: field[key] as string }));
  const unique = new Set(values.map((item) => item.value));
  if (unique.size <= 1) return [];
  return [{
    id: 'invalid-approval-sidecar',
    path: `$.${key}`,
    reason: `${key} must be identical across approval-request, gui-ask-user, confirmed-request, and risk-audit sidecars; got ${values.map((item) => `${item.label}=${item.value}`).join(', ')}.`,
  }];
}

function validateExpectedRefs(
  sidecars: CuNextApprovalChainSidecars,
  refs: CuNextApprovalChainSidecarRefs | undefined,
): CuNextApprovalChainIssue[] {
  if (!refs) return [];
  const issues: CuNextApprovalChainIssue[] = [];
  const sidecarRecords = [
    { path: '$.approvalRequest', record: recordOrUndefined(sidecars.approvalRequest) },
    { path: '$.guiAskUser', record: recordOrUndefined(sidecars.guiAskUser) },
    { path: '$.confirmedRequest', record: recordOrUndefined(sidecars.confirmedRequest) },
    { path: '$.riskAudit', record: recordOrUndefined(sidecars.riskAudit) },
  ];
  const expectedEntries = [
    ['approvalRequestRef', refs.approvalRequestRef],
    ['guiAskUserRecordRef', refs.guiAskUserRecordRef],
    ['confirmedRequestRef', refs.confirmedRequestRef],
    ['riskAuditRef', refs.riskAuditRef],
  ] as const;
  for (const { path, record } of sidecarRecords) {
    if (!record) continue;
    for (const [key, expected] of expectedEntries) {
      if (!expected) continue;
      const actual = stringValue(record[key]);
      if (actual !== expected) {
        issues.push({
          id: 'invalid-approval-sidecar',
          path: `${path}.${key}`,
          reason: `${key} must point to ${expected}; got ${actual ?? '(missing)'}.`,
        });
      }
    }
  }
  return issues;
}

function firstStringFromKeys(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (stringValue(value)) return stringValue(value);
    if (Array.isArray(value)) {
      const found = value.find((item) => stringValue(item));
      if (stringValue(found)) return stringValue(found);
    }
  }
  return undefined;
}

function firstString(values: unknown[]): string | undefined {
  return values.find((value): value is string => stringValue(value) !== undefined);
}

function markerKind(record: Record<string, unknown>): string | undefined {
  return stringValue(record.kind)?.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isApprovalRefToken(ref: string | undefined): boolean {
  return typeof ref === 'string' && ref.trim().startsWith('approval:') && ref.trim().slice('approval:'.length).trim().length > 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return recordOrUndefined(value) ?? {};
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function uniqueIssues(issues: CuNextApprovalChainIssue[]): CuNextApprovalChainIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.id}:${issue.path ?? ''}:${issue.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
