import {
  moduleIntent,
  type ModuleDescription,
  type ModuleFunctionName,
  type ModuleSideEffect,
} from '../../../packages/contracts/runtime/modules.js';
import type { CodexAgentHostRuntimeTruth } from './agent-host-grounding.js';

export type AgentHostLocalToolActStatus = 'auto' | 'needs-confirmation' | 'blocked';

export interface AgentHostLocalToolActDecision {
  status: AgentHostLocalToolActStatus;
  reason: string;
  toolName: string;
  moduleId?: string;
  functionName?: ModuleFunctionName;
  intent?: string;
  sideEffect?: ModuleSideEffect;
  evidenceRefs: string[];
  approvalRequest?: {
    moduleId: string;
    intent: string;
    sideEffect: ModuleSideEffect;
    reason: string;
  };
}

export interface AgentHostLocalToolActInput {
  toolName: string;
  args?: Record<string, unknown>;
  moduleDescription?: ModuleDescription;
  runtimeTruth?: CodexAgentHostRuntimeTruth;
  commandId?: string;
  attemptId?: string;
}

const POLICY_REF_PREFIX = 'runtime-truth:local-tool-act-policy';

export function evaluateAgentHostLocalToolAct(input: AgentHostLocalToolActInput): AgentHostLocalToolActDecision {
  const toolName = safeToolName(input.toolName);
  const args = input.args ?? {};
  const moduleId = stringField(args.moduleId) ?? stringField(args.module_id) ?? input.moduleDescription?.moduleId;
  const functionName = localToolFunctionName(toolName);
  const evidenceRefs = baseEvidenceRefs(input, args);

  if (!functionName) {
    return blocked(input, {
      reason: `Unsupported local tool "${toolName}" is blocked by Agent Host local tool Act policy.`,
      evidenceRefs,
    });
  }

  if (functionName === 'describe' || functionName === 'query' || functionName === 'read') {
    return {
      status: 'auto',
      reason: `${functionName} is read-only and may run under Agent Host local tool Act policy.`,
      toolName,
      moduleId,
      functionName,
      evidenceRefs,
    };
  }

  if (!moduleId) {
    return blocked(input, {
      reason: 'module.invoke is blocked because moduleId is missing.',
      functionName,
      evidenceRefs,
    });
  }
  const intentName = stringField(args.intent);
  if (!intentName) {
    return blocked(input, {
      reason: 'module.invoke is blocked because intent is missing.',
      moduleId,
      functionName,
      evidenceRefs,
    });
  }
  if (moduleId === 'actions' && intentName === 'execute') {
    return blocked(input, {
      reason: 'actions.execute is blocked in the generic local tool path; Computer Use execution must enter the Agent Host Computer Use Guard and runtime-owned Act materializer.',
      moduleId,
      functionName,
      intent: intentName,
      sideEffect: 'workspace',
      evidenceRefs,
    });
  }
  const description = input.moduleDescription;
  const intent = description ? moduleIntent(description, intentName) : undefined;
  if (!intent) {
    return blocked(input, {
      reason: `module.invoke intent "${intentName}" is blocked because the module description does not declare it.`,
      moduleId,
      functionName,
      intent: intentName,
      evidenceRefs,
    });
  }
  const approvalToken = safeApprovalToken(args.approvalToken);
  const sideEffect = intent.sideEffect;
  if (sideEffect === 'none' && intent.requiresApproval !== true) {
    return {
      status: 'auto',
      reason: `module.invoke ${moduleId}.${intentName} has no declared side effect.`,
      toolName,
      moduleId,
      functionName,
      intent: intentName,
      sideEffect,
      evidenceRefs,
    };
  }
  if (!approvalToken && (intent.requiresApproval === true || sideEffect !== 'none')) {
    return {
      status: 'needs-confirmation',
      reason: `module.invoke ${moduleId}.${intentName} requires approval before ${sideEffect} side effects.`,
      toolName,
      moduleId,
      functionName,
      intent: intentName,
      sideEffect,
      evidenceRefs,
      approvalRequest: {
        moduleId,
        intent: intentName,
        sideEffect,
        reason: 'approval_required',
      },
    };
  }
  if (!runtimeControlPathReady(input.runtimeTruth)) {
    return blocked(input, {
      reason: `module.invoke ${moduleId}.${intentName} is blocked because approved side effects require a runtime-owned stop/cancel or human takeover control path.`,
      moduleId,
      functionName,
      intent: intentName,
      sideEffect,
      evidenceRefs,
    });
  }
  return {
    status: 'auto',
    reason: `module.invoke ${moduleId}.${intentName} is approved and has a runtime-owned control path.`,
    toolName,
    moduleId,
    functionName,
    intent: intentName,
    sideEffect,
    evidenceRefs: uniqueStrings([...evidenceRefs, ...runtimeControlEvidenceRefs(input.runtimeTruth)]),
  };
}

function blocked(
  input: AgentHostLocalToolActInput,
  fields: {
    reason: string;
    moduleId?: string;
    functionName?: ModuleFunctionName;
    intent?: string;
    sideEffect?: ModuleSideEffect;
    evidenceRefs: string[];
  },
): AgentHostLocalToolActDecision {
  return {
    status: 'blocked',
    reason: fields.reason,
    toolName: safeToolName(input.toolName),
    ...(fields.moduleId ? { moduleId: fields.moduleId } : {}),
    ...(fields.functionName ? { functionName: fields.functionName } : {}),
    ...(fields.intent ? { intent: fields.intent } : {}),
    ...(fields.sideEffect ? { sideEffect: fields.sideEffect } : {}),
    evidenceRefs: fields.evidenceRefs,
  };
}

function localToolFunctionName(toolName: string): ModuleFunctionName | undefined {
  if (toolName === 'module.describe') return 'describe';
  if (toolName === 'module.query') return 'query';
  if (toolName === 'module.read') return 'read';
  if (toolName === 'module.invoke') return 'invoke';
  return undefined;
}

function baseEvidenceRefs(input: AgentHostLocalToolActInput, args: Record<string, unknown>): string[] {
  return uniqueStrings([
    `${POLICY_REF_PREFIX}/${safeRefPart(input.commandId ?? 'codex-command-local-tool')}/${safeRefPart(input.attemptId ?? 'attempt-1')}`,
    ...stringList(args.evidenceRefs).filter(runtimeOwnedLocalToolRef),
    ...stringList(args.refs).filter(runtimeOwnedLocalToolRef),
    ...stringList(input.runtimeTruth?.permissions?.refs).filter(runtimeOwnedLocalToolRef),
  ]);
}

function runtimeControlPathReady(runtimeTruth: CodexAgentHostRuntimeTruth | undefined): boolean {
  if (runtimeTruth?.permissions?.stopCancelPath !== true) return false;
  const controlPath = runtimeTruth.permissions.controlPath;
  if (!controlPath) return true;
  if (controlPath.ready !== true) return false;
  return runtimeControlEvidenceRefs(runtimeTruth).length > 0;
}

function runtimeControlEvidenceRefs(runtimeTruth: CodexAgentHostRuntimeTruth | undefined): string[] {
  const controlPath = runtimeTruth?.permissions?.controlPath;
  if (!controlPath) return [];
  return uniqueStrings([
    ...controlPath.takeoverRefs,
    ...controlPath.pauseRefs,
    ...controlPath.resumeRefs,
    ...controlPath.stopRefs,
    ...controlPath.cancelRefs,
  ].filter(runtimeOwnedLocalToolRef));
}

function runtimeOwnedLocalToolRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:|history:)/i.test(trimmed)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(trimmed)) return false;
  if (/^\.sciforge\/vision-runs\/[A-Za-z0-9._/-]+$/u.test(trimmed) && !trimmed.includes('..')) return true;
  return /^(?:runtime-truth:|permission:|cancel:|stop:|lease:|module:|memory:|files:|automations:|capability:|browser:|verifier:|artifact:|action:|computer-use:|evidence:|workEvidence:|audit:)/i.test(trimmed);
}

function safeToolName(value: unknown): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
  if (!/^[A-Za-z0-9_.:-]+$/u.test(text)) return 'unknown';
  return text.slice(0, 120);
}

function safeApprovalToken(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? 'present' : undefined;
}

function safeRefPart(value: unknown): string {
  const text = typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
  return text.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'unknown';
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 24);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
