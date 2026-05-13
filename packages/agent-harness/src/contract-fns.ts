export type ContractResultKind = 'pass' | 'warn' | 'fail';
export type ContractIssueSeverity = 'info' | 'warning' | 'error';

export type FailureOwnerLayer =
  | 'external-provider'
  | 'payload-contract'
  | 'runtime-runner'
  | 'backend-generation'
  | 'verification'
  | 'ui-presentation'
  | 'unknown';

export type FailureOwnerNextStep =
  | 'retry-provider'
  | 'repair-payload'
  | 'repair-backend'
  | 'supplement-verification'
  | 'fix-runtime'
  | 'fix-presentation'
  | 'needs-human'
  | 'degraded-result'
  | 'fail-closed';

export type ContractFn<Input, Output> = (input: Readonly<Input>) => ContractResult<Output>;

export interface ContractIssue {
  code: string;
  severity: ContractIssueSeverity;
  message: string;
  ref?: string;
  path?: string;
}

export interface FailureOwnerDecision {
  owner: FailureOwnerLayer;
  nextStep: FailureOwnerNextStep;
  reason: string;
  evidenceRefs: string[];
  retryable: boolean;
  confidence?: number;
}

export interface ContractResult<Output> {
  kind: ContractResultKind;
  output?: Output;
  issues: ContractIssue[];
  ownerDecision?: FailureOwnerDecision;
  contractId?: string;
  inputDigest?: string;
}

export interface FailureOwnerInput {
  sourceLayer?: FailureOwnerLayer | 'provider' | 'payload' | 'runtime' | 'backend' | 'verifier' | 'ui';
  statusCode?: number;
  errorCode?: string;
  retryable?: boolean;
  evidenceRefs?: string[];
  validationFailures?: readonly unknown[];
  verifierFailed?: boolean;
  uiPresentationFailed?: boolean;
  runtimeFailed?: boolean;
  backendGeneratedInvalidPayload?: boolean;
  partialResultAvailable?: boolean;
}

export function contractPass<Output>(
  output: Output,
  options: Omit<Partial<ContractResult<Output>>, 'kind' | 'output' | 'issues'> & { issues?: ContractIssue[] } = {},
): ContractResult<Output> {
  return normalizeContractResult({ ...options, kind: 'pass', output, issues: options.issues ?? [] });
}

export function contractWarn<Output>(
  output: Output,
  issues: ContractIssue[],
  options: Omit<Partial<ContractResult<Output>>, 'kind' | 'output' | 'issues'> = {},
): ContractResult<Output> {
  return normalizeContractResult({ ...options, kind: 'warn', output, issues });
}

export function contractFail<Output = never>(
  issues: ContractIssue[],
  options: Omit<Partial<ContractResult<Output>>, 'kind' | 'issues'> = {},
): ContractResult<Output> {
  return normalizeContractResult({ ...options, kind: 'fail', issues });
}

export function normalizeContractResult<Output>(result: ContractResult<Output>): ContractResult<Output> {
  return {
    ...result,
    issues: [...result.issues].sort((left, right) => {
      const severityOrder: ContractIssueSeverity[] = ['error', 'warning', 'info'];
      return severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity)
        || left.code.localeCompare(right.code)
        || (left.path ?? '').localeCompare(right.path ?? '')
        || (left.ref ?? '').localeCompare(right.ref ?? '');
    }),
    ownerDecision: result.ownerDecision ? normalizeFailureOwnerDecision(result.ownerDecision) : undefined,
  };
}

export function normalizeFailureOwnerDecision(decision: FailureOwnerDecision): FailureOwnerDecision {
  return {
    ...decision,
    evidenceRefs: sortedUnique(decision.evidenceRefs),
  };
}

export function createFailureOwnerDecision(decision: FailureOwnerDecision): FailureOwnerDecision {
  return normalizeFailureOwnerDecision(decision);
}

export const failureOwnerContract: ContractFn<FailureOwnerInput, FailureOwnerDecision> = (input) => {
  const ownerDecision = classifyFailureOwner(input);
  const issue: ContractIssue = {
    code: ownerDecision.owner === 'unknown' ? 'failure_owner_unknown' : 'failure_owner_classified',
    severity: ownerDecision.owner === 'unknown' ? 'warning' : 'info',
    message: ownerDecision.reason,
  };
  const result = ownerDecision.owner === 'unknown'
    ? contractWarn(ownerDecision, [issue], { ownerDecision, contractId: 'failure-owner-contract' })
    : contractPass(ownerDecision, { issues: [issue], ownerDecision, contractId: 'failure-owner-contract' });
  return result;
};

export function classifyFailureOwner(input: Readonly<FailureOwnerInput>): FailureOwnerDecision {
  const evidenceRefs = sortedUnique(input.evidenceRefs ?? []);
  const sourceLayer = normalizeSourceLayer(input.sourceLayer);
  if (sourceLayer) return ownerDecisionForLayer(sourceLayer, evidenceRefs, input);

  if (isExternalProviderStatus(input.statusCode) || isExternalProviderCode(input.errorCode)) {
    return ownerDecisionForLayer('external-provider', evidenceRefs, input);
  }
  if ((input.validationFailures?.length ?? 0) > 0 || input.backendGeneratedInvalidPayload) {
    return ownerDecisionForLayer('payload-contract', evidenceRefs, input);
  }
  if (input.runtimeFailed) return ownerDecisionForLayer('runtime-runner', evidenceRefs, input);
  if (input.verifierFailed) return ownerDecisionForLayer('verification', evidenceRefs, input);
  if (input.uiPresentationFailed) return ownerDecisionForLayer('ui-presentation', evidenceRefs, input);
  return ownerDecisionForLayer('unknown', evidenceRefs, input);
}

function normalizeSourceLayer(layer: FailureOwnerInput['sourceLayer']): FailureOwnerLayer | undefined {
  if (!layer) return undefined;
  if (layer === 'provider') return 'external-provider';
  if (layer === 'payload') return 'payload-contract';
  if (layer === 'runtime') return 'runtime-runner';
  if (layer === 'backend') return 'backend-generation';
  if (layer === 'verifier') return 'verification';
  if (layer === 'ui') return 'ui-presentation';
  return layer;
}

function ownerDecisionForLayer(
  owner: FailureOwnerLayer,
  evidenceRefs: string[],
  input: Readonly<FailureOwnerInput>,
): FailureOwnerDecision {
  if (owner === 'external-provider') {
    return {
      owner,
      nextStep: input.partialResultAvailable ? 'degraded-result' : 'retry-provider',
      reason: 'Failure is outside the local contract boundary and should not enter backend code repair by default.',
      evidenceRefs,
      retryable: input.retryable ?? true,
      confidence: 0.86,
    };
  }
  if (owner === 'payload-contract') {
    return {
      owner,
      nextStep: 'repair-payload',
      reason: 'Materialized output did not satisfy the payload contract.',
      evidenceRefs,
      retryable: input.retryable ?? true,
      confidence: 0.82,
    };
  }
  if (owner === 'runtime-runner') {
    return {
      owner,
      nextStep: 'fix-runtime',
      reason: 'Runtime execution boundary reported the failure.',
      evidenceRefs,
      retryable: input.retryable ?? false,
      confidence: 0.8,
    };
  }
  if (owner === 'backend-generation') {
    return {
      owner,
      nextStep: 'repair-backend',
      reason: 'Backend generation should repair or regenerate the produced work.',
      evidenceRefs,
      retryable: input.retryable ?? true,
      confidence: 0.78,
    };
  }
  if (owner === 'verification') {
    return {
      owner,
      nextStep: 'supplement-verification',
      reason: 'Verifier evidence is missing or negative.',
      evidenceRefs,
      retryable: input.retryable ?? true,
      confidence: 0.78,
    };
  }
  if (owner === 'ui-presentation') {
    return {
      owner,
      nextStep: 'fix-presentation',
      reason: 'Presentation layer failed after result materialization.',
      evidenceRefs,
      retryable: input.retryable ?? false,
      confidence: 0.75,
    };
  }
  return {
    owner: 'unknown',
    nextStep: 'needs-human',
    reason: 'Failure owner could not be classified from structured facts.',
    evidenceRefs,
    retryable: input.retryable ?? false,
    confidence: 0.2,
  };
}

function isExternalProviderStatus(statusCode?: number): boolean {
  return typeof statusCode === 'number' && (statusCode === 408 || statusCode === 429 || statusCode >= 500);
}

function isExternalProviderCode(errorCode?: string): boolean {
  if (!errorCode) return false;
  return ['timeout', 'rate_limit', 'provider_unavailable', 'connection_closed', 'dns_error'].includes(errorCode);
}

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}
