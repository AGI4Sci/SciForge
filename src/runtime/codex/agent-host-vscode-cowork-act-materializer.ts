import {
  createVSCodeCoWorkChatBridge,
} from './vscode-cowork-chat-bridge.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostComputerUseActMaterializerInput,
  CodexAgentHostComputerUseActMaterializerResult,
} from './agent-host-turn-loop.js';

const TOOL_ID = 'vscode-cowork.agent-host-producer';

type VSCodeCoWorkRuntimeIntent = {
  schemaVersion: 'sciforge.runtime-codex.host-intent.v1';
  kind: 'computer-use-native-route';
  source: 'host-owned';
  computerUseNext: {
    taskId: 'CU-NEXT-09';
    recommendedTargetMode: 'active-window';
    recommendedTargetApp: 'Visual Studio Code';
    semanticMarkers: ['current-vscode-cowork', 'refs-first'];
  };
  vscodeCoWork: Record<string, unknown>;
};

export function createDefaultVSCodeCoWorkComputerUseActMaterializer(): CodexAgentHostComputerUseActMaterializer {
  return async (input) => {
    const runtimeIntent = vscodeCoWorkRuntimeIntentFromHostRefs(input);
    if (!runtimeIntent) return undefined;
    const bridge = createVSCodeCoWorkChatBridge({
      runtimeIntent,
      commandId: input.commandId,
      attemptId: input.attemptId,
    });
    if (!bridge) {
      return blockedResult(input, 'VSCode co-work Host producer blocked: refs-first runtime intent was not accepted by the co-work bridge.', [
        'runtime-truth:vscode-cowork/host-intent-rejected',
      ]);
    }
    const decision = bridge.decision;
    const refs = runtimeOwnedVSCodeRefs([
      ...decision.refs,
      `runtime-truth:vscode-cowork/host-producer/${safeToken(input.commandId) || 'command'}/${safeToken(input.attemptId) || 'attempt'}`,
    ]);

    if (decision.status === 'ready' && decision.primitive === 'observe') {
      return {
        status: 'completed',
        message: 'VSCode co-work Host producer selected a refs-only observe primitive from current observe refs.',
        confidence: 0.78,
        claimType: 'computer-use-vscode-cowork-observe-decision',
        reasoningTrace: 'Agent Host consumed current VSCode observe refs and selected one refs-first primitive; Computer Use core did not plan the task.',
        evidenceRefs: refs,
        executionUnits: [{
          id: `EU-vscode-cowork-host-producer-${safeToken(input.attemptId) || 'attempt'}`,
          tool: TOOL_ID,
          status: 'done',
          primitive: 'observe',
          targetWindowRef: decision.targetWindowRef,
          outputRef: firstRefWithPrefix(refs, ['observation:']) ?? refs[0],
          hash: safeToken(input.attemptId) || 'vscode-cowork-host-producer',
        }],
        artifacts: [decisionArtifact(input, decision.status, refs, {
          primitive: decision.primitive,
          targetWindowRef: decision.targetWindowRef,
        })],
        claims: [{
          id: `claim-vscode-cowork-host-producer-${safeToken(input.attemptId) || 'attempt'}`,
          type: 'runtime-action',
          text: 'Agent Host selected one current VSCode co-work observe primitive from refs-first evidence.',
          confidence: 0.78,
          evidenceLevel: 'runtime',
          supportingRefs: refs.slice(0, 12),
          opposingRefs: [],
        }],
        completionTruth: {
          schemaVersion: 'sciforge.computer-use.completion-truth.v1',
          scope: 'action',
          status: 'satisfied',
          validator: 'vscode-cowork-host-producer',
          evidenceRefs: refs,
        },
      };
    }

    if (decision.status === 'needs-confirmation') {
      return {
        status: 'needs-confirmation',
        message: decision.blockedReason ?? 'VSCode co-work Host producer needs target confirmation before selecting a primitive.',
        confidence: 0.72,
        claimType: 'computer-use-vscode-cowork-needs-confirmation',
        reasoningTrace: 'Agent Host stopped current VSCode co-work because observe refs did not identify one unambiguous target.',
        evidenceRefs: refs,
        executionUnits: [executionUnit(input, 'needs-confirmation', refs, decision.primitive)],
        artifacts: [decisionArtifact(input, decision.status, refs, {
          primitive: decision.primitive,
          targetWindowRef: decision.targetWindowRef,
          blockedReason: decision.blockedReason,
        })],
      };
    }

    if (decision.status === 'ready' && decision.primitive === 'act') {
      return {
        status: 'completed',
        message: 'VSCode co-work Host producer selected one refs-first act primitive from current observe refs.',
        confidence: 0.76,
        claimType: 'computer-use-vscode-cowork-act-decision',
        reasoningTrace: 'Agent Host consumed current VSCode observe refs and selected one refs-first atomic action; Computer Use core did not plan the task.',
        evidenceRefs: refs,
        executionUnits: [{
          id: `EU-vscode-cowork-host-producer-${safeToken(input.attemptId) || 'attempt'}`,
          tool: TOOL_ID,
          status: 'done',
          primitive: 'act',
          targetWindowRef: decision.targetWindowRef,
          action: decision.action,
          outputRef: firstRefWithPrefix(refs, ['action:', 'text-ref:', 'observation:']) ?? refs[0],
          hash: safeToken(input.attemptId) || 'vscode-cowork-host-producer',
        }],
        artifacts: [decisionArtifact(input, decision.status, refs, {
          primitive: decision.primitive,
          targetWindowRef: decision.targetWindowRef,
          action: decision.action,
        })],
        claims: [{
          id: `claim-vscode-cowork-host-producer-${safeToken(input.attemptId) || 'attempt'}`,
          type: 'runtime-action',
          text: 'Agent Host selected one current VSCode co-work act primitive from refs-first evidence.',
          confidence: 0.76,
          evidenceLevel: 'runtime',
          supportingRefs: refs.slice(0, 12),
          opposingRefs: [],
        }],
        completionTruth: {
          schemaVersion: 'sciforge.computer-use.completion-truth.v1',
          scope: 'action',
          status: 'satisfied',
          validator: 'vscode-cowork-host-producer',
          evidenceRefs: refs,
        },
      };
    }

    return blockedResult(input, decision.blockedReason ?? 'VSCode co-work Host producer blocked on refs-first target or observation evidence.', refs);
  };
}

function vscodeCoWorkRuntimeIntentFromHostRefs(input: CodexAgentHostComputerUseActMaterializerInput): VSCodeCoWorkRuntimeIntent | undefined {
  const hostInput = input.agentHostInput;
  const target = isRecord(hostInput.target) ? hostInput.target : {};
  const explicitVSCodeCoWork = isRecord(target.vscodeCoWork) ? target.vscodeCoWork : {};
  const currentVSCode = stringField(target.kind) === 'current-vscode-cowork'
    || hostInput.refs.includes('intent:current-vscode-cowork')
    || refsFrom(input).some((ref) => ref === 'intent:current-vscode-cowork');
  if (!currentVSCode) return undefined;

  const requestRef = firstRefWithPrefix(refsFrom(input), ['chat-request:'])
    ?? `chat-request:vscode-cowork:${safeToken(input.commandId) || 'command'}:${safeToken(input.attemptId) || 'attempt'}`;
  const targetRefs = runtimeOwnedVSCodeRefs([
    ...stringList(target.refs),
    ...(input.runtimeTruth?.target?.refs ?? []),
  ]);
  const observationRefs = runtimeOwnedVSCodeRefs([
    ...stringList(hostInput.observation.refs),
    ...(input.runtimeTruth?.observation?.refs ?? []),
  ]);
  const windowRefs = refsWithPrefix(targetRefs, ['window:']);
  const selectedWindowRef = selectedWindowRefFromTargetAndObservation(windowRefs, observationRefs);
  const appRef = firstRefWithPrefix(targetRefs, ['macos-app:']);
  const visibleFileRefs = uniqueStrings([
    ...refsWithPrefix(targetRefs, ['file-ref:']),
    ...refsWithPrefix(observationRefs, ['file-ref:']),
  ]);
  const windowCandidates = windowRefs.map((windowRef) => windowCandidate(windowRef, targetRefs, appRef, visibleFileRefs));
  const latestObservation = latestObservationFromRefs(observationRefs, selectedWindowRef ?? windowRefs[0], hostInput.observation, input.runtimeTruth?.observation);
  const permissionRef = firstRefWithPrefix([
    ...stringList(hostInput.permissions.refs),
    ...(input.runtimeTruth?.permissions?.refs ?? []),
  ], ['permission:']);
  const draftTextRef = firstRefWithPrefix([
    ...stringList(explicitVSCodeCoWork.refs),
    ...stringList(hostInput.refs),
    ...(input.runtimeTruth?.refs ?? []),
  ], ['text-ref:']);

  return {
    schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
    kind: 'computer-use-native-route',
    source: 'host-owned',
    computerUseNext: {
      taskId: 'CU-NEXT-09',
      recommendedTargetMode: 'active-window',
      recommendedTargetApp: 'Visual Studio Code',
      semanticMarkers: ['current-vscode-cowork', 'refs-first'],
    },
    vscodeCoWork: compactRecord({
      requestRef,
      operation: vscodeCoWorkOperationField(explicitVSCodeCoWork.operation)
        ?? vscodeCoWorkOperationFromText(hostInput.intentText ?? input.commandText),
      selectedWindowRef,
      selectedFileRef: visibleFileRefs.length === 1 ? visibleFileRefs[0] : undefined,
      windowCandidates,
      latestObservation,
      draftTextRef,
      permissionRef,
    }),
  };
}

function windowCandidate(
  windowRef: string,
  refs: string[],
  appRef: string | undefined,
  visibleFileRefs: string[],
) {
  const tail = refTail(windowRef);
  return compactRecord({
    appRef,
    processRef: firstRefMatchingTail(refs, ['process:'], tail),
    windowRef,
    titleRef: firstRefMatchingTail(refs, ['text:', 'window:'], tail),
    frontmostRef: firstRefMatchingTail(refs, ['frontmost:', 'window:'], tail),
    visibleFileRefs: visibleFileRefs.length ? visibleFileRefs : undefined,
  });
}

function latestObservationFromRefs(
  refs: string[],
  selectedWindowRef: string | undefined,
  agentObservation: Record<string, unknown>,
  runtimeObservation: Record<string, unknown> | undefined,
) {
  const windowRef = firstRefWithPrefix(refs, ['window:']) ?? selectedWindowRef;
  if (!windowRef) return undefined;
  const elementRefs = refsWithPrefix(refs, ['element:']);
  return compactRecord({
    windowRef,
    sessionRef: firstRefWithPrefix(refs, ['window-action-session:', 'computer-use-session:']),
    observationRef: firstRefWithPrefix(refs, ['observation:']),
    screenshotRef: firstRefWithPrefix(refs, ['image:']),
    accessibilityRef: firstRefWithPrefix(refs, ['accessibility:']),
    textRefs: refsWithPrefix(refs, ['text:']),
    elementRefs,
    focusedEditorRef: firstRefWithPrefix(refs, ['focused-editor:']),
    freshnessRef: firstRefWithPrefix(refs, ['freshness:']),
    stale: agentObservation.fresh === false || runtimeObservation?.fresh === false ? true : undefined,
    editorVisible: elementRefs.some((ref) => /editor/i.test(ref)) ? true : undefined,
    visibleFileRefs: refsWithPrefix(refs, ['file-ref:']),
  });
}

function selectedWindowRefFromTargetAndObservation(windowRefs: string[], observationRefs: string[]): string | undefined {
  if (windowRefs.length === 1) return windowRefs[0];
  const observationWindowRefs = refsWithPrefix(observationRefs, ['window:']).filter((ref) => windowRefs.includes(ref));
  if (observationWindowRefs.length === 1) return observationWindowRefs[0];
  if (observationWindowRefs.length > 1) return undefined;
  const frontmostRefs = refsWithPrefix(observationRefs, ['frontmost:']);
  if (frontmostRefs.length === 1) {
    const tail = refTail(frontmostRefs[0]);
    return windowRefs.find((ref) => refTail(ref) === tail);
  }
  return undefined;
}

function decisionArtifact(
  input: CodexAgentHostComputerUseActMaterializerInput,
  status: string,
  refs: string[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: `vscode-cowork-host-decision-${safeToken(input.attemptId) || 'attempt'}`,
    type: 'computer-use-vscode-cowork-host-decision',
    metadata: {
      source: TOOL_ID,
      status,
      maturity: 'live-diagnostic',
      productReady: false,
    },
    data: {
      schemaVersion: 'sciforge.computer-use.vscode-cowork-host-producer.v1',
      hostOwnsNextPrimitive: true,
      computerUseCorePlanning: false,
      evidenceRefs: refs.slice(0, 16),
      ...data,
    },
  };
}

function executionUnit(
  input: CodexAgentHostComputerUseActMaterializerInput,
  status: 'needs-confirmation' | 'blocked',
  refs: string[],
  primitive: string | undefined,
): Record<string, unknown> {
  return {
    id: `EU-vscode-cowork-host-producer-${safeToken(input.attemptId) || 'attempt'}`,
    tool: TOOL_ID,
    status,
    primitive,
    outputRef: refs[0],
    hash: safeToken(input.attemptId) || 'vscode-cowork-host-producer',
  };
}

function blockedResult(
  input: CodexAgentHostComputerUseActMaterializerInput,
  message: string,
  refs: string[],
): CodexAgentHostComputerUseActMaterializerResult {
  const evidenceRefs = runtimeOwnedVSCodeRefs(refs);
  return {
    status: 'blocked',
    message,
    confidence: 0.68,
    claimType: 'computer-use-vscode-cowork-diagnostic',
    reasoningTrace: 'Agent Host failed closed before VSCode co-work primitive execution; Computer Use core did not plan the task.',
    evidenceRefs: evidenceRefs.length ? evidenceRefs : ['runtime-truth:vscode-cowork/blocked'],
    executionUnits: [executionUnit(input, 'blocked', evidenceRefs, undefined)],
    artifacts: [decisionArtifact(input, 'blocked', evidenceRefs, { blockedReason: message })],
  };
}

function vscodeCoWorkOperationField(value: unknown): 'read-visible-text' | 'focus-editor' | 'insert-draft' | undefined {
  return value === 'read-visible-text' || value === 'focus-editor' || value === 'insert-draft'
    ? value
    : undefined;
}

function vscodeCoWorkOperationFromText(value: string): 'read-visible-text' | 'focus-editor' | 'insert-draft' | undefined {
  if (/(?:插入|写入草稿|插入草稿|insert(?:\s+draft)?|draft)/i.test(value)) return 'insert-draft';
  if (/(?:读取|查看|看看|read|visible\s+text)/i.test(value)) return 'read-visible-text';
  if (/(?:聚焦|focus)/i.test(value)) return 'focus-editor';
  return undefined;
}

function refsFrom(input: CodexAgentHostComputerUseActMaterializerInput): string[] {
  return [
    ...input.agentHostInput.refs,
    ...(input.runtimeTruth?.refs ?? []),
  ];
}

function runtimeOwnedVSCodeRefs(refs: Array<string | undefined>): string[] {
  return uniqueStrings(refs.filter((ref): ref is string => typeof ref === 'string' && safeVSCodeCoWorkRef(ref))).slice(0, 64);
}

function safeVSCodeCoWorkRef(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:|history:)/i.test(text)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)/i.test(text)) return false;
  return /^(?:runtime-truth:|intent:|chat-request:|macos-app:|process:|window:|frontmost:|file-ref:|text:|text-ref:|image:|accessibility:|element:|focused-editor:|freshness:|observation:|window-action-session:|computer-use-session:|computer-use:|permission:|risk:|approval:|non-user-file-scope:|cursor-move:|selection-ref:|action:|executor-event:|input-event:|input-lease:|lease:|action-ledger:|adapter-registry:|actor-cursor:|cursor-marker:|scoped-input-lease:|scoped-input-adapter:|focus-lease:|stale-invalidation:|cancel:|stop:)/i.test(text);
}

function refsWithPrefix(refs: string[], prefixes: string[]): string[] {
  return uniqueStrings(refs.filter((ref) => prefixes.some((prefix) => ref.startsWith(prefix))));
}

function firstRefWithPrefix(refs: string[], prefixes: string[]): string | undefined {
  return refs.find((ref) => prefixes.some((prefix) => ref.startsWith(prefix)));
}

function firstRefMatchingTail(refs: string[], prefixes: string[], tail: string): string | undefined {
  const matching = refs.filter((ref) => prefixes.some((prefix) => ref.startsWith(prefix)));
  return matching.find((ref) => refTail(ref) === tail)
    ?? matching.find((ref) => ref.split(':').at(-1) === tail.split(':').at(-1))
    ?? (matching.length === 1 ? matching[0] : undefined);
}

function refTail(ref: string): string {
  return ref.split(':').slice(1).join(':');
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && !(Array.isArray(entry) && entry.length === 0)),
  ) as T;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeToken(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80)
    : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
