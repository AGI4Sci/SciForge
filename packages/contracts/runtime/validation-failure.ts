import {
  VERIFICATION_RESULT_CONTRACT_ID,
  VERIFICATION_RESULT_SCHEMA_PATH,
} from './verification-result';
import {
  WORK_EVIDENCE_POLICY_CONTRACT_ID,
  WORK_EVIDENCE_POLICY_SCHEMA_PATH,
} from './work-evidence-policy';

export const CONTRACT_VALIDATION_FAILURE_CONTRACT_ID = 'sciforge.contract-validation-failure.v1' as const;

export type ContractValidationFailureKind =
  | 'payload-schema'
  | 'artifact-schema'
  | 'reference'
  | 'ui-manifest'
  | 'work-evidence'
  | 'verifier'
  | 'unknown';

export interface ContractValidationIssue {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
  missingField?: string;
  invalidRef?: string;
  unresolvedUri?: string;
}

export interface ContractValidationAuditNote {
  kind: 'schema-normalization';
  status: 'applied' | 'blocked';
  boundary: 'structural-drift' | 'semantic-or-safety';
  policyId: string;
  message: string;
  paths: string[];
}

export interface ContractValidationFailure {
  contract: typeof CONTRACT_VALIDATION_FAILURE_CONTRACT_ID;
  schemaPath: string;
  contractId: string;
  capabilityId: string;
  failureKind: ContractValidationFailureKind;
  expected?: unknown;
  actual?: unknown;
  missingFields: string[];
  invalidRefs: string[];
  unresolvedUris: string[];
  failureReason: string;
  recoverActions: string[];
  nextStep: string;
  relatedRefs: string[];
  issues: ContractValidationIssue[];
  auditNotes?: ContractValidationAuditNote[];
  createdAt?: string;
}

export const contractValidationFailureSchema = {
  $id: 'sciforge.contract-validation-failure.schema.json',
  type: 'object',
  required: [
    'contract',
    'schemaPath',
    'contractId',
    'capabilityId',
    'failureKind',
    'missingFields',
    'invalidRefs',
    'unresolvedUris',
    'failureReason',
    'recoverActions',
    'nextStep',
    'relatedRefs',
    'issues',
  ],
  properties: {
    contract: { const: CONTRACT_VALIDATION_FAILURE_CONTRACT_ID },
    schemaPath: { type: 'string' },
    contractId: { type: 'string' },
    capabilityId: { type: 'string' },
    failureKind: {
      enum: ['payload-schema', 'artifact-schema', 'reference', 'ui-manifest', 'work-evidence', 'verifier', 'unknown'],
    },
    expected: {},
    actual: {},
    missingFields: { type: 'array', items: { type: 'string' } },
    invalidRefs: { type: 'array', items: { type: 'string' } },
    unresolvedUris: { type: 'array', items: { type: 'string' } },
    failureReason: { type: 'string' },
    recoverActions: { type: 'array', items: { type: 'string' } },
    nextStep: { type: 'string' },
    relatedRefs: { type: 'array', items: { type: 'string' } },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'message'],
        properties: {
          path: { type: 'string' },
          message: { type: 'string' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          missingField: { type: 'string' },
          invalidRef: { type: 'string' },
          unresolvedUri: { type: 'string' },
        },
      },
    },
    auditNotes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'status', 'boundary', 'policyId', 'message', 'paths'],
        properties: {
          kind: { const: 'schema-normalization' },
          status: { enum: ['applied', 'blocked'] },
          boundary: { enum: ['structural-drift', 'semantic-or-safety'] },
          policyId: { type: 'string' },
          message: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    createdAt: { type: 'string' },
  },
} as const;

export interface ContractValidationFailureOptions {
  capabilityId: string;
  failureKind: ContractValidationFailureKind;
  schemaPath: string;
  contractId: string;
  expected?: unknown;
  actual?: unknown;
  relatedRefs?: string[];
  recoverActions?: string[];
  nextStep?: string;
  auditNotes?: ContractValidationAuditNote[];
}

export function contractValidationFailureFromErrors(
  errors: string[],
  options: ContractValidationFailureOptions,
): ContractValidationFailure {
  const issues = errors.map(contractValidationIssueFromError);
  const missingFields = uniqueStrings(issues.map((issue) => issue.missingField));
  const invalidRefs = uniqueStrings(issues.map((issue) => issue.invalidRef));
  const unresolvedUris = uniqueStrings(issues.map((issue) => issue.unresolvedUri));
  const recoverActions = options.recoverActions ?? recoverActionsForValidationFailure(options.failureKind);
  return {
    contract: CONTRACT_VALIDATION_FAILURE_CONTRACT_ID,
    schemaPath: options.schemaPath,
    contractId: options.contractId,
    capabilityId: options.capabilityId,
    failureKind: options.failureKind,
    expected: options.expected,
    actual: options.actual,
    missingFields,
    invalidRefs,
    unresolvedUris,
    failureReason: `Contract validation failed (${options.contractId}): ${errors.join('; ')}`,
    recoverActions,
    nextStep: options.nextStep ?? nextStepForValidationFailure(options.failureKind),
    relatedRefs: uniqueStrings(options.relatedRefs ?? []),
    issues,
    auditNotes: options.auditNotes,
    createdAt: new Date().toISOString(),
  };
}

export function contractValidationFailureFromRepairReason(
  reason: string,
  options: {
    capabilityId: string;
    relatedRefs?: string[];
  },
): ContractValidationFailure | undefined {
  const scope = validationScopeForRepairReason(reason);
  if (!scope) return undefined;
  return contractValidationFailureFromErrors([reason], {
    capabilityId: options.capabilityId,
    failureKind: scope.failureKind,
    schemaPath: scope.schemaPath,
    contractId: scope.contractId,
    expected: scope.expected,
    actual: scope.actual,
    relatedRefs: options.relatedRefs,
  });
}

export function validationScopeForToolPayloadSchemaErrors(errors: string[]): Required<Pick<ContractValidationFailureOptions, 'failureKind' | 'schemaPath' | 'contractId' | 'expected'>> {
  if (errors.every((error) => error.startsWith('artifacts['))) {
    return {
      failureKind: 'artifact-schema',
      schemaPath: 'src/runtime/gateway/tool-payload-contract.ts#artifacts',
      contractId: 'sciforge.artifact.v1',
      expected: 'Artifacts with non-empty id and type fields, plus stable schema/data refs when materialized',
    };
  }
  if (errors.every((error) => error.startsWith('uiManifest['))) {
    return {
      failureKind: 'ui-manifest',
      schemaPath: 'src/runtime/gateway/tool-payload-contract.ts#uiManifest',
      contractId: 'sciforge.ui-manifest.v1',
      expected: 'UIManifest array slots with non-empty componentId and string artifactRef values',
    };
  }
  return {
    failureKind: 'payload-schema',
    schemaPath: 'src/runtime/gateway/tool-payload-contract.ts',
    contractId: 'sciforge.tool-payload.v1',
    expected: 'ToolPayload with message, claims, uiManifest, executionUnits, and artifacts',
  };
}

function contractValidationIssueFromError(error: string): ContractValidationIssue {
  const missingMatch = error.match(/^missing\s+(.+)$/i);
  const nonEmptyStringMatch = error.match(/^([A-Za-z0-9_.[\]-]+) must be a non-empty string/i);
  const bracketPathMatch = error.match(/^([A-Za-z0-9_.[\]-]+)\s+/);
  const invalidRefMatch = error.match(/(?:invalid|unresolved|missing|unreadable)[^:]*ref(?:erence)?[^:]*:\s*([^;]+)/i);
  const currentRefMatch = error.match(/Current-turn reference was not reflected in answer\/artifacts:\s*([^;]+)/i);
  const unresolvedUriMatch = error.match(/unresolved\s+(?:uri|url):\s*([^;]+)/i);
  const guardIssue = runtimeGuardIssueForError(error);
  const missingField = missingMatch ? String(missingMatch[1]) : nonEmptyStringMatch?.[1];
  return {
    path: missingField ?? guardIssue?.path ?? bracketPathMatch?.[1] ?? '$',
    message: error,
    expected: missingMatch ? 'present' : nonEmptyStringMatch ? 'non-empty string' : guardIssue?.expected,
    actual: missingMatch ? 'missing' : nonEmptyStringMatch ? 'missing or empty' : guardIssue?.actual,
    missingField,
    invalidRef: (invalidRefMatch?.[1] ?? currentRefMatch?.[1])?.trim(),
    unresolvedUri: unresolvedUriMatch?.[1]?.trim(),
  };
}

function runtimeGuardIssueForError(error: string): Pick<ContractValidationIssue, 'path' | 'expected' | 'actual'> | undefined {
  if (/verified but has no evidenceRefs|WorkEvidence evidence references/i.test(error)) {
    return {
      path: 'claims[].evidenceRefs',
      expected: 'verified claims include evidenceRefs/rawRef or WorkEvidence refs',
      actual: 'verified claim without evidence refs',
    };
  }
  if (/non-zero exitCode/i.test(error)) {
    return {
      path: 'executionUnits[].exitCode',
      expected: 'non-zero command exitCode is paired with failed/repair-needed status',
      actual: 'successful payload reported a non-zero exitCode',
    };
  }
  if (/fetch timeout|HTTP 429|rate-limit/i.test(error)) {
    return {
      path: 'workEvidence[].status',
      expected: 'provider failure is represented as failed/repair-needed with recovery evidence',
      actual: 'provider failure was swallowed by a successful payload',
    };
  }
  if (/External I\/O WorkEvidence|durable evidenceRefs|rawRef/i.test(error)) {
    return {
      path: 'workEvidence[].evidenceRefs',
      expected: 'external I/O evidence has durable evidenceRefs or rawRef',
      actual: 'external I/O evidence lacks durable refs',
    };
  }
  if (/uiManifest references an artifact/i.test(error)) {
    return {
      path: 'artifacts[].dataRef',
      expected: 'referenced artifacts include dataRef or schema contract',
      actual: 'referenced artifact lacks dataRef/schema',
    };
  }
  if (/External retrieval returned zero results/i.test(error)) {
    return {
      path: 'workEvidence[].diagnostics',
      expected: 'zero-result external retrieval includes external service status, query/url, retry diagnostics, or failed status',
      actual: 'zero-result external retrieval was reported as completed without diagnostics',
    };
  }
  if (/only plan\/promise text|no final answer text|stable artifact\/ref/i.test(error)) {
    return {
      path: 'message',
      expected: 'completed payload includes final answer text, artifact data, or stable artifact/dataRef',
      actual: 'completed payload only promised future work',
    };
  }
  if (/verifier|verification gate|human approval|needs-human/i.test(error)) {
    return {
      path: 'verificationResults[]',
      expected: 'passing verifier result or explicit human approval',
      actual: 'verification failed, missing, or requires human approval',
    };
  }
  return undefined;
}

function recoverActionsForValidationFailure(kind: ContractValidationFailureKind) {
  if (kind === 'reference') {
    return [
      'Resolve each invalid or missing reference from relatedRefs.',
      'Regenerate the payload so message, claims, artifacts, and refs agree.',
    ];
  }
  if (kind === 'artifact-schema') {
    return [
      'Regenerate artifacts with required id, type, schemaVersion, and data/dataRef fields.',
      'Keep artifact refs stable and point them at materialized workspace outputs.',
    ];
  }
  if (kind === 'ui-manifest') {
    return [
      'Regenerate uiManifest as an array of component slots with non-empty componentId values.',
      'Bind each artifactRef to an artifact id/type that exists in artifacts.',
    ];
  }
  if (kind === 'work-evidence') {
    return [
      'Regenerate the payload so WorkEvidence, claims, execution unit status, and durable refs agree.',
      'Attach evidenceRefs/rawRef or return repair-needed/failed-with-reason with backend diagnostics.',
    ];
  }
  if (kind === 'verifier') {
    return [
      'Attach a passing verifier result or explicit human approval before reporting completion.',
      'Preserve verifier evidenceRefs and repairHints so the next run can continue from the failed check.',
    ];
  }
  return [
    'Regenerate the runtime payload with all required contract fields.',
    'Return valid JSON that satisfies the contract before reporting success.',
  ];
}

function nextStepForValidationFailure(kind: ContractValidationFailureKind) {
  if (kind === 'reference') return 'Repair invalid refs or explicitly report the referenced input as unreadable, then rerun validation.';
  if (kind === 'artifact-schema') return 'Repair artifact ids/types/data refs and rerun validation.';
  if (kind === 'ui-manifest') return 'Repair display manifest slots and bindings, then rerun validation.';
  if (kind === 'work-evidence') return 'Repair WorkEvidence/status/ref consistency and rerun validation.';
  if (kind === 'verifier') return 'Run the selected verifier or collect human approval, then rerun validation.';
  return 'Repair the structured payload contract and rerun validation.';
}

function validationScopeForRepairReason(reason: string): (Required<Pick<ContractValidationFailureOptions, 'failureKind' | 'schemaPath' | 'contractId' | 'expected'>> & { actual: unknown }) | undefined {
  if (isWorkEvidenceContractReason(reason)) {
    return {
      failureKind: 'work-evidence',
      schemaPath: WORK_EVIDENCE_POLICY_SCHEMA_PATH,
      contractId: WORK_EVIDENCE_POLICY_CONTRACT_ID,
      expected: 'Claims, executionUnits, artifacts, and WorkEvidence expose durable evidence refs or honest failed/repair-needed status',
      actual: reason,
    };
  }
  if (isVerifierContractReason(reason)) {
    return {
      failureKind: 'verifier',
      schemaPath: VERIFICATION_RESULT_SCHEMA_PATH,
      contractId: VERIFICATION_RESULT_CONTRACT_ID,
      expected: 'Required verifier path supplies a passing verifier result or explicit human approval before completion',
      actual: reason,
    };
  }
  return undefined;
}

function isWorkEvidenceContractReason(reason: string) {
  return /WorkEvidence|verified but has no evidenceRefs|non-zero exitCode|fetch timeout|HTTP 429|rate-limit signal|External retrieval returned zero results|uiManifest references an artifact that is missing both a dataRef and a schema contract/i.test(reason);
}

function isVerifierContractReason(reason: string) {
  return /verifier|verification gate|Verification gate|passing verifier result|human approval|needs-human/i.test(reason)
    && /fail|failed|blocked|required|did not receive|no verifier|approval/i.test(reason);
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}
