import {
  computerUseHostPortLists,
  computerUseHostPortProviderIds,
  computerUseHostPortsContractIds,
  computerUseTraceHandoffContract,
  type ComputerUseHostPortName,
} from './provider-policy.js';

export const computerUseActionProviderContractIds = {
  actionProviderId: 'action.sciforge.computer-use',
  requestSchema: 'sciforge.computer-use.request.v1',
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
