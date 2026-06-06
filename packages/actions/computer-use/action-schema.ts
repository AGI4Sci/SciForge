export const COMPUTER_USE_ACTION_REQUEST_SCHEMA_VERSION = 'sciforge.computer-use.request.v1' as const;
export const COMPUTER_USE_ACTION_RESULT_SCHEMA_VERSION = 'sciforge.computer-use.result.v1' as const;

export type ComputerUseActionRequest = {
  schemaVersion: typeof COMPUTER_USE_ACTION_REQUEST_SCHEMA_VERSION;
  actionLoopId: string;
  instruction: string;
  traceRefs: string[];
  screenshotRefs: string[];
  artifactRefs: string[];
  targetRefs?: string[];
  contextRefs?: string[];
};

export type ComputerUseActionResult = {
  schemaVersion: typeof COMPUTER_USE_ACTION_RESULT_SCHEMA_VERSION;
  actionLoopId: string;
  status: 'completed' | 'needs-confirmation' | 'failed';
  traceRefs: string[];
  screenshotRefs: string[];
  artifactRefs: string[];
  evidenceRefs?: string[];
  approvalRequestRef?: string;
  summary?: string;
};

const refArraySchema = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
  default: [],
} as const;

export const computerUseActionRequestSchema = {
  $id: COMPUTER_USE_ACTION_REQUEST_SCHEMA_VERSION,
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'actionLoopId', 'instruction', 'traceRefs', 'screenshotRefs', 'artifactRefs'],
  properties: {
    schemaVersion: { const: COMPUTER_USE_ACTION_REQUEST_SCHEMA_VERSION },
    actionLoopId: { type: 'string', minLength: 1 },
    instruction: { type: 'string', minLength: 1 },
    traceRefs: refArraySchema,
    screenshotRefs: refArraySchema,
    artifactRefs: refArraySchema,
    targetRefs: refArraySchema,
    contextRefs: refArraySchema,
  },
} as const;

export const computerUseActionResultSchema = {
  $id: COMPUTER_USE_ACTION_RESULT_SCHEMA_VERSION,
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'actionLoopId', 'status', 'traceRefs', 'screenshotRefs', 'artifactRefs'],
  properties: {
    schemaVersion: { const: COMPUTER_USE_ACTION_RESULT_SCHEMA_VERSION },
    actionLoopId: { type: 'string', minLength: 1 },
    status: { enum: ['completed', 'needs-confirmation', 'failed'] },
    traceRefs: refArraySchema,
    screenshotRefs: refArraySchema,
    artifactRefs: refArraySchema,
    evidenceRefs: refArraySchema,
    approvalRequestRef: { type: 'string', minLength: 1 },
    summary: { type: 'string' },
  },
} as const;
