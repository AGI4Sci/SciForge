export type ComputerUseAppModuleReadinessStatus = 'ready' | 'blocked' | 'needs-confirmation';

export interface ComputerUseAppModuleResolveInput {
  refs: string[];
}

export interface ComputerUseAppModuleObservationInput {
  refs: string[];
}

export interface ComputerUseAppModuleObservation {
  refs: string[];
}

export interface ComputerUseAppModuleReadinessInput {
  operation: string;
  refs: string[];
}

export interface ComputerUseAppModulePrimitiveCandidate {
  name: 'computer_use.bind' | 'computer_use.observe' | 'computer_use.act' | 'computer_use.run_procedure' | 'computer_use.control';
  inputRefs: string[];
  action?: unknown;
}

export type ComputerUseAppModuleReadiness =
  | {
    status: 'ready';
    primitive: ComputerUseAppModulePrimitiveCandidate;
    evidenceRefs: string[];
    reasonRef?: never;
  }
  | {
    status: 'blocked' | 'needs-confirmation';
    reasonRef: string;
    evidenceRefs: string[];
    primitive?: never;
  };

export interface ComputerUseAppModule {
  moduleId: string;
  canHandle(input: ComputerUseAppModuleResolveInput): boolean;
  normalizeObservation(input: ComputerUseAppModuleObservationInput): ComputerUseAppModuleObservation;
  getCapabilities(): string[];
  checkReadiness(input: ComputerUseAppModuleReadinessInput): ComputerUseAppModuleReadiness;
}

export type ComputerUseAppModuleResolveResult =
  | {
    status: 'ready';
    module: ComputerUseAppModule;
    candidateModuleIds: string[];
  }
  | {
    status: 'blocked';
    reasonRef: string;
    candidateModuleIds: string[];
  };

export interface ComputerUseAppModuleRegistry {
  resolve(input: ComputerUseAppModuleResolveInput): ComputerUseAppModuleResolveResult;
  modules(): readonly ComputerUseAppModule[];
}

export function createComputerUseAppModuleRegistry(
  modules: readonly ComputerUseAppModule[],
): ComputerUseAppModuleRegistry {
  const registeredModules = [...modules];
  return {
    resolve(input) {
      const matches = registeredModules.filter((module) => safeCanHandle(module, input));
      if (matches.length === 1) {
        return {
          status: 'ready',
          module: matches[0],
          candidateModuleIds: [matches[0].moduleId],
        };
      }
      if (matches.length > 1) {
        return {
          status: 'blocked',
          reasonRef: 'blocked:computer-use-app-module:ambiguous-app',
          candidateModuleIds: matches.map((module) => module.moduleId),
        };
      }
      return {
        status: 'blocked',
        reasonRef: 'blocked:computer-use-app-module:unsupported-app',
        candidateModuleIds: [],
      };
    },
    modules() {
      return registeredModules;
    },
  };
}

export function validateComputerUseAppModuleReadiness(
  readiness: ComputerUseAppModuleReadiness | Record<string, unknown>,
): ComputerUseAppModuleReadiness {
  if (!isRecord(readiness)) {
    return blocked('blocked:computer-use-app-module:readiness-invalid');
  }
  if (hasForbiddenFinalAnswerField(readiness)) {
    return blocked('blocked:computer-use-app-module:final-answer-not-allowed', safeStringList(readiness.evidenceRefs));
  }
  if (readiness.status === 'ready') {
    const primitive = isRecord(readiness.primitive) ? readiness.primitive : undefined;
    const name = typeof primitive?.name === 'string' ? primitive.name : undefined;
    const inputRefs = safeStringList(primitive?.inputRefs);
    const evidenceRefs = safeStringList(readiness.evidenceRefs);
    if (!primitive || !isPrimitiveName(name)) {
      return blocked('blocked:computer-use-app-module:primitive-invalid', evidenceRefs);
    }
    if (containsRawRef([...inputRefs, ...evidenceRefs])) {
      return blocked('blocked:computer-use-app-module:raw-ref-not-allowed', evidenceRefs);
    }
    const action = Object.hasOwn(primitive, 'action') ? primitive.action : undefined;
    if (hasForbiddenFinalAnswerFieldDeep(action)) {
      return blocked('blocked:computer-use-app-module:final-answer-not-allowed', evidenceRefs);
    }
    if (containsRawPayloadString(action)) {
      return blocked('blocked:computer-use-app-module:raw-ref-not-allowed', evidenceRefs);
    }
    return {
      status: 'ready',
      primitive: {
        name,
        inputRefs,
        ...(Object.hasOwn(primitive, 'action') ? { action: primitive.action } : {}),
      },
      evidenceRefs,
    };
  }
  if (readiness.status === 'blocked' || readiness.status === 'needs-confirmation') {
    const evidenceRefs = safeStringList(readiness.evidenceRefs);
    if (containsRawRef(evidenceRefs)) {
      return blocked('blocked:computer-use-app-module:raw-ref-not-allowed');
    }
    return {
      status: readiness.status,
      reasonRef: typeof readiness.reasonRef === 'string' && readiness.reasonRef ? readiness.reasonRef : 'blocked:computer-use-app-module:reason-ref-required',
      evidenceRefs,
    };
  }
  return blocked('blocked:computer-use-app-module:readiness-status-invalid');
}

function safeCanHandle(module: ComputerUseAppModule, input: ComputerUseAppModuleResolveInput): boolean {
  try {
    return module.canHandle({ refs: [...input.refs] }) === true;
  } catch {
    return false;
  }
}

function blocked(reasonRef: string, evidenceRefs: string[] = []): ComputerUseAppModuleReadiness {
  return {
    status: 'blocked',
    reasonRef,
    evidenceRefs,
  };
}

function hasForbiddenFinalAnswerField(value: Record<string, unknown>): boolean {
  return Object.hasOwn(value, 'finalAnswer')
    || Object.hasOwn(value, 'answer')
    || Object.hasOwn(value, 'message')
    || Object.hasOwn(value, 'completionTruth');
}

function hasForbiddenFinalAnswerFieldDeep(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasForbiddenFinalAnswerFieldDeep);
  }
  if (!isRecord(value)) {
    return false;
  }
  if (hasForbiddenFinalAnswerField(value)) {
    return true;
  }
  return Object.values(value).some(hasForbiddenFinalAnswerFieldDeep);
}

function containsRawRef(refs: string[]): boolean {
  return refs.some((ref) => /(^|:)raw[-:]|base64|data:image|providerPayload|provider-payload|screenshot-path|file:\/\/|https?:\/\//i.test(ref));
}

function containsRawPayloadString(value: unknown): boolean {
  if (typeof value === 'string') {
    return containsRawRef([value]);
  }
  if (Array.isArray(value)) {
    return value.some(containsRawPayloadString);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).some(containsRawPayloadString);
}

function safeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function isPrimitiveName(value: string | undefined): value is ComputerUseAppModulePrimitiveCandidate['name'] {
  return value === 'computer_use.bind'
    || value === 'computer_use.observe'
    || value === 'computer_use.act'
    || value === 'computer_use.run_procedure'
    || value === 'computer_use.control';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
