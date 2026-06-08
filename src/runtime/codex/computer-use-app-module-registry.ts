import { publicEventHasForbiddenRaw } from '@sciforge-ui/runtime-contract/public-event-sanitizer';

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
  operationRef?: string;
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
      const identityRefs = appModuleIdentityRefs(input.refs);
      if (identityRefs.length === 0) {
        return {
          status: 'blocked',
          reasonRef: 'blocked:computer-use-app-module:unsupported-app',
          candidateModuleIds: [],
        };
      }
      const identityInput = { refs: identityRefs };
      const matches = registeredModules.filter((module) => safeCanHandle(module, identityInput));
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

function appModuleIdentityRefs(refs: string[]): string[] {
  return uniqueStrings(refs.filter((ref) =>
    ref.startsWith('macos-app:')
    || ref.startsWith('app:')
    || ref.startsWith('process:')
    || ref.startsWith('window:')
  ));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function validateComputerUseAppModuleReadiness(
  readiness: ComputerUseAppModuleReadiness | Record<string, unknown>,
): ComputerUseAppModuleReadiness {
  if (!isRecord(readiness)) {
    return blocked('blocked:computer-use-app-module:readiness-invalid');
  }
  if (hasForbiddenFinalAnswerFieldDeep(readiness)) {
    return blocked('blocked:computer-use-app-module:final-answer-not-allowed', safeStringList(readiness.evidenceRefs));
  }
  if (containsRawPayload(readiness) || publicEventHasForbiddenRaw(readiness)) {
    return blocked('blocked:computer-use-app-module:raw-ref-not-allowed', safeStringList(readiness.evidenceRefs));
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
  return Object.keys(value).some((key) =>
    FORBIDDEN_FINAL_ANSWER_KEYS.has(normalizeReadinessKey(key)),
  );
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

function containsRawPayload(value: unknown): boolean {
  if (typeof value === 'string') {
    return isForbiddenRawPayloadString(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsRawPayload);
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (isForbiddenRawPayloadKey(key)) return true;
    if (containsRawPayload(nested)) return true;
  }
  return false;
}

function isForbiddenRawPayloadKey(key: string): boolean {
  return FORBIDDEN_RAW_PAYLOAD_KEYS.has(normalizeReadinessKey(key));
}

const FORBIDDEN_FINAL_ANSWER_KEYS = new Set([
  'finalanswer',
  'answer',
  'message',
  'completiontruth',
]);

const FORBIDDEN_RAW_PAYLOAD_KEYS = new Set([
  'raw',
  'rawscreenshot',
  'rawimage',
  'rawpayload',
  'rawproviderpayload',
  'rawaccessibilitytree',
  'rawaxtree',
  'rawvisibletext',
  'rawcommand',
  'rawpath',
  'providerpayload',
  'providerrawpayload',
  'providerrequestbody',
  'providerresponsebody',
  'dataurl',
  'imagebase64',
  'screenshotbase64',
  'screenshotpath',
  'rawscreenshotpath',
  'url',
  'href',
  'base64',
  'bytes',
  'buffer',
  'accessibilitytree',
  'axtree',
  'visibletext',
]);

function normalizeReadinessKey(key: string): string {
  return key.replace(/[-_\s]/g, '').toLowerCase();
}

function isForbiddenRawPayloadString(value: string): boolean {
  return containsRawRef([value])
    || looksLikeNakedBase64(value)
    || looksLikeRawMarkup(value)
    || looksLikeLocalAbsolutePath(value);
}

function looksLikeNakedBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, '');
  if (/^(?:iVBORw0KGgo|\/9j\/|R0lGODlh|R0lGODdh|UklGR)/.test(compact)) return true;
  return compact.length >= 80
    && compact.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
    && /[A-Z]/.test(compact)
    && /[a-z]/.test(compact)
    && /\d/.test(compact);
}

function looksLikeRawMarkup(value: string): boolean {
  return /<\s*(?:!doctype\s+html|html|body|head|script|style|svg|div|span|input|button|textarea|section|main)\b/i.test(value);
}

function looksLikeLocalAbsolutePath(value: string): boolean {
  return /(^|[\s"'([{<])(?:file:)?(?:(?:\/(?:Applications|Users|private|var|tmp|etc|opt|home)\/[^\s"'<>),;\]}]+)|(?:[A-Za-z]:\\[^\s"'<>),;\]}]+))/i.test(value);
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
