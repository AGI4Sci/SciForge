import {
  COMPUTER_USE_ACTION_REQUEST_SCHEMA_VERSION,
  COMPUTER_USE_ACTION_RESULT_SCHEMA_VERSION,
} from './action-schema.js';
import {
  computerUseHostPortLists,
  computerUseHostPortProviderIds,
  computerUseHostPortsContractIds,
  computerUseTraceHandoffContract,
  type ComputerUseHostPortName,
} from './provider-policy.js';

export const computerUseActionProviderContractIds = {
  actionProviderId: 'action.sciforge.computer-use',
  requestSchema: COMPUTER_USE_ACTION_REQUEST_SCHEMA_VERSION,
  resultSchema: COMPUTER_USE_ACTION_RESULT_SCHEMA_VERSION,
  hostPortsSchema: computerUseHostPortsContractIds.schemaVersion,
  hostAdapterSchema: 'sciforge.computer-use.host-adapter.v1',
  tuiHostActionsSchema: 'sciforge.computer-use.tui-host-actions.v1',
  plannerAcceptanceContractSchema: 'sciforge.computer-use.planner-acceptance-contract.v1',
} as const;

export const computerUseHostAdapterForbiddenPorts = computerUseHostPortLists.forbidden;

export const computerUsePackageStdioHostPortNames = [
  'capture',
  'plan',
  'locate',
  'execute',
  'verify',
  'writeTrace',
  'emitEvent',
] as const satisfies readonly ComputerUseHostPortName[];

export type ComputerUsePackageStdioHostPortName = (typeof computerUsePackageStdioHostPortNames)[number];

export type ComputerUseHostPortCall = {
  type: 'hostPortCall';
  id: string;
  port: string;
  args?: unknown[];
  kwargs?: Record<string, unknown>;
};

export type ComputerUseHostPortHandler<Call extends ComputerUseHostPortCall = ComputerUseHostPortCall> =
  (call: Call) => Promise<unknown> | unknown;

export type ComputerUseHostPortHandlers<Call extends ComputerUseHostPortCall = ComputerUseHostPortCall> = {
  [Name in ComputerUsePackageStdioHostPortName]: ComputerUseHostPortHandler<Call>;
};

export type ComputerUseHostPortDescription = {
  provider: string;
  returns?: string;
  optional?: boolean;
  legacyAdapter?: string;
  inputAdapter?: string;
  independentInputAdapterProvider?: string;
  sharedSystemInputExplicitlyAllowed?: boolean;
  storagePolicy?: string;
};

export type ComputerUseHostPortsContract = {
  schemaVersion: typeof computerUseHostPortsContractIds.schemaVersion;
  hostAdapterSchemaVersion: typeof computerUseActionProviderContractIds.hostAdapterSchema;
  owner: string;
  actionProvider: typeof computerUseActionProviderContractIds.actionProviderId;
  ports: Record<ComputerUseHostPortName, ComputerUseHostPortDescription>;
  requiredPorts: typeof computerUseHostPortLists.required;
  optionalPorts: typeof computerUseHostPortLists.optional;
  forbiddenPorts: typeof computerUseHostPortLists.forbidden;
  approvalBoundary: {
    policy: 'refs-first-approval-sidecars-only';
    forbiddenHostPorts: typeof computerUseHostPortLists.forbidden;
    packageMayReturn: readonly [
      'needs-confirmation',
      'approvalRequestRef',
      'draftRef',
      'auditRef',
      'riskAuditRef',
      'approvalRequestSidecarRef',
    ];
    hostContinuationRequires: readonly ['approvalRef', 'approvalSidecarRefs', 'riskActionHash'];
  };
  adapterBoundary: {
    packageOwns: 'host-port-contract';
    hostInjects: readonly ['workspace-context', 'session-context', 'callbacks', 'presentation-events'];
    packageForbiddenImports: readonly ['src/ui/**', 'runtime-gui/**'];
    reusableBy: readonly ['codex-cli-plugin', 'sciforge-runtime'];
  };
  traceHandoff: typeof computerUseTraceHandoffContract;
  guiBoundary: string;
};

export type ComputerUseHostAdapter = {
  schemaVersion: typeof computerUseActionProviderContractIds.hostAdapterSchema;
  actionProvider: typeof computerUseActionProviderContractIds.actionProviderId;
  hostPorts: ComputerUseHostPortsContract;
  dispatchHostPort: (call: ComputerUseHostPortCall) => Promise<unknown>;
};

export type ComputerUseWindowActionEvidenceSideEffectFlags = {
  inputExecuted?: boolean;
  sharedSystemInputUsed?: boolean;
  systemPointerMoved?: boolean;
  systemKeyboardEventsSent?: boolean;
  rawPayloadWritten?: boolean;
  inlineImageWritten?: boolean;
  [flag: string]: boolean | undefined;
};

export type ComputerUseHostOutputEvidenceProjectionInput = {
  currentObservation?: {
    ref?: string;
    observationRef?: string;
    screenshotRef?: string;
    evidenceRef?: string;
    evidenceRefs?: readonly string[];
  };
  currentObservationRef?: string;
  currentObservationEvidenceRefs?: readonly string[];
  target?: {
    targetRef?: string;
    windowRef?: string;
    targetWindowRef?: string;
    screenRef?: string;
  };
  session?: {
    sessionRef?: string;
    windowActionSessionRef?: string;
    scopedInputAdapterRef?: string;
  };
  executorEvent?: {
    ref?: string;
    executorEventRef?: string;
    actionRef?: string;
    sideEffectFlags?: ComputerUseWindowActionEvidenceSideEffectFlags;
  };
  executorEventRef?: string;
  actionRef?: string;
  beforeEvidenceRefs?: readonly string[];
  afterEvidenceRefs?: readonly string[];
  verificationRefs?: readonly string[];
  artifactRefs?: readonly string[];
  traceRefs?: readonly string[];
  sideEffectFlags?: ComputerUseWindowActionEvidenceSideEffectFlags;
};

export type ComputerUseWindowActionEvidenceProjection = {
  schemaVersion: 'sciforge.computer-use.window-action-evidence-projection.v1';
  currentObservationRef?: string;
  currentObservationEvidenceRefs: string[];
  targetRefs: {
    targetRef?: string;
    windowRef?: string;
    screenRef?: string;
  };
  sessionRefs: {
    sessionRef?: string;
    windowActionSessionRef?: string;
    scopedInputAdapterRef?: string;
  };
  executorEventRef?: string;
  actionRef?: string;
  beforeEvidenceRefs: string[];
  afterEvidenceRefs: string[];
  verificationRefs: string[];
  artifactRefs: string[];
  traceRefs: string[];
  sideEffectFlags: ComputerUseWindowActionEvidenceSideEffectFlags;
  allEvidenceRefs: string[];
};

export type ComputerUseHostPortsContractInput = {
  owner: string;
  ports: {
    capture: ComputerUseHostPortDescription;
    plan: ComputerUseHostPortDescription;
    crop?: ComputerUseHostPortDescription;
    query?: ComputerUseHostPortDescription;
    locate: ComputerUseHostPortDescription;
    execute: ComputerUseHostPortDescription;
    verify: ComputerUseHostPortDescription;
    writeTrace?: ComputerUseHostPortDescription;
    emitEvent?: ComputerUseHostPortDescription;
  };
};

export function createComputerUseHostAdapter(input: {
  hostPorts: ComputerUseHostPortsContract;
  dispatchHostPort: (call: ComputerUseHostPortCall) => Promise<unknown> | unknown;
}): ComputerUseHostAdapter {
  const violations = computerUseHostPortsContractViolations(input.hostPorts);
  if (violations.length > 0) {
    throw new Error(`Invalid Computer Use host adapter contract: ${violations.join('; ')}`);
  }
  return {
    schemaVersion: computerUseActionProviderContractIds.hostAdapterSchema,
    actionProvider: computerUseActionProviderContractIds.actionProviderId,
    hostPorts: input.hostPorts,
    dispatchHostPort: (call) => Promise.resolve(input.dispatchHostPort(call)),
  };
}

export function projectComputerUseHostOutputToWindowActionEvidenceRefs(
  input: ComputerUseHostOutputEvidenceProjectionInput,
): ComputerUseWindowActionEvidenceProjection {
  const currentObservationRef = firstString(
    input.currentObservationRef,
    input.currentObservation?.observationRef,
    input.currentObservation?.ref,
    input.currentObservation?.evidenceRef,
  );
  const currentObservationEvidenceRefs = uniqueStrings([
    currentObservationRef,
    input.currentObservation?.observationRef,
    input.currentObservation?.ref,
    input.currentObservation?.evidenceRef,
    input.currentObservation?.screenshotRef,
    ...(input.currentObservation?.evidenceRefs ?? []),
    ...(input.currentObservationEvidenceRefs ?? []),
  ]);
  const executorEventRef = firstString(
    input.executorEventRef,
    input.executorEvent?.executorEventRef,
    input.executorEvent?.ref,
  );
  const actionRef = firstString(input.actionRef, input.executorEvent?.actionRef);
  const beforeEvidenceRefs = uniqueStrings(input.beforeEvidenceRefs ?? []);
  const afterEvidenceRefs = uniqueStrings(input.afterEvidenceRefs ?? []);
  const verificationRefs = uniqueStrings(input.verificationRefs ?? []);
  const artifactRefs = uniqueStrings(input.artifactRefs ?? []);
  const traceRefs = uniqueStrings(input.traceRefs ?? []);

  return {
    schemaVersion: 'sciforge.computer-use.window-action-evidence-projection.v1',
    currentObservationRef,
    currentObservationEvidenceRefs,
    targetRefs: definedStringFields({
      targetRef: input.target?.targetRef,
      windowRef: firstString(input.target?.windowRef, input.target?.targetWindowRef),
      screenRef: input.target?.screenRef,
    }),
    sessionRefs: definedStringFields({
      sessionRef: input.session?.sessionRef,
      windowActionSessionRef: input.session?.windowActionSessionRef,
      scopedInputAdapterRef: input.session?.scopedInputAdapterRef,
    }),
    executorEventRef,
    actionRef,
    beforeEvidenceRefs,
    afterEvidenceRefs,
    verificationRefs,
    artifactRefs,
    traceRefs,
    sideEffectFlags: {
      ...(input.executorEvent?.sideEffectFlags ?? {}),
      ...(input.sideEffectFlags ?? {}),
    },
    allEvidenceRefs: uniqueStrings([
      ...currentObservationEvidenceRefs,
      ...beforeEvidenceRefs,
      ...afterEvidenceRefs,
      ...verificationRefs,
      ...artifactRefs,
      ...traceRefs,
      executorEventRef,
    ]),
  };
}

export function createComputerUseHostPortsContract(
  input: ComputerUseHostPortsContractInput,
): ComputerUseHostPortsContract {
  const contract: ComputerUseHostPortsContract = {
    schemaVersion: computerUseHostPortsContractIds.schemaVersion,
    hostAdapterSchemaVersion: computerUseActionProviderContractIds.hostAdapterSchema,
    owner: input.owner,
    actionProvider: computerUseActionProviderContractIds.actionProviderId,
    ports: {
      capture: input.ports.capture,
      plan: input.ports.plan,
      crop: input.ports.crop ?? {
        provider: computerUseHostPortProviderIds.focusRegionCrop,
        returns: 'Optional refs-first focus-region observation.',
        optional: true,
      },
      query: input.ports.query ?? {
        provider: 'observation-summary-query',
        returns: 'Optional compact answer derived from current observation summary.',
        optional: true,
      },
      locate: input.ports.locate,
      execute: input.ports.execute,
      verify: input.ports.verify,
      writeTrace: input.ports.writeTrace ?? {
        provider: computerUseHostPortProviderIds.writeTrace,
        storagePolicy: computerUseTraceHandoffContract.storagePolicy,
        optional: true,
      },
      emitEvent: input.ports.emitEvent ?? {
        provider: computerUseHostPortProviderIds.emitEvent,
        optional: true,
      },
    },
    requiredPorts: computerUseHostPortLists.required,
    optionalPorts: computerUseHostPortLists.optional,
    forbiddenPorts: computerUseHostPortLists.forbidden,
    approvalBoundary: {
      policy: 'refs-first-approval-sidecars-only',
      forbiddenHostPorts: computerUseHostPortLists.forbidden,
      packageMayReturn: [
        'needs-confirmation',
        'approvalRequestRef',
        'draftRef',
        'auditRef',
        'riskAuditRef',
        'approvalRequestSidecarRef',
      ],
      hostContinuationRequires: ['approvalRef', 'approvalSidecarRefs', 'riskActionHash'],
    },
    adapterBoundary: {
      packageOwns: 'host-port-contract',
      hostInjects: ['workspace-context', 'session-context', 'callbacks', 'presentation-events'],
      packageForbiddenImports: ['src/ui/**', 'runtime-gui/**'],
      reusableBy: ['codex-cli-plugin', 'sciforge-runtime'],
    },
    traceHandoff: computerUseTraceHandoffContract,
    guiBoundary: 'TUI Host may transform refs-first package results into presentation events; package host ports must not call GUI or request approval.',
  };
  const violations = computerUseHostPortsContractViolations(contract);
  if (violations.length > 0) {
    throw new Error(`Invalid Computer Use host ports contract: ${violations.join('; ')}`);
  }
  return contract;
}

export function computerUseHostPortsContractViolations(contract: {
  ports: Record<string, unknown>;
  forbiddenPorts: readonly string[];
  approvalBoundary: {
    policy: string;
    forbiddenHostPorts: readonly string[];
  };
}) {
  const portNames = Object.keys(contract.ports);
  const forbiddenPorts = new Set<string>(contract.forbiddenPorts);
  const forbiddenDeclared = portNames.filter((port) => forbiddenPorts.has(port));
  const approvalForbiddenPorts = new Set<string>(contract.approvalBoundary.forbiddenHostPorts);
  const approvalLeakPorts = portNames.filter((port) => approvalForbiddenPorts.has(port));
  return [
    ...forbiddenDeclared.map((port) => `forbidden host port declared: ${port}`),
    ...approvalLeakPorts.map((port) => `approval boundary leaks forbidden host port: ${port}`),
    contract.approvalBoundary.policy === 'refs-first-approval-sidecars-only'
      ? undefined
      : 'high-risk approval boundary must be refs-first sidecars only',
  ].filter((item): item is string => Boolean(item));
}

export function isComputerUseForbiddenHostPortName(port: string): port is (typeof computerUseHostAdapterForbiddenPorts)[number] {
  return (computerUseHostAdapterForbiddenPorts as readonly string[]).includes(port);
}

function firstString(...values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0);
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function definedStringFields<T extends Record<string, string | undefined>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ) as Partial<T>;
}
