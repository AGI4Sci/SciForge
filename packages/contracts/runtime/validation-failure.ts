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
    createdAt: { type: 'string' },
  },
} as const;
