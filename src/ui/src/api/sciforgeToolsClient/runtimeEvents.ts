import type { AgentStreamEvent, SendAgentMessageInput } from '../../domain';
import { makeId, nowIso } from '../../domain';
import {
  TEXT_DELTA_EVENT_TYPE,
  TOOL_CALL_EVENT_TYPE,
  TOOL_RESULT_EVENT_TYPE,
  WORKSPACE_RUNTIME_EVENT_TYPE,
  compactCapabilityForBackend,
  normalizeRuntimeWorkspaceEventType,
  normalizeRuntimeCompactCapability,
  normalizeRuntimeContextCompactionStatus,
  normalizeRuntimeContextWindowSource,
  normalizeRuntimeContextWindowStatus,
  runtimeInteractionProgressPresentation,
  runtimeStreamEventLabel,
  workspaceRuntimeResultCompletion,
} from '@sciforge-ui/runtime-contract';
import { runtimeInteractionProgressEventFromCompactRecord } from '@sciforge-ui/runtime-contract/events';
import { isRuntimeAuditOnlyEvent, runtimeAuditOnlyEventSummary, runtimeTextLooksAuditOnly } from '../../runtimeAuditEvents';
import { joinAssistantTextFragments } from '../../assistantText';
import {
  COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
  COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
  COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
  computerUseControlPlaneDisplayedRefs,
  hasComputerUseControlPlanePresentation,
  normalizeComputerUseControlPlanePayload,
  type ComputerUseControlPlanePayload,
} from '../../../../../packages/presentation/components';
import { runtimeNativeMessageLiveAcceptanceEligible, runtimeNativeMessageSafeForVisibleAnswer } from './runtimeNativeMessage';

const COMPUTER_USE_VIRTUAL_SCREEN_ARTIFACT_TYPE = 'computer-use-virtual-screen';
const COMPUTER_USE_VIRTUAL_SCREEN_COMPONENT_ID = 'virtual-screen-viewer';
const COMPUTER_USE_VIRTUAL_SCREEN_SCHEMA_VERSION = 'sciforge.computer-use.virtual-screen.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asTextFragment(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length ? entries : undefined;
}

type PublicRuntimeMetadataField = 'provider' | 'model' | 'profile' | 'workspace';
type AssistantStreamTextFragment = {
  text: string;
  exact: boolean;
};
interface RuntimeActionPublicProjection {
  action?: string;
  target?: string;
  impact?: string;
  evidenceRefs?: string[];
  authorizationProfile?: string;
}

const unsafeRuntimeMetadataPattern = /\b(?:authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|credential|client[_-]?secret)\b|\b(?:sk|rk|pk)-[A-Za-z0-9._-]{8,}\b|https?:\/\/|^(?:data|blob|file|javascript):/i;
const localWorkspacePathPattern = /^(?:\/|~\/|[A-Za-z]:[\\/]|\\\\)/;

function publicRuntimeMetadataValue(value: unknown, field: PublicRuntimeMetadataField): string | undefined {
  const text = asString(value)?.trim();
  if (!text) return undefined;
  if (unsafeRuntimeMetadataPattern.test(text)) return `[redacted-${field}]`;
  if (field === 'workspace') {
    if (localWorkspacePathPattern.test(text) || /[\\/]/.test(text)) return '[redacted-workspace]';
  }
  if (field !== 'model' && /[?#]/.test(text)) return `[redacted-${field}]`;
  if (text.length > 160) return `[redacted-${field}]`;
  return text;
}

function publicRuntimeMetadataValueFrom(
  primary: unknown,
  fallback: unknown,
  field: PublicRuntimeMetadataField,
): string | undefined {
  return publicRuntimeMetadataValue(primary, field) ?? publicRuntimeMetadataValue(fallback, field);
}

export function withConfiguredContextWindowLimit(event: AgentStreamEvent, maxContextWindowTokens: number): AgentStreamEvent {
  const state = event.contextWindowState;
  if (!state || state.windowTokens !== undefined || !maxContextWindowTokens) return event;
  const ratio = state.usedTokens !== undefined ? state.usedTokens / maxContextWindowTokens : state.ratio;
  return {
    ...event,
    contextWindowState: {
      ...state,
      window: maxContextWindowTokens,
      windowTokens: maxContextWindowTokens,
      ratio,
      status: normalizeRuntimeContextWindowStatus(state.status, ratio, state.autoCompactThreshold),
    },
  };
}

export function contextWindowTelemetryEvent(
  input: SendAgentMessageInput,
  requestBodyText: string,
  detail: string,
): AgentStreamEvent {
  const rawBytes = new TextEncoder().encode(requestBodyText).length;
  const rawTokens = Math.max(1, Math.ceil(requestBodyText.length / 4));
  const windowTokens = input.config.maxContextWindowTokens || undefined;
  const ratio = windowTokens ? rawTokens / windowTokens : undefined;
  const autoCompactThreshold = 0.82;
  return {
    ...toolEvent('contextWindowState', detail),
    label: '上下文窗口',
    contextWindowState: {
      backend: input.config.agentBackend,
      provider: input.config.modelProvider,
      model: input.config.modelName,
      usedTokens: rawTokens,
      window: windowTokens,
      windowTokens,
      ratio,
      source: 'agentserver-estimate',
      status: normalizeRuntimeContextWindowStatus(undefined, ratio, autoCompactThreshold),
      compactCapability: compactCapabilityForBackend(input.config.agentBackend),
      autoCompactThreshold,
      watchThreshold: 0.68,
      nearLimitThreshold: 0.86,
      budget: {
        rawBytes,
        rawTokens,
      },
    },
  };
}

export function workspaceResultCompletion(result: Record<string, unknown>): { status: 'completed' | 'failed'; reason?: string } {
  return workspaceRuntimeResultCompletion(result);
}

export async function readWorkspaceToolStream(
  response: Response,
  onEvent: (event: unknown) => void,
): Promise<{ result?: unknown; error?: string }> {
  if (!response.body) {
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep raw text for diagnostics.
    }
    if (isRecord(json) && json.ok === true) return { result: json.result };
    return { error: isRecord(json) ? asString(json.error) || asString(json.message) : text || `HTTP ${response.status}` };
  }
  if ((response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
    return readWorkspaceToolSse(response, onEvent);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: unknown;
  let error: string | undefined;
  let guiPresent: Record<string, unknown> | undefined;
  let guiAskUser: Record<string, unknown> | undefined;
  const genericMessages: AssistantStreamTextFragment[] = [];
  const rememberGuiIntent = (event: unknown) => {
    if (!isRecord(event)) return;
    const assistantText = assistantTextFromStreamEventRecord('', event);
    if (assistantText) genericMessages.push(assistantText);
    if (event.type === 'gui_present') guiPresent = event;
    if (event.type === 'gui_ask_user') guiAskUser = event;
    const computerUseGui = guiEventsFromComputerUseTuiHostActions(event);
    if (computerUseGui.guiPresent) guiPresent = computerUseGui.guiPresent;
    if (computerUseGui.guiAskUser) guiAskUser = computerUseGui.guiAskUser;
  };
  function consumeLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    const envelope = JSON.parse(line) as unknown;
    if (!isRecord(envelope)) return;
    if ('event' in envelope) {
      rememberGuiIntent(envelope.event);
      onEvent(envelope.event);
    }
    if ('result' in envelope) result = withStreamRuntimeResult(envelope.result, guiPresent, guiAskUser, joinAssistantStreamText(genericMessages));
    if ('error' in envelope) error = asString(envelope.error) || JSON.stringify(envelope.error);
  }
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      consumeLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  result = withStreamRuntimeResult(result, guiPresent, guiAskUser, joinAssistantStreamText(genericMessages));
  return { result, error };
}

function withStreamRuntimeResult(
  result: unknown,
  guiPresent: Record<string, unknown> | undefined,
  guiAskUser: Record<string, unknown> | undefined,
  nativeMessage: string,
): unknown {
  if (guiAskUser) return withGuiAskUserRuntimeResult(result, guiAskUser, guiPresent);
  if (guiPresent) return withGuiPresentRuntimeResult(result, guiPresent);
  if (nativeMessage.trim()) return withAssistantMessageRuntimeResult(result, nativeMessage);
  return result;
}

async function readWorkspaceToolSse(
  response: Response,
  onEvent: (event: unknown) => void,
): Promise<{ result?: unknown; error?: string }> {
  if (!response.body) return { error: `HTTP ${response.status}` };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: unknown;
  let error: string | undefined;
  let guiPresent: Record<string, unknown> | undefined;
  let guiAskUser: Record<string, unknown> | undefined;
  const genericMessages: AssistantStreamTextFragment[] = [];
  function consumeBlock(block: string) {
    const lines = block.split(/\r?\n/);
    const eventName = lines
      .map((line) => /^event:\s*(.*)$/.exec(line)?.[1]?.trim())
      .find((value): value is string => Boolean(value)) ?? 'message';
    const dataText = lines
      .map((line) => /^data:\s?(.*)$/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined)
      .join('\n')
      .trim();
    if (!dataText) return;
    let data: unknown = dataText;
    try {
      data = JSON.parse(dataText) as unknown;
    } catch {
      // Keep text-only SSE data as diagnostics.
    }
    if (eventName === 'error' || eventName === 'failed') {
      error = isRecord(data) ? asString(data.error) || asString(data.message) || JSON.stringify(data) : String(data);
      onEvent(data);
      return;
    }
    onEvent(data);
    if (isRecord(data)) {
      const assistantText = assistantTextFromStreamEventRecord(eventName, data);
      if (assistantText) genericMessages.push(assistantText);
      if (eventName === 'gui_present' || data.type === 'gui_present') {
        guiPresent = data;
      }
      if (eventName === 'gui_ask_user' || data.type === 'gui_ask_user') {
        guiAskUser = data;
      }
      const computerUseGui = guiEventsFromComputerUseTuiHostActions(data);
      if (computerUseGui.guiPresent) guiPresent = computerUseGui.guiPresent;
      if (computerUseGui.guiAskUser) guiAskUser = computerUseGui.guiAskUser;
    }
    if (eventName === 'done' || (isRecord(data) && data.type === 'done')) {
      if (guiAskUser) {
        result = withGuiAskUserRuntimeResult(data, guiAskUser, guiPresent);
        return;
      }
      if (guiPresent) {
        result = withGuiPresentRuntimeResult(data, guiPresent);
        return;
      }
      if (isStructuredRuntimeDoneProjection(data)) {
        result = withStructuredRuntimeDoneProjection(data);
        return;
      }
      const nativeMessage = joinAssistantStreamText(genericMessages);
      if (nativeMessage) {
        if (!runtimeNativeMessageSafeForVisibleAnswer(nativeMessage)) {
          const failed = runtimeCodexMissingGuiPresentFailure(data);
          onEvent(failed);
          error = failed.message;
          return;
        }
        result = withAssistantMessageRuntimeResult(data, nativeMessage);
        return;
      }
      const failed = runtimeCodexMissingGuiPresentFailure(data);
      onEvent(failed);
      error = failed.message;
    }
  }
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    while (/\r?\n\r?\n/.test(buffer)) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match) break;
      consumeBlock(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
    }
    if (done) break;
  }
  if (buffer.trim()) consumeBlock(buffer);
  return { result, error };
}

function assistantTextFromStreamEventRecord(eventName: string, data: Record<string, unknown>): AssistantStreamTextFragment | undefined {
  const eventType = asString(data.type) ?? asString(data.kind) ?? eventName;
  const normalized = normalizeRuntimeWorkspaceEventType(eventType, data);
  const lowerEventName = eventName.trim().toLowerCase();
  const lowerEventType = eventType.trim().toLowerCase();
  const isAssistantText = normalized === 'text-delta'
    || normalized === 'output'
    || lowerEventName === 'message'
    || lowerEventName === 'message_delta'
    || lowerEventName === 'text-delta'
    || lowerEventName === 'text_delta';
  if (!isAssistantText) return undefined;
  const text = asTextFragment(data.text)
    ?? asTextFragment(data.delta)
    ?? asTextFragment(data.detail)
    ?? asTextFragment(data.message);
  if (text === undefined) return undefined;
  return {
    text,
    exact: normalized === 'text-delta'
      || lowerEventName === 'message_delta'
      || lowerEventName === 'text-delta'
      || lowerEventName === 'text_delta'
      || lowerEventType === 'message_delta'
      || lowerEventType === 'text-delta'
      || lowerEventType === 'text_delta',
  };
}

function joinAssistantStreamText(fragments: AssistantStreamTextFragment[]): string {
  if (!fragments.length) return '';
  if (fragments.some((fragment) => fragment.exact)) {
    return fragments.map((fragment) => fragment.text).join('');
  }
  return joinAssistantTextFragments(fragments.map((fragment) => fragment.text));
}

function withAssistantMessageRuntimeResult(result: unknown, message: string): unknown {
  if (!message.trim() || !isRecord(result)) return result;
  if (isRuntimeCodexDoneEvent(result)) {
    if (!runtimeNativeMessageSafeForVisibleAnswer(message)) return runtimeCodexMissingGuiPresentFailure(result);
    return withNativeCodexMessageRuntimeResult(result, message);
  }
  return withVisibleRuntimeMessage(result, message);
}

function withVisibleRuntimeMessage(result: unknown, message: string): unknown {
  if (!message.trim() || !isRecord(result)) return result;
  const output = isRecord(result.output) ? result.output : {};
  return {
    ...result,
    message,
    output: {
      ...output,
      message,
    },
  };
}

function withGuiPresentRuntimeResult(result: unknown, guiPresent: Record<string, unknown>): unknown {
  if (!isRecord(result)) return result;
  const presentation = guiPresentationFromEvent(guiPresent, result);
  if (!presentation.text.trim()) return result;
  const output = isRecord(result.output) ? result.output : {};
  const commandId = asString(result.commandId) ?? asString(guiPresent.commandId);
  const auditRefs = uniqueStrings([
    ...(asStringArray(result.evidenceRefs) ?? []),
    ...(asStringArray(guiPresent.evidenceRefs) ?? []),
    ...(presentation.displayedRefs ?? []),
  ]);
  const runtimeMetadata = runtimeMetadataForProjection(guiPresent, auditRefs);
  const artifactRefs = uniqueStrings([
    ...(presentation.ref ? [presentation.ref] : []),
    ...(presentation.displayedRefs ?? []),
  ]);
  const controlPlane = computerUseControlPlaneResultBundle(presentation.controlPlane, commandId);
  const virtualScreen = computerUseVirtualScreenResultBundle(presentation.virtualScreen, commandId);
  const projectedArtifactRefs = uniqueStrings([
    ...artifactRefs,
    ...(controlPlane.artifact ? [`artifact:${controlPlane.artifact.id}`] : []),
    ...(virtualScreen.artifact ? [`artifact:${virtualScreen.artifact.id}`] : []),
  ]);
  const artifacts = artifactRefs.map((ref) => ({
    ref,
    label: ref === presentation.ref ? (presentation.title ?? refLabel(ref)) : refLabel(ref),
    mime: ref === presentation.ref ? (presentation.hint ?? refMime(ref)) : refMime(ref),
  }));
  return {
    ...result,
    message: presentation.text,
    guiPresentation: presentation,
    displayIntent: {
      source: presentation.source,
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: commandId ? `runtime-codex:${commandId}` : 'runtime-codex:gui-present',
        visibleAnswer: {
          status: visibleAnswerStatusForGuiPresent(presentation),
          text: presentation.text,
          artifactRefs: projectedArtifactRefs,
        },
        artifacts: [
          ...artifacts,
          ...(controlPlane.artifact ? [{ ref: `artifact:${controlPlane.artifact.id}`, label: 'Computer Use controls', mime: COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE }] : []),
          ...(virtualScreen.artifact ? [{ ref: `artifact:${virtualScreen.artifact.id}`, label: 'Computer Use screen', mime: COMPUTER_USE_VIRTUAL_SCREEN_ARTIFACT_TYPE }] : []),
        ],
        executionProcess: [{
          eventId: `${commandId ?? 'runtime-codex'}:gui-present`,
          type: 'GuiPresent',
          summary: `Runtime Codex rendered completion through ${presentation.source}.`,
          timestamp: asString(result.timestamp) ?? new Date().toISOString(),
        }],
        recoverActions: recoverActionsForGuiPresentation(presentation),
        verificationState: { status: 'unverified', verifierRef: presentation.source },
        runtimeMetadata,
        auditRefs,
        diagnostics: [],
      },
    },
    output: {
      ...output,
      message: presentation.text,
      guiPresentation: presentation,
    },
    ...((controlPlane.artifact || virtualScreen.artifact) ? {
      artifacts: [
        ...recordList(result.artifacts),
        ...(controlPlane.artifact ? [controlPlane.artifact] : []),
        ...(virtualScreen.artifact ? [virtualScreen.artifact] : []),
      ],
      uiManifest: [
        ...recordList(result.uiManifest),
        ...(controlPlane.slot ? [controlPlane.slot] : []),
        ...(virtualScreen.slot ? [virtualScreen.slot] : []),
      ],
    } : {}),
  };
}

function isStructuredRuntimeDoneProjection(result: unknown): result is Record<string, unknown> {
  if (!isRecord(result)) return false;
  const uiManifest = recordList(result.uiManifest);
  const artifacts = recordList(result.artifacts);
  if (!uiManifest.length || !artifacts.length) return false;
  const artifactIds = new Set(artifacts.map((artifact) => asString(artifact.id)).filter((id): id is string => Boolean(id)));
  return uiManifest.some((slot) => {
    const artifactRef = asString(slot.artifactRef);
    if (!artifactRef) return false;
    return artifactIds.has(artifactRef) && artifactSafeForStructuredDoneProjection(artifacts.find((artifact) => asString(artifact.id) === artifactRef));
  });
}

function withStructuredRuntimeDoneProjection(result: Record<string, unknown>): unknown {
  const output = isRecord(result.output) ? result.output : {};
  const commandId = asString(result.commandId);
  const uiManifest = recordList(result.uiManifest);
  const artifacts = recordList(result.artifacts).filter(artifactSafeForStructuredDoneProjection);
  const artifactRefs = artifacts.map((artifact) => `artifact:${asString(artifact.id)}`);
  const auditRefs = uniqueStrings([
    ...(asStringArray(result.evidenceRefs) ?? []),
    ...artifactRefs,
  ]);
  const runtimeMetadata = runtimeMetadataForProjection(result, auditRefs);
  const message = safeSummaryText(result.message)
    ?? (artifacts.some((artifact) => artifact.type === COMPUTER_USE_VIRTUAL_SCREEN_ARTIFACT_TYPE)
      ? 'Computer Use screen artifact is available in the Screen pane.'
      : 'Runtime Codex materialized structured artifacts.');
  return {
    ...result,
    message,
    structuredRuntimeProjection: {
      schemaVersion: 'sciforge.runtime-codex-structured-done-projection.v1',
      source: commandId ? `runtime-codex:done:${commandId}` : 'runtime-codex:done',
      artifactRefs,
      uiManifestRefs: uiManifest.map((slot) => asString(slot.artifactRef)).filter((ref): ref is string => Boolean(ref)),
      failClosedRawText: true,
    },
    displayIntent: {
      source: commandId ? `runtime-codex:done:${commandId}` : 'runtime-codex:done',
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: commandId ? `runtime-codex:${commandId}` : 'runtime-codex:structured-done',
        visibleAnswer: {
          status: 'partial-ready',
          text: message,
          artifactRefs,
        },
        artifacts: artifacts.map((artifact) => ({
          ref: `artifact:${asString(artifact.id)}`,
          label: asString(isRecord(artifact.metadata) ? artifact.metadata.title : undefined) ?? asString(artifact.type) ?? 'Structured artifact',
          mime: asString(artifact.type) ?? 'artifact',
        })),
        executionProcess: [{
          eventId: `${commandId ?? 'runtime-codex'}:structured-done`,
          type: 'StructuredDoneProjection',
          summary: 'Runtime Codex completed with refs-first structured artifacts in the done payload.',
          timestamp: asString(result.timestamp) ?? new Date().toISOString(),
        }],
        recoverActions: [],
        verificationState: { status: 'unverified', verifierRef: commandId ? `runtime-codex:done:${commandId}` : 'runtime-codex:done' },
        runtimeMetadata,
        auditRefs,
        diagnostics: [],
      },
    },
    output: {
      ...output,
      message,
      structuredRuntimeProjection: true,
    },
  };
}

function withGuiAskUserRuntimeResult(
  result: unknown,
  guiAskUser: Record<string, unknown>,
  guiPresent?: Record<string, unknown>,
): unknown {
  if (!isRecord(result)) return result;
  const askUser = guiAskUserFromEvent(guiAskUser, result);
  if (!askUser.text.trim()) return result;
  const presentation = guiPresent ? guiPresentationFromEvent(guiPresent, result) : undefined;
  const output = isRecord(result.output) ? result.output : {};
  const commandId = asString(result.commandId) ?? asString(guiAskUser.commandId);
  const auditRefs = uniqueStrings([
    ...(asStringArray(result.evidenceRefs) ?? []),
    ...(asStringArray(guiAskUser.evidenceRefs) ?? []),
    ...(presentation?.displayedRefs ?? []),
    ...(askUser.relatedRefs ?? []),
  ]);
  const runtimeMetadata = runtimeMetadataForProjection(guiAskUser, auditRefs);
  const artifacts = uniqueStrings([
    ...(presentation?.ref ? [presentation.ref] : []),
    ...(presentation?.displayedRefs ?? []),
    ...(askUser.relatedRefs ?? []),
  ]).map((ref) => ({
    ref,
    label: refLabel(ref),
    mime: refMime(ref),
  }));
  const controlPlane = computerUseControlPlaneResultBundle(
    askUser.controlPlane ?? presentation?.controlPlane,
    commandId,
  );
  const virtualScreen = computerUseVirtualScreenResultBundle(presentation?.virtualScreen, commandId);
  const projectedArtifacts = [
    ...artifacts,
    ...(controlPlane.artifact ? [{ ref: `artifact:${controlPlane.artifact.id}`, label: 'Computer Use controls', mime: COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE }] : []),
    ...(virtualScreen.artifact ? [{ ref: `artifact:${virtualScreen.artifact.id}`, label: 'Computer Use screen', mime: COMPUTER_USE_VIRTUAL_SCREEN_ARTIFACT_TYPE }] : []),
  ];
  const executionProcess = [
    presentation ? {
      eventId: `${commandId ?? 'runtime-codex'}:gui-present`,
      type: 'GuiPresent',
      summary: `Runtime Codex displayed Computer Use evidence through ${presentation.source}.`,
      timestamp: asString(result.timestamp) ?? new Date().toISOString(),
    } : undefined,
    {
      eventId: `${commandId ?? 'runtime-codex'}:gui-ask-user`,
      type: 'GuiAskUser',
      summary: `Runtime Codex requested user confirmation through ${askUser.source}.`,
      timestamp: asString(result.timestamp) ?? new Date().toISOString(),
    },
  ].filter(Boolean);
  return {
    ...result,
    message: askUser.text,
    guiPresentation: presentation,
    guiAskUser: askUser,
    displayIntent: {
      source: askUser.source,
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: commandId ? `runtime-codex:${commandId}` : 'runtime-codex:gui-ask-user',
        visibleAnswer: {
          status: 'needs-human',
          text: askUser.text,
          artifactRefs: projectedArtifacts.map((artifact) => artifact.ref),
          confirmationStatus: 'needs-confirmation',
          liveAcceptanceEligible: true,
        },
        artifacts: projectedArtifacts,
        executionProcess,
        recoverActions: [],
        verificationState: {
          status: 'needs-human',
          verifierRef: askUser.source,
          liveAcceptanceEligible: true,
        },
        runtimeMetadata,
        auditRefs,
        diagnostics: [],
      },
    },
    output: {
      ...output,
      message: askUser.text,
      guiPresentation: presentation,
      guiAskUser: askUser,
    },
    ...((controlPlane.artifact || virtualScreen.artifact) ? {
      artifacts: [
        ...recordList(result.artifacts),
        ...(controlPlane.artifact ? [controlPlane.artifact] : []),
        ...(virtualScreen.artifact ? [virtualScreen.artifact] : []),
      ],
      uiManifest: [
        ...recordList(result.uiManifest),
        ...(controlPlane.slot ? [controlPlane.slot] : []),
        ...(virtualScreen.slot ? [virtualScreen.slot] : []),
      ],
    } : {}),
  };
}

function withNativeCodexMessageRuntimeResult(result: unknown, message: string): unknown {
  if (!message.trim() || !isRecord(result)) return result;
  const output = isRecord(result.output) ? result.output : {};
  const commandId = asString(result.commandId);
  const auditRefs = asStringArray(result.evidenceRefs) ?? [];
  const runtimeMetadata = runtimeMetadataForProjection(result, auditRefs);
  const liveAcceptanceEligible = runtimeNativeMessageLiveAcceptanceEligible(message, result);
  return {
    ...result,
    message,
    nativeCodexMessage: {
      schemaVersion: 'sciforge.runtime-codex-native-message.v1',
      source: commandId ? `codex.native-message:${commandId}` : 'codex.native-message',
      text: message,
      commandId,
      attemptId: asString(result.attemptId),
      provider: publicRuntimeMetadataValue(result.provider, 'provider'),
      model: publicRuntimeMetadataValue(result.model, 'model'),
      profile: publicRuntimeMetadataValue(result.profile, 'profile'),
      workspace: publicRuntimeMetadataValue(result.workspace, 'workspace'),
      codexSessionId: asString(result.codexSessionId),
      liveAcceptanceEligible,
    },
    displayIntent: {
      source: commandId ? `codex.native-message:${commandId}` : 'codex.native-message',
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: commandId ? `runtime-codex:${commandId}` : 'runtime-codex:native-message',
        visibleAnswer: {
          status: 'visible-not-live-acceptance',
          text: message,
          artifactRefs: [],
          liveAcceptanceEligible,
        },
        artifacts: [],
        executionProcess: [{
          eventId: `${commandId ?? 'runtime-codex'}:native-message`,
          type: 'NativeCodexMessage',
          summary: 'Runtime Codex completed with a native assistant message; tool process and raw diagnostics stay in the folded run audit.',
          timestamp: asString(result.timestamp) ?? new Date().toISOString(),
        }],
        recoverActions: [
          'Use gui.present on rerun only when the task needs a structured artifact projection beyond the native Codex assistant answer.',
        ],
        verificationState: {
          status: 'unverified',
          verdict: 'native-message',
          verifierRef: commandId ? `codex.native-message:${commandId}` : 'codex.native-message',
          liveAcceptanceEligible,
        },
        runtimeMetadata,
        auditRefs,
        diagnostics: [],
      },
    },
    output: {
      ...output,
      message,
      nativeCodexMessage: true,
    },
  };
}

function runtimeMetadataForProjection(
  primary: Record<string, unknown>,
  auditRefs: string[],
) {
  const metadata = {
    provider: publicRuntimeMetadataValue(primary.provider, 'provider'),
    model: publicRuntimeMetadataValue(primary.model, 'model'),
    profile: publicRuntimeMetadataValue(primary.profile, 'profile'),
    workspace: publicRuntimeMetadataValue(primary.workspace, 'workspace'),
    commandId: asString(primary.commandId),
    attemptId: asString(primary.attemptId),
    codexSessionId: asString(primary.codexSessionId),
    auditRefs,
    foldedAudit: true,
  };
  return Object.values(metadata).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value))
    ? metadata
    : undefined;
}

function guiPresentationFromEvent(event: Record<string, unknown>, result: Record<string, unknown>) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const nested = isRecord(raw.presentation) ? raw.presentation : {};
  const text = asString(event.text)
    ?? asString(event.message)
    ?? asString(nested.text)
    ?? asString(result.message)
    ?? '';
  const commandId = asString(event.commandId) ?? asString(result.commandId);
  return {
    schemaVersion: 'sciforge.runtime-codex-gui-present.v1',
    source: asString(nested.source) ?? asString(raw.source) ?? (commandId ? `gui.present:${commandId}` : 'gui.present'),
    text,
    ref: asString(nested.ref),
    title: asString(nested.title),
    intent: asString(nested.intent),
    hint: asString(nested.hint),
    status: asString(nested.status) ?? asString(event.status),
    displayedRefs: asStringArray(nested.displayedRefs),
    placement: isRecord(nested.placement) ? nested.placement : undefined,
    controlPlane: normalizeComputerUseControlPlanePayload(nested.controlPlane),
    virtualScreen: normalizeComputerUseVirtualScreenPayload(nested.virtualScreen),
    commandId,
    attemptId: asString(event.attemptId) ?? asString(result.attemptId),
    provider: publicRuntimeMetadataValueFrom(event.provider, result.provider, 'provider'),
    model: publicRuntimeMetadataValueFrom(event.model, result.model, 'model'),
    profile: publicRuntimeMetadataValueFrom(event.profile, result.profile, 'profile'),
    workspace: publicRuntimeMetadataValueFrom(event.workspace, result.workspace, 'workspace'),
  };
}

function guiAskUserFromEvent(event: Record<string, unknown>, result: Record<string, unknown>) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const nested = isRecord(raw.askUser) ? raw.askUser : {};
  const approvalRequest = isRecord(nested.approvalRequest) ? nested.approvalRequest : undefined;
  const explicitRelatedRefs = uniqueStrings([
    ...(asStringArray(nested.relatedRefs) ?? []),
    ...(asStringArray(nested.displayedRefs) ?? []),
  ]);
  const publicProjection = runtimeActionPublicProjectionFrom([
    nested.publicProjection,
    nested.public_projection,
    nested.projection,
    nested,
    approvalRequest,
  ]);
  const relatedRefs = uniqueStrings([
    ...explicitRelatedRefs,
    ...(publicProjection?.evidenceRefs ?? []),
  ]);
  const title = asString(nested.title)
    ?? asString(approvalRequest?.title)
    ?? 'Computer Use confirmation required';
  const message = asString(nested.message)
    ?? asString(approvalRequest?.prompt)
    ?? asString(approvalRequest?.message)
    ?? asString(approvalRequest?.confirmationText)
    ?? asString(approvalRequest?.confirmation_text)
    ?? asString(approvalRequest?.reason);
  const approvalRef = approvalRefFromRequest(approvalRequest);
  const choices = guiChoicesFromValue(nested.choices) ?? confirmationChoicesForApprovalRef(approvalRef);
  const publicApprovalRequest = publicApprovalRequestFrom(approvalRequest, publicProjection);
  const text = formatGuiAskUserText({ title, message, approvalRequest: publicApprovalRequest, relatedRefs, choices, publicProjection });
  const commandId = asString(event.commandId) ?? asString(result.commandId);
  return {
    schemaVersion: 'sciforge.runtime-codex-gui-ask-user.v1',
    source: asString(nested.source) ?? asString(raw.source) ?? (commandId ? `gui.ask_user:${commandId}` : 'gui.ask_user'),
    kind: asString(nested.kind) ?? 'confirmation',
    title,
    message,
    text,
    choices,
    approvalRequest: publicApprovalRequest,
    publicProjection,
    relatedRefs,
    displayedRefs: relatedRefs,
    placement: isRecord(nested.placement) ? nested.placement : undefined,
    controlPlane: normalizeComputerUseControlPlanePayload(nested.controlPlane),
    commandId,
    attemptId: asString(event.attemptId) ?? asString(result.attemptId),
    provider: publicRuntimeMetadataValueFrom(event.provider, result.provider, 'provider'),
    model: publicRuntimeMetadataValueFrom(event.model, result.model, 'model'),
    profile: publicRuntimeMetadataValueFrom(event.profile, result.profile, 'profile'),
    workspace: publicRuntimeMetadataValueFrom(event.workspace, result.workspace, 'workspace'),
  };
}

function guiEventsFromComputerUseTuiHostActions(event: Record<string, unknown>): {
  guiPresent?: Record<string, unknown>;
  guiAskUser?: Record<string, unknown>;
} {
  if (asString(event.type) !== 'computer-use.tui-host-actions') return {};
  const actionsEnvelope = isRecord(event.detail)
    ? event.detail
    : parseJsonObject(event.detail);
  const actions = recordList(actionsEnvelope?.actions);
  if (!actions.length) return {};
  const commandId = asString(event.commandId);
  const common = {
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    provider: publicRuntimeMetadataValue(event.provider, 'provider'),
    model: publicRuntimeMetadataValue(event.model, 'model'),
    profile: publicRuntimeMetadataValue(event.profile, 'profile'),
    workspace: publicRuntimeMetadataValue(event.workspace, 'workspace'),
    commandId,
    attemptId: asString(event.attemptId),
    evidenceRefs: asStringArray(event.evidenceRefs),
  };
  let guiPresent: Record<string, unknown> | undefined;
  let guiAskUser: Record<string, unknown> | undefined;
  for (const action of actions) {
    const port = asString(action.port);
    const payload = isRecord(action.payload) ? action.payload : {};
    if (port === 'gui.present') {
      const summary = computerUseSummaryFromPresentationPayload(payload);
      const controlPlane = computerUseControlPlaneFromActionPayload(payload);
      const virtualScreen = normalizeComputerUseVirtualScreenPayload(payload);
      guiPresent = {
        ...common,
        type: 'gui_present',
        status: 'presented',
        message: summary.text,
        text: summary.text,
        raw: {
          boundary: 'computer-use-tui-host-gui-present',
          source: commandId ? `gui.present:${commandId}:computer-use` : 'gui.present:computer-use',
          presentation: {
            source: commandId ? `gui.present:${commandId}:computer-use` : 'gui.present:computer-use',
            text: summary.text,
            intent: 'show-result',
            ref: summary.primaryRef,
            displayedRefs: summary.displayedRefs,
            title: asString(payload.title) ?? 'Computer Use result',
            status: asString(payload.status),
            hint: 'markdown',
            controlPlane,
            virtualScreen,
          },
        },
      };
    }
    if (port === 'gui.ask_user') {
      const ask = computerUseAskUserFromAction(payload);
      guiAskUser = {
        ...common,
        type: 'gui_ask_user',
        status: 'needs-confirmation',
        message: ask.text,
        text: ask.text,
        raw: {
          boundary: 'computer-use-tui-host-gui-ask-user',
          source: commandId ? `gui.ask_user:${commandId}:computer-use` : 'gui.ask_user:computer-use',
          askUser: {
            ...ask,
            source: commandId ? `gui.ask_user:${commandId}:computer-use` : 'gui.ask_user:computer-use',
          },
        },
      };
    }
  }
  return { guiPresent, guiAskUser };
}

function computerUseSummaryFromPresentationPayload(payload: Record<string, unknown>) {
  const controlPlane = computerUseControlPlaneFromActionPayload(payload);
  const controlPlaneRefs = computerUseControlPlaneDisplayedRefs(controlPlane);
  const virtualScreen = normalizeComputerUseVirtualScreenPayload(payload);
  const virtualScreenRefs = computerUseVirtualScreenDisplayedRefs(virtualScreen);
  const virtualScreenSummary = computerUseVirtualScreenSummaryLines(virtualScreen);
  const artifactRefs = asStringArray(payload.artifactRefs) ?? [];
  const blockedManifestRefs = asStringArray(payload.blockedManifestRefs) ?? [];
  const repairHintRefs = asStringArray(payload.repairHintRefs) ?? [];
  const continuationRequestRefs = asStringArray(payload.continuationRequestRefs) ?? [];
  const directoryListingRefs = asStringArray(payload.directoryListingRefs) ?? [];
  const runTaskChainRefs = asStringArray(payload.runTaskChainRefs) ?? [];
  const guiAskUserRefs = asStringArray(payload.guiAskUserRefs) ?? [];
  const approvalRequestRefs = asStringArray(payload.approvalRequestRefs) ?? [];
  const riskAuditRefs = asStringArray(payload.riskAuditRefs) ?? [];
  const confirmedRequestRefs = asStringArray(payload.confirmedRequestRefs) ?? [];
  const approvalDecisionRefs = asStringArray(payload.approvalDecisionRefs) ?? [];
  const sourceApprovalRefs = asStringArray(payload.sourceApprovalRefs) ?? [];
  const completionGradeDiagnosticRefs = uniqueStrings([
    ...(asStringArray(payload.completionGradeDiagnosticRefs) ?? []),
    ...artifactRefs.filter((ref) => /(?:^|\/)completion-grade-diagnostics\.json$/i.test(ref)),
  ]);
  const producerDiagnosticRefs = uniqueStrings([
    ...(asStringArray(payload.producerDiagnosticRefs) ?? []),
    ...(asStringArray(payload.completionProducerDiagnosticRefs) ?? []),
    ...artifactRefs.filter((ref) => /(?:^|\/)embedded-l3-completion-producer-diagnostics\.json$/i.test(ref)),
  ]);
  const acceptanceManifestRefs = uniqueStrings([
    ...(asStringArray(payload.acceptanceManifestRefs) ?? []),
    ...artifactRefs.filter((ref) => /(?:^|\/)cu-user-acceptance-manifest\.json$/i.test(ref)),
  ]);
  const completionEvidenceRefs = uniqueStrings([
    ...(asStringArray(payload.completionEvidenceRefs) ?? []),
    ...artifactRefs.filter((ref) => /(?:^|\/)isolated-desktop-l3-workflow-evidence\.json$/i.test(ref)),
  ]);
  const finalArtifactRefs = artifactRefs.filter((ref) => !isComputerUseControlEvidenceRef(ref));
  const displayedRefs = uniqueStrings([
    ...(asStringArray(payload.traceRefs) ?? []),
    ...(asStringArray(payload.screenshotRefs) ?? []),
    ...artifactRefs,
    ...(asStringArray(payload.executionUnitRefs) ?? []),
    ...(asStringArray(payload.workEvidenceRefs) ?? []),
    ...blockedManifestRefs,
    ...repairHintRefs,
    ...continuationRequestRefs,
    ...directoryListingRefs,
    ...runTaskChainRefs,
    ...guiAskUserRefs,
    ...approvalRequestRefs,
    ...riskAuditRefs,
    ...confirmedRequestRefs,
    ...approvalDecisionRefs,
    ...sourceApprovalRefs,
    ...controlPlaneRefs,
    ...virtualScreenRefs,
    ...completionGradeDiagnosticRefs,
    ...producerDiagnosticRefs,
    ...acceptanceManifestRefs,
    ...completionEvidenceRefs,
  ]);
  const completedWithoutFinalArtifact = /^(?:completed|done|succeeded|success)$/i.test(asString(payload.status) ?? '')
    && finalArtifactRefs.length === 0;
  const lines = [
    '## Computer Use result',
    asString(payload.status) ? `Status: \`${asString(payload.status)}\`` : undefined,
    asString(payload.message),
    controlPlane ? `User control plane: status \`${controlPlane.status ?? 'unknown'}\`${controlPlane.approvalMode ? `, approval \`${controlPlane.approvalMode}\`` : ''}.` : undefined,
    controlPlaneRefs.length ? ['User control refs:', ...controlPlaneRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    virtualScreenSummary.length ? ['Virtual screen run summary:', ...virtualScreenSummary.map((line) => `- ${line}`)].join('\n') : undefined,
    completedWithoutFinalArtifact
      ? 'Completion diagnostic: completed status did not include a visible final artifact ref, so completion remains fail-closed.'
      : undefined,
    finalArtifactRefs.length ? ['Final artifact refs:', ...finalArtifactRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    completionGradeDiagnosticRefs.length ? ['Completion-grade diagnostic refs:', ...completionGradeDiagnosticRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    producerDiagnosticRefs.length ? ['L3 producer diagnostic refs:', ...producerDiagnosticRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    acceptanceManifestRefs.length ? ['Acceptance manifest refs:', ...acceptanceManifestRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    completionEvidenceRefs.length ? ['Canonical L3 evidence refs:', ...completionEvidenceRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    blockedManifestRefs.length ? ['Blocked manifest refs:', ...blockedManifestRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    repairHintRefs.length ? ['Repair hint refs:', ...repairHintRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    continuationRequestRefs.length ? ['Continuation request refs:', ...continuationRequestRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    directoryListingRefs.length ? ['Directory listing refs:', ...directoryListingRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    runTaskChainRefs.length ? ['Run task chain refs:', ...runTaskChainRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    approvalRequestRefs.length ? ['Approval request refs:', ...approvalRequestRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    riskAuditRefs.length ? ['Risk audit refs:', ...riskAuditRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    confirmedRequestRefs.length ? ['Confirmed request refs:', ...confirmedRequestRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    approvalDecisionRefs.length ? ['Approval decision refs:', ...approvalDecisionRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    sourceApprovalRefs.length ? ['Source approval refs:', ...sourceApprovalRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    displayedRefs.length ? ['Evidence refs:', ...displayedRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
  ].filter(Boolean);
  return {
    text: lines.join('\n\n'),
    primaryRef: finalArtifactRefs[0] ?? artifactRefs[0] ?? displayedRefs[0],
    displayedRefs,
  };
}

function isComputerUseControlEvidenceRef(ref: string) {
  return /(?:^|\/)(?:vision-trace|host-ports|tool-payload|gui-present|gui-ask-user|approval-request|approval-source-request|approval-source-gui-ask-user|approval-source-risk-audit|approval-decision|risk-audit|confirmed-request|blocked-manifest|repair-hint|continuation-request|directory-listing|tui-host-run-task-chain|computer-use-request|gateway-request|request|independent-input-adapter|virtual-remote-session|action-ledger|failure-diagnostics|completion-grade-diagnostics|embedded-l3-completion-producer-diagnostics|cu-user-acceptance|cu-l3-independent-input-verifier|isolated-desktop-l3-workflow-evidence)\.json$/i.test(ref)
    || /^(?:artifact|audit|workEvidence|EU):/i.test(ref);
}

function computerUseControlPlaneFromActionPayload(
  payload: Record<string, unknown>,
  approvalRequest?: Record<string, unknown>,
): ComputerUseControlPlanePayload | undefined {
  const approvalRef = approvalRefFromRequest(approvalRequest);
  const approvalRequestRef = asString(payload.approvalRequestRef)
    ?? asString(payload.approval_request_ref)
    ?? (asStringArray(payload.approvalRequestRefs) ?? [])[0];
  const normalized = normalizeComputerUseControlPlanePayload({
    ...payload,
    approvalRef: asString(payload.approvalRef) ?? asString(payload.approval_ref) ?? approvalRef,
    approvalRequestRef,
    approvalMode: asString(payload.approvalMode) ?? asString(payload.approval_mode) ?? (approvalRef ? 'required' : undefined),
    status: asString(payload.status) ?? (approvalRef ? 'needs-confirmation' : undefined),
  });
  return hasComputerUseControlPlanePresentation(normalized) ? normalized : undefined;
}

function computerUseControlPlaneResultBundle(value: unknown, commandId: string | undefined): {
  artifact?: Record<string, unknown>;
  slot?: Record<string, unknown>;
} {
  const payload = normalizeComputerUseControlPlanePayload(value);
  if (!payload) return {};
  const id = `computer-use-control-plane-${safeRefSegment(commandId ?? payload.sessionPermissionRef ?? payload.stopRef ?? 'current')}`;
  const artifact = {
    id,
    type: COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
    producerScenario: 'computer-use',
    schemaVersion: COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
    metadata: {
      title: 'Computer Use controls',
      presentationRole: 'supporting-evidence',
      producer: 'gui.presentation',
    },
    data: payload,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role: 'supporting-evidence',
      declaredMediaType: 'application/vnd.sciforge.computer-use-control-plane+json',
      declaredExtension: '.json',
      contentShape: 'external-ref',
      readableRef: `artifact:${id}`,
      previewPolicy: 'inline',
    },
  };
  return {
    artifact,
    slot: {
      componentId: COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
      title: 'Computer Use controls',
      artifactRef: id,
      priority: -5,
    },
  };
}

function normalizeComputerUseVirtualScreenPayload(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const visibleScreenRefs = uniqueStrings([
    ...(safeRefArray(value.visibleScreenRefs) ?? []),
    ...(safeRefArray(value.screenRefs) ?? []),
  ]);
  const visibleCursorRefs = uniqueStrings([
    ...(safeRefArray(value.visibleCursorRefs) ?? []),
    ...(safeRefArray(value.cursorOverlayRefs) ?? []),
  ]);
  const cursorOverlayRefs = safeRefArray(value.cursorOverlayRefs) ?? [];
  const leaseOwnerRefs = safeRefArray(value.leaseOwnerRefs) ?? [];
  const explicitFrameRefs = uniqueStrings([
    ...(safeRefArray(value.frameRefs) ?? []),
    ...safeRefList(value.frameRef),
  ]);
  const screenshotFrameRefs = uniqueStrings([
    ...(safeRefArray(value.screenshotRefs) ?? []),
    ...safeRefList(value.screenshotRef),
  ]);
  const replayRef = safeRef(value.replayRef);
  const blockedRef = safeRef(value.blockedRef)
    ?? safeRef(value.blockedManifestRef)
    ?? (safeRefArray(value.blockedManifestRefs) ?? [])[0];
  const errorRef = safeRef(value.errorRef);
  const completionEvidenceRef = safeRef(value.completionEvidenceRef)
    ?? (safeRefArray(value.completionEvidenceRefs) ?? [])[0];
  const validationRef = safeRef(value.validationRef);
  const currentBundleRef = safeRef(value.currentBundleRef);
  const evidenceBundleIndexRef = safeRef(value.evidenceBundleIndexRef) ?? safeRef(value.evidenceIndexRef);
  const sidecarBindingRef = safeRef(value.sidecarBindingRef);
  const sidecarCapabilitiesRef = safeRef(value.sidecarCapabilitiesRef);
  const sidecarDiscoveryRef = safeRef(value.sidecarDiscoveryRef);
  const sidecarCallRefs = safeRefArray(value.sidecarCallRefs) ?? [];
  const targetRefs = safeRefArray(value.targetRefs) ?? [];
  const schedulerLeaseRefs = safeRefArray(value.schedulerLeaseRefs) ?? [];
  const targetAppRef = safeRef(value.targetAppRef) ?? safeRef(value.appRef);
  const targetWindowRef = safeRef(value.targetWindowRef) ?? safeRef(value.windowRef);
  const frameStreamRef = safeRef(value.frameStreamRef);
  const currentFrameRef = safeRef(value.currentFrameRef) ?? safeRef(value.frameRef);
  const inputIntentRefs = uniqueStrings([
    ...(safeRefArray(value.inputIntentRefs) ?? []),
    ...safeRefList(value.inputIntentRef),
  ]);
  const executorEventRefs = uniqueStrings([
    ...(safeRefArray(value.executorEventRefs) ?? []),
    ...safeRefList(value.executorEventRef),
  ]);
  const inputLeaseRef = safeRef(value.inputLeaseRef) ?? safeRef(value.schedulerLeaseRef) ?? schedulerLeaseRefs[0];
  const actionAdapterRef = safeRef(value.actionAdapterRef) ?? sidecarBindingRef;
  const adapterReadinessRef = safeRef(value.adapterReadinessRef) ?? sidecarCapabilitiesRef;
  const platformDriverRef = safeRef(value.platformDriverRef) ?? safeRef(value.driverRef);
  const platformDriverStatus = safeSummaryText(value.platformDriverStatus) ?? safeSummaryText(value.driverStatus);
  const evidenceLedgerRef = safeRef(value.evidenceLedgerRef) ?? evidenceBundleIndexRef;
  const nativeHostPreflightInput = isRecord(value.nativeHostPreflight)
    ? value.nativeHostPreflight
    : isRecord(value.nativeHost)
      ? isRecord(value.nativeHost.preflight)
        ? value.nativeHost.preflight
        : {}
      : {};
  const preflightRef = safeNativeHostPreflightRef(value.preflightRef) ?? safeNativeHostPreflightRef(nativeHostPreflightInput.preflightRef);
  const preflightLedgerRef = safeNativeHostPreflightRef(value.preflightLedgerRef) ?? safeNativeHostPreflightRef(nativeHostPreflightInput.preflightLedgerRef);
  const preflightLedgerEntryRef = safeNativeHostPreflightRef(value.preflightLedgerEntryRef) ?? safeNativeHostPreflightRef(nativeHostPreflightInput.preflightLedgerEntryRef);
  const hostReadinessRef = safeNativeHostPreflightRef(value.hostReadinessRef) ?? safeNativeHostPreflightRef(nativeHostPreflightInput.hostReadinessRef);
  const preflightProviderReadinessRefs = uniqueStrings([
    ...(safeNativeHostPreflightRefArray(value.providerReadinessRefs) ?? []),
    ...(safeNativeHostPreflightRefArray(nativeHostPreflightInput.providerReadinessRefs) ?? []),
  ]);
  const nativeHostPreflight = preflightRef || preflightLedgerRef || preflightLedgerEntryRef || hostReadinessRef || preflightProviderReadinessRefs.length
    ? {
      preflightRef,
      preflightLedgerRef,
      preflightLedgerEntryRef,
      hostReadinessRef,
      adapterReadinessRef: safeNativeHostPreflightRef(value.adapterReadinessRef) ?? safeNativeHostPreflightRef(nativeHostPreflightInput.adapterReadinessRef),
      providerReadinessRefs: preflightProviderReadinessRefs.length ? preflightProviderReadinessRefs : undefined,
    }
    : undefined;
  const stopRef = safeRef(value.stopRef);
  const cancelLeaseRef = safeRef(value.cancelLeaseRef);
  const sessionRef = safeRef(value.sessionRef) ?? safeRef(value.sessionManifestRef);
  const displayGroupRef = safeRef(value.displayGroupRef) ?? safeRef(value.currentBundleRef);
  const screenRef = safeRef(value.screenRef) ?? visibleScreenRefs[0];
  const currentRunRef = safeRef(value.currentRunRef);
  const liveSurfaceRef = safeRef(value.liveSurfaceRef) ?? safeRef(value.surfaceRef);
  const surfaceTransportRef = safeRef(value.surfaceTransportRef);
  const surfaceTransport = normalizeVirtualScreenSurfaceTransport(value.surfaceTransport ?? value.transport);
  const surfaceTransportDescriptor = normalizeVirtualScreenSurfaceTransportDescriptor(value.surfaceTransportDescriptor);
  const frameTransport = normalizeVirtualScreenQualityRef(value.frameTransport, currentFrameRef);
  const frameTelemetry = normalizeVirtualScreenQualityRef(value.frameTelemetry, currentFrameRef);
  const currentFrameSequence = normalizeVirtualScreenQualityRef(value.currentFrameSequence, currentFrameRef)
    ?? normalizeVirtualScreenQualityRef(surfaceTransportDescriptor, currentFrameRef);
  const inputHotPath = normalizeVirtualScreenQualityRef(value.inputHotPath ?? value.inputHotPathRef, inputLeaseRef);
  const providerExecuted = asBoolean(value.providerExecuted)
    ?? (isRecord(value.isolationFlags) ? asBoolean(value.isolationFlags.providerExecuted) : undefined)
    ?? (isRecord(value.isolation) ? asBoolean(value.isolation.providerExecuted) : undefined);
  const providerSessionRevalidated = asBoolean(value.providerSessionRevalidated);
  const hostSessionRef = safeRef(value.hostSessionRef) ?? sessionRef;
  const surfaceOwnerRef = safeRef(value.surfaceOwnerRef);
  const displayOwnerRef = safeRef(value.displayOwnerRef);
  const providerSessionOwnerRef = safeRef(value.providerSessionOwnerRef);
  const providerSessionReconnectRef = safeRef(value.providerSessionReconnectRef) ?? safeRef(value.reconnectRef);
  const liveBindingAttachGrantRef = safeRef(value.liveBindingAttachGrantRef);
  const liveBindingAttachGrantStatus = safeSummaryText(value.liveBindingAttachGrantStatus);
  const grantValidationRef = safeRef(value.grantValidationRef);
  const grantValidationStatus = safeSummaryText(value.grantValidationStatus);
  const permissionRef = safeRef(value.permissionRef) ?? safeRef(value.sessionPermissionRef);
  const permissionStatus = safeSummaryText(value.permissionStatus);
  const permissionRequired = asBoolean(value.permissionRequired) ?? asBoolean(value.requiresPermission);
  const permissionGranted = asBoolean(value.permissionGranted) ?? asBoolean(value.permissionsGranted);
  const sharedInputAllowed = asBoolean(value.sharedInputAllowed);
  const handoffRef = safeRef(value.handoffRef);
  const permissionHandoffRef = safeRef(value.permissionHandoffRef) ?? safeRef(value.handoffRef);
  const permissionHandoffRefs = safeRefArray(value.permissionHandoffRefs) ?? [];
  const permissionRecheckRef = safeRef(value.permissionRecheckRef) ?? safeRef(value.recheckRef);
  const permissionRecheckRefs = safeRefArray(value.permissionRecheckRefs) ?? [];
  const recheckRef = safeRef(value.recheckRef) ?? permissionRecheckRef;
  const guiPresentRefs = uniqueStrings([
    ...(safeRefArray(value.guiPresentRefs) ?? []),
    ...safeRefList(value.guiPresentRef),
  ]);
  const artifactRefs = safeRefArray(value.artifactRefs) ?? [];
  const verificationRefs = safeRefArray(value.verificationRefs) ?? [];
  const sidecarBinding = isRecord(value.sidecarBinding) ? value.sidecarBinding : {};
  const actorCursors = sanitizeRecordArray(value.actorCursors);
  const frames = sanitizeRecordArray(value.frames)
    .map((frame) => compactRecord({
      ...frame,
      frameRef: safeRef(frame.frameRef) ?? safeRef(frame.screenshotRef),
      screenshotRef: safeRef(frame.screenshotRef) ?? safeRef(frame.frameRef),
      cursorOverlayRefs: safeRefArray(frame.cursorOverlayRefs) ?? visibleCursorRefs,
      beforeEvidenceRefs: safeRefArray(frame.beforeEvidenceRefs),
      afterEvidenceRefs: safeRefArray(frame.afterEvidenceRefs),
      leaseOwnerRefs: safeRefArray(frame.leaseOwnerRefs),
    }))
    .filter((frame) => safeRef(frame.frameRef) || safeRef(frame.screenshotRef));
  const hasVirtualScreenSignal = Boolean(
    sessionRef
    || displayGroupRef
    || screenRef
    || currentRunRef
    || liveSurfaceRef
    || surfaceTransportRef
    || targetAppRef
    || targetWindowRef
    || frameStreamRef
    || currentFrameSequence
    || providerSessionOwnerRef
    || providerSessionReconnectRef
    || liveBindingAttachGrantRef
    || grantValidationRef
    || preflightRef
    || preflightLedgerRef
    || preflightLedgerEntryRef
    || hostReadinessRef
    || preflightProviderReadinessRefs.length
    || replayRef
    || currentFrameRef
    || explicitFrameRefs.length
    || screenshotFrameRefs.length
    || frames.length
    || inputIntentRefs.length
    || executorEventRefs.length
    || visibleScreenRefs.length
    || cursorOverlayRefs.length
    || leaseOwnerRefs.length
    || actorCursors.length
  );
  if (!hasVirtualScreenSignal) return undefined;
  const frameRefs = uniqueStrings([
    ...explicitFrameRefs,
    ...screenshotFrameRefs,
  ]);
  const events = sanitizeRecordArray(value.events);
  const isolationSource = isRecord(value.isolationFlags)
    ? value.isolationFlags
    : isRecord(value.isolation)
      ? value.isolation
      : undefined;
  const isolation = normalizeVirtualScreenIsolationFlags(isolationSource);
  const runSummary = normalizeComputerUseRunSummary(value.runSummary, {
    status: asString(value.status),
    runId: asString(value.runId),
    validationRef,
    currentBundleRef,
    evidenceBundleIndexRef,
    replayRef,
    validationStatus: asString(value.validationStatus) ?? asString(value.validation_status) ?? (isRecord(value.validation) ? asString(value.validation.status) : undefined),
    validationOk: asBoolean(value.validationOk) ?? asBoolean(value.validation_ok) ?? (isRecord(value.validation) ? asBoolean(value.validation.ok) : undefined),
    sidecarBindingRef,
    sidecarCapabilitiesRef,
    sidecarDiscoveryRef,
    sidecarBindingKind: asString(value.sidecarBindingKind) ?? asString(sidecarBinding.bindingKind),
    realNativeSidecarExecuted: asBoolean(value.realNativeSidecarExecuted),
    providerSessionRevalidated: asBoolean(value.providerSessionRevalidated),
    completionEligible: asBoolean(value.completionEligible),
    screenCount: positiveInteger(value.screenCount) ?? visibleScreenRefs.length,
    actorCursorCount: positiveInteger(value.actorCursorCount) ?? Math.max(actorCursors.length, visibleCursorRefs.length),
    frameCount: positiveInteger(value.frameCount) ?? Math.max(frameRefs.length, frames.length),
    cursorOverlayCount: positiveInteger(value.cursorOverlayCount) ?? cursorOverlayRefs.length,
    schedulerLeaseCount: positiveInteger(value.schedulerLeaseCount) ?? Math.max(schedulerLeaseRefs.length, leaseOwnerRefs.length),
    targetCount: positiveInteger(value.targetCount) ?? targetRefs.length,
    blockedReason: safeSummaryText(value.blockedReason),
  });
  if (!sessionRef && !screenRef && !targetAppRef && !targetWindowRef && !frameStreamRef && !replayRef && !frameRefs.length && !frames.length && !visibleScreenRefs.length && !blockedRef && !errorRef && !preflightRef && !preflightLedgerEntryRef && !hostReadinessRef) {
    return undefined;
  }
  return compactRecord({
    schemaVersion: COMPUTER_USE_VIRTUAL_SCREEN_SCHEMA_VERSION,
    title: asString(value.title) ?? 'Computer Use Virtual Screen',
    status: asString(value.status),
    attachState: asString(value.attachState),
    presentationState: asString(value.presentationState),
    surfaceMode: asString(value.surfaceMode),
    currentRunRef,
    sessionRef,
    displayGroupRef,
    screenRef,
    liveSurfaceRef,
    surfaceTransport,
    surfaceTransportRef,
    surfaceTransportDescriptor,
    platformDriverRef,
    platformDriverStatus,
    visibleScreenRefs,
    visibleCursorRefs,
    targetAppRef,
    targetWindowRef,
    cursorOverlayRefs,
    leaseOwnerRefs,
    validationRef,
    currentBundleRef,
    evidenceBundleIndexRef,
    sidecarBindingRef,
    sidecarCapabilitiesRef,
    sidecarDiscoveryRef,
    sidecarCallRefs,
    targetRefs,
    schedulerLeaseRefs,
    frameStreamRef,
    frameTransport,
    frameTelemetry,
    currentFrameSequence,
    inputHotPath,
    currentFrameRef: currentFrameRef ?? frameRefs[0],
    frameRef: currentFrameRef ?? frameRefs[0],
    frameRefs,
    inputIntentRefs,
    executorEventRefs,
    inputLeaseRef,
    actionAdapterRef,
    adapterReadinessRef,
    preflightRef,
    preflightLedgerRef,
    preflightLedgerEntryRef,
    hostReadinessRef,
    providerReadinessRefs: preflightProviderReadinessRefs,
    nativeHostPreflight,
    evidenceLedgerRef,
    hostSessionRef,
    surfaceOwnerRef,
    displayOwnerRef,
    providerSessionOwnerRef,
    providerSessionReconnectRef,
    liveBindingAttachGrantRef,
    liveBindingAttachGrantStatus,
    grantValidationRef,
    grantValidationStatus,
    ...(providerExecuted === undefined ? {} : { providerExecuted }),
    ...(providerSessionRevalidated === undefined ? {} : { providerSessionRevalidated }),
    replayRef,
    permissionRef,
    permissionStatus,
    permissionRequired,
    permissionGranted,
    sharedInputAllowed,
    stopRef,
    cancelLeaseRef,
    handoffRef,
    permissionHandoffRef,
    permissionHandoffRefs,
    permissionRecheckRef,
    permissionRecheckRefs,
    recheckRef,
    artifactRefs,
    verificationRefs,
    guiPresentRefs,
    completionEvidenceRef,
    blockedRef,
    errorRef,
    screen: isRecord(value.screen) ? compactRecord({
      width: asNumber(value.screen.width),
      height: asNumber(value.screen.height),
      label: asString(value.screen.label),
    }) : undefined,
    actorCursors,
    frames,
    events,
    isolation,
    isolationFlags: isolation,
    runSummary,
  });
}

function normalizeComputerUseRunSummary(
  value: unknown,
  fallback: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const raw = isRecord(value) ? value : {};
  const summary = compactRecord({
    schemaVersion: 'sciforge.computer-use.run-summary.v1',
    status: asString(raw.status) ?? asString(fallback.status),
    runId: safeRef(raw.runId) ?? safeRef(fallback.runId),
    validationRef: safeRef(raw.validationRef) ?? safeRef(fallback.validationRef),
    currentBundleRef: safeRef(raw.currentBundleRef) ?? safeRef(fallback.currentBundleRef),
    evidenceBundleIndexRef: safeRef(raw.evidenceBundleIndexRef) ?? safeRef(raw.evidenceIndexRef) ?? safeRef(fallback.evidenceBundleIndexRef),
    replayRef: safeRef(raw.replayRef) ?? safeRef(fallback.replayRef),
    validationStatus: safeSummaryText(raw.validationStatus) ?? safeSummaryText(fallback.validationStatus),
    validationOk: asBoolean(raw.validationOk) ?? asBoolean(fallback.validationOk),
    sidecarBindingRef: safeRef(raw.sidecarBindingRef) ?? safeRef(fallback.sidecarBindingRef),
    sidecarCapabilitiesRef: safeRef(raw.sidecarCapabilitiesRef) ?? safeRef(fallback.sidecarCapabilitiesRef),
    sidecarDiscoveryRef: safeRef(raw.sidecarDiscoveryRef) ?? safeRef(fallback.sidecarDiscoveryRef),
    sidecarBindingKind: safeSummaryText(raw.sidecarBindingKind) ?? safeSummaryText(fallback.sidecarBindingKind),
    realNativeSidecarExecuted: asBoolean(raw.realNativeSidecarExecuted) ?? asBoolean(fallback.realNativeSidecarExecuted),
    providerSessionRevalidated: asBoolean(raw.providerSessionRevalidated) ?? asBoolean(fallback.providerSessionRevalidated),
    completionEligible: asBoolean(raw.completionEligible) ?? asBoolean(fallback.completionEligible),
    screenCount: positiveInteger(raw.screenCount) ?? positiveInteger(fallback.screenCount),
    actorCursorCount: positiveInteger(raw.actorCursorCount) ?? positiveInteger(fallback.actorCursorCount),
    frameCount: positiveInteger(raw.frameCount) ?? positiveInteger(fallback.frameCount),
    cursorOverlayCount: positiveInteger(raw.cursorOverlayCount) ?? positiveInteger(fallback.cursorOverlayCount),
    schedulerLeaseCount: positiveInteger(raw.schedulerLeaseCount) ?? positiveInteger(fallback.schedulerLeaseCount),
    targetCount: positiveInteger(raw.targetCount) ?? positiveInteger(fallback.targetCount),
    blockedReason: safeSummaryText(raw.blockedReason) ?? safeSummaryText(fallback.blockedReason),
  });
  return Object.keys(summary).length > 1 ? summary : undefined;
}

function computerUseVirtualScreenDisplayedRefs(payload: Record<string, unknown> | undefined): string[] {
  if (!payload) return [];
  const runSummary = isRecord(payload.runSummary) ? payload.runSummary : {};
  return uniqueStrings([
    ...(safeRefArray(payload.visibleScreenRefs) ?? []),
    ...(safeRefArray(payload.visibleCursorRefs) ?? []),
    ...(safeRefArray(payload.cursorOverlayRefs) ?? []),
    ...(safeRefArray(payload.frameRefs) ?? []),
    ...(safeRefArray(payload.inputIntentRefs) ?? []),
    ...(safeRefArray(payload.executorEventRefs) ?? []),
    ...(safeRefArray(payload.sidecarCallRefs) ?? []),
    ...(safeRefArray(payload.targetRefs) ?? []),
    ...(safeRefArray(payload.schedulerLeaseRefs) ?? []),
    safeRef(payload.sessionRef),
    safeRef(payload.displayGroupRef),
    safeRef(payload.screenRef),
    safeRef(payload.currentRunRef),
    safeRef(payload.liveSurfaceRef),
    safeRef(payload.surfaceTransportRef),
    safeRef(payload.providerSessionOwnerRef),
    safeRef(payload.providerSessionReconnectRef),
    safeRef(payload.liveBindingAttachGrantRef),
    safeRef(payload.grantValidationRef),
    safeRef(payload.targetAppRef),
    safeRef(payload.targetWindowRef),
    safeRef(payload.frameStreamRef),
    safeRef(payload.currentFrameRef),
    safeRef(payload.inputLeaseRef),
    safeRef(payload.platformDriverRef),
    safeRef(payload.preflightRef),
    safeRef(payload.preflightLedgerRef),
    safeRef(payload.preflightLedgerEntryRef),
    safeRef(payload.hostReadinessRef),
    ...(safeRefArray(payload.providerReadinessRefs) ?? []),
    safeRef(payload.permissionRef),
    safeRef(payload.permissionHandoffRef),
    safeRef(payload.permissionRecheckRef),
    safeRef(payload.actionAdapterRef),
    safeRef(payload.adapterReadinessRef),
    safeRef(payload.evidenceLedgerRef),
    safeRef(payload.replayRef),
    safeRef(payload.validationRef),
    safeRef(payload.currentBundleRef),
    safeRef(payload.evidenceBundleIndexRef),
    safeRef(payload.sidecarBindingRef),
    safeRef(payload.sidecarCapabilitiesRef),
    safeRef(payload.sidecarDiscoveryRef),
    safeRef(payload.completionEvidenceRef),
    safeRef(payload.blockedRef),
    safeRef(payload.errorRef),
    ...(safeRefArray(payload.guiPresentRefs) ?? []),
    ...(safeRefArray(payload.permissionHandoffRefs) ?? []),
    ...(safeRefArray(payload.permissionRecheckRefs) ?? []),
    safeRef(runSummary.validationRef),
    safeRef(runSummary.currentBundleRef),
    safeRef(runSummary.evidenceBundleIndexRef),
    safeRef(runSummary.replayRef),
    safeRef(runSummary.sidecarBindingRef),
    safeRef(runSummary.sidecarCapabilitiesRef),
    safeRef(runSummary.sidecarDiscoveryRef),
  ].filter((ref): ref is string => Boolean(ref)));
}

function computerUseVirtualScreenSummaryLines(payload: Record<string, unknown> | undefined): string[] {
  if (!payload) return [];
  const runSummary = isRecord(payload.runSummary) ? payload.runSummary : {};
  const lines = [
    asString(runSummary.status) ? `status \`${asString(runSummary.status)}\`` : undefined,
    positiveInteger(runSummary.screenCount) ? `${positiveInteger(runSummary.screenCount)} screen(s)` : undefined,
    positiveInteger(runSummary.actorCursorCount) ? `${positiveInteger(runSummary.actorCursorCount)} actor cursor(s)` : undefined,
    positiveInteger(runSummary.frameCount) ? `${positiveInteger(runSummary.frameCount)} frame(s)` : undefined,
    asString(runSummary.sidecarBindingKind) ? `sidecar \`${asString(runSummary.sidecarBindingKind)}\`` : undefined,
    asString(runSummary.validationStatus) ? `validation status \`${asString(runSummary.validationStatus)}\`` : undefined,
    typeof runSummary.validationOk === 'boolean' ? `validation ok: \`${String(runSummary.validationOk)}\`` : undefined,
    typeof runSummary.realNativeSidecarExecuted === 'boolean' ? `real native sidecar executed: \`${String(runSummary.realNativeSidecarExecuted)}\`` : undefined,
    typeof runSummary.providerSessionRevalidated === 'boolean' ? `provider session revalidated: \`${String(runSummary.providerSessionRevalidated)}\`` : undefined,
    typeof runSummary.completionEligible === 'boolean' ? `completion eligible: \`${String(runSummary.completionEligible)}\`` : undefined,
    asString(runSummary.validationRef) ? `validation ref \`${asString(runSummary.validationRef)}\`` : undefined,
    asString(runSummary.evidenceBundleIndexRef) ? `evidence index \`${asString(runSummary.evidenceBundleIndexRef)}\`` : undefined,
    asString(runSummary.blockedReason) ? `blocked reason: ${asString(runSummary.blockedReason)}` : undefined,
  ];
  return lines.filter((line): line is string => Boolean(line));
}

function computerUseVirtualScreenResultBundle(value: unknown, commandId: string | undefined): {
  artifact?: Record<string, unknown>;
  slot?: Record<string, unknown>;
} {
  const payload = normalizeComputerUseVirtualScreenPayload(value);
  if (!payload) return {};
  const id = `computer-use-virtual-screen-${safeRefSegment(commandId ?? asString(payload.sessionRef) ?? asString(payload.replayRef) ?? 'current')}`;
  const artifact = {
    id,
    type: COMPUTER_USE_VIRTUAL_SCREEN_ARTIFACT_TYPE,
    producerScenario: 'computer-use',
    schemaVersion: COMPUTER_USE_VIRTUAL_SCREEN_SCHEMA_VERSION,
    metadata: {
      title: 'Computer Use screen',
      presentationRole: 'primary-deliverable',
      producer: 'gui.presentation',
    },
    data: payload,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role: 'primary-deliverable',
      declaredMediaType: 'application/vnd.sciforge.computer-use-virtual-screen+json',
      declaredExtension: '.json',
      contentShape: 'external-ref',
      readableRef: `artifact:${id}`,
      previewPolicy: 'inline',
    },
  };
  return {
    artifact,
    slot: {
      componentId: COMPUTER_USE_VIRTUAL_SCREEN_COMPONENT_ID,
      title: 'Computer Use screen',
      artifactRef: id,
      priority: -6,
    },
  };
}

function computerUseAskUserFromAction(payload: Record<string, unknown>) {
  const approvalRequest = isRecord(payload.approvalRequest) ? payload.approvalRequest : {};
  const relatedRefs = uniqueStrings(asStringArray(payload.relatedRefs) ?? []);
  const approvalId = approvalRefFromRequest(approvalRequest);
  const controlPlane = computerUseControlPlaneFromActionPayload(payload, approvalRequest);
  const choices = approvalId ? [
    { label: 'Confirm', commandText: `/computer-use approve --approval-ref ${quoteCommandArg(approvalId)}`, style: 'primary' },
    { label: 'Cancel', commandText: `/computer-use reject --approval-ref ${quoteCommandArg(approvalId)}`, style: 'secondary' },
  ] : undefined;
  const title = 'Computer Use confirmation required';
  const message = asString(approvalRequest.prompt)
    ?? asString(approvalRequest.message)
    ?? asString(approvalRequest.confirmationText)
    ?? asString(approvalRequest.confirmation_text)
    ?? asString(approvalRequest.reason)
    ?? 'Computer Use requested confirmation before executing a guarded action.';
  const publicProjection = runtimeActionPublicProjectionFrom([
    payload.publicProjection,
    payload.public_projection,
    payload.projection,
    payload,
    approvalRequest,
  ]);
  const publicApprovalRequest = publicApprovalRequestFrom(approvalRequest, publicProjection);
  return {
    kind: 'confirmation',
    title,
    message,
    text: formatGuiAskUserText({ title, message, approvalRequest: publicApprovalRequest, relatedRefs, choices, publicProjection }),
    choices,
    approvalRequest: publicApprovalRequest,
    publicProjection,
    relatedRefs,
    displayedRefs: relatedRefs,
    controlPlane,
  };
}

function runtimeActionPublicProjectionFrom(values: unknown[]): RuntimeActionPublicProjection | undefined {
  const records = values.filter(isRecord);
  if (!records.length) return undefined;
  const action = firstPublicTextField(records, [
    'action',
    'actionText',
    'action_text',
    'actionKind',
    'action_kind',
    'actionType',
    'action_type',
    'operation',
    'verb',
  ]);
  const target = firstPublicTextField(records, [
    'target',
    'targetSummary',
    'target_summary',
    'targetObject',
    'target_object',
    'targetService',
    'target_service',
    'destination',
    'service',
    'site',
  ]);
  const impact = firstPublicTextField(records, [
    'impact',
    'impactSummary',
    'impact_summary',
    'effect',
    'effectSummary',
    'effect_summary',
    'outcome',
    'riskImpact',
    'risk_impact',
  ]);
  const authorizationProfile = records
    .map((record) => publicAuthorizationProfile(
      record.authorizationProfile
        ?? record.authorization_profile
        ?? record.autonomyProfile
        ?? record.autonomy_profile
        ?? record.authorization,
    ))
    .find((value): value is string => Boolean(value));
  const evidenceRefs = uniqueStrings(records.flatMap(publicEvidenceRefsFromRecord));
  const projection = compactRecord({
    action,
    target,
    impact,
    evidenceRefs,
    authorizationProfile,
  }) as RuntimeActionPublicProjection;
  return Object.keys(projection).length ? projection : undefined;
}

function publicApprovalRequestFrom(
  approvalRequest: Record<string, unknown> | undefined,
  publicProjection: RuntimeActionPublicProjection | undefined,
): Record<string, unknown> | undefined {
  if (!approvalRequest && !publicProjection) return undefined;
  const source = approvalRequest ?? {};
  const approvalRef = safeApprovalRef(source.approvalRef);
  const approval_ref = safeApprovalRef(source.approval_ref);
  const id = safeApprovalRef(source.id);
  const request = compactRecord({
    id,
    approvalRef,
    approval_ref,
    title: publicProjectionText(source.title),
    prompt: publicProjectionText(source.prompt),
    message: publicProjectionText(source.message),
    confirmationText: publicProjectionText(source.confirmationText),
    confirmation_text: publicProjectionText(source.confirmation_text),
    reason: publicProjectionText(source.reason),
    riskLevel: publicProjectionText(source.riskLevel) ?? publicProjectionText(source.risk_level) ?? publicProjectionText(source.risk),
    actionRef: publicEvidenceRef(source.actionRef) ?? publicEvidenceRef(source.action_ref),
    actionKind: publicProjectionText(source.actionKind) ?? publicProjectionText(source.action_kind),
    riskActionHash: publicProjectionText(source.riskActionHash) ?? publicProjectionText(source.risk_action_hash),
    publicProjection,
  });
  return Object.keys(request).length ? request : undefined;
}

function firstPublicTextField(records: Record<string, unknown>[], keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const text = publicProjectionText(record[key]);
      if (text) return text;
    }
  }
  return undefined;
}

function publicAuthorizationProfile(value: unknown): string | undefined {
  const direct = publicProjectionText(value);
  if (direct) return direct;
  if (!isRecord(value)) return undefined;
  return publicProjectionText(value.label)
    ?? publicProjectionText(value.name)
    ?? publicProjectionText(value.profile)
    ?? publicProjectionText(value.id)
    ?? publicProjectionText(value.tier);
}

function publicEvidenceRefsFromRecord(record: Record<string, unknown>) {
  return [
    ...publicEvidenceRefList(record.evidenceRefs),
    ...publicEvidenceRefList(record.evidence_refs),
    ...publicEvidenceRefList(record.displayedRefs),
    ...publicEvidenceRefList(record.displayed_refs),
    ...publicEvidenceRefList(record.relatedRefs),
    ...publicEvidenceRefList(record.related_refs),
    ...publicEvidenceRefList(record.refs),
  ];
}

function publicEvidenceRefList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(publicEvidenceRef).filter((ref): ref is string => Boolean(ref));
  const ref = publicEvidenceRef(value);
  return ref ? [ref] : [];
}

function publicEvidenceRef(value: unknown): string | undefined {
  const ref = safeRef(value);
  if (
    !ref
    || ref.length > 180
    || /^(?:audit|raw|stdout|stderr|provider):/i.test(ref)
    || /(?:^|[/:])(?:Users|Applications|Volumes|private|var|tmp|\.sciforge|raw|stdout|stderr|provider)(?:[/:]|$)/i.test(ref)
    || /\b(?:authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|credential|client[_-]?secret)\b|(?:sk|rk|pk)-[A-Za-z0-9._-]{8,}/i.test(ref)
  ) return undefined;
  return ref;
}

function publicProjectionText(value: unknown): string | undefined {
  const text = asString(value)?.replace(/\s+/g, ' ').trim();
  if (
    !text
    || /^\s*[\[{]/.test(text)
    || /(?:commandText|command_text|rawPayload|raw[_ -]?jsonl?|ToolPayload|provider\s+payload|stdoutRef|stderrRef|rawRef|runtimeEventsRef)/i.test(text)
    || /\b(?:authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|credential|client[_-]?secret)\b\s*[:=]/i.test(text)
    || /\b(?:sk|rk|pk)-[A-Za-z0-9._-]{8,}\b/i.test(text)
    || /\bhttps?:\/\/|^(?:data|blob|file|javascript):/i.test(text)
    || /(^|[\s="'(:])(?:\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(text)
    || /(?:^|[\\/])(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:[\\/]|$)/i.test(text)
  ) return undefined;
  return text.length > 240 ? `${text.slice(0, 237).trim()}...` : text;
}

function formatGuiAskUserText(input: {
  title: string;
  message?: string;
  approvalRequest?: Record<string, unknown>;
  relatedRefs?: string[];
  choices?: Array<{ label: string; commandText: string; style?: string }>;
  publicProjection?: RuntimeActionPublicProjection;
}) {
  const risk = asString(input.approvalRequest?.riskLevel)
    ?? asString(input.approvalRequest?.risk_level)
    ?? asString(input.approvalRequest?.risk);
  const lines = [
    `## ${humanGuiAskUserTitle(input.title)}`,
    humanGuiAskUserMessage(input.message),
    input.publicProjection?.action ? `Action: ${input.publicProjection.action}` : undefined,
    input.publicProjection?.target ? `Target: ${input.publicProjection.target}` : undefined,
    input.publicProjection?.impact ? `Impact: ${input.publicProjection.impact}` : undefined,
    input.publicProjection?.authorizationProfile ? `Authorization profile: ${input.publicProjection.authorizationProfile}` : undefined,
    risk ? `Risk: ${humanGuiRiskLabel(risk)}` : undefined,
    input.relatedRefs?.length ? `${input.relatedRefs.length} related item${input.relatedRefs.length === 1 ? '' : 's'} available.` : undefined,
  ].filter(Boolean);
  return lines.join('\n\n');
}

function humanGuiAskUserTitle(value: string) {
  return (value || 'Confirmation required')
    .replace(/\bComputer Use confirmation required\b/gi, 'Confirmation required')
    .replace(/\bComputer Use\b/gi, 'Operation')
    .replace(/\bgui\.(?:present|ask_user)\b/gi, 'Operation')
    .replace(/\s+/g, ' ')
    .trim() || 'Confirmation required';
}

function humanGuiAskUserMessage(value: string | undefined) {
  return (value || 'Confirmation is required before continuing.')
    .replace(/\bComputer Use\b/gi, 'the operation')
    .replace(/\bgui\.(?:present|ask_user)\b/gi, 'the operation')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanGuiRiskLabel(value: string) {
  const risk = value.trim().toLowerCase();
  if (risk === 'high') return 'High';
  if (risk === 'medium') return 'Medium';
  if (risk === 'low') return 'Low';
  return value.trim();
}

function approvalRefFromRequest(approvalRequest?: Record<string, unknown>) {
  const ref = asString(approvalRequest?.approvalRef)
    ?? asString(approvalRequest?.approval_ref)
    ?? asString(approvalRequest?.id);
  return safeApprovalRef(ref);
}

function safeApprovalRef(value: unknown): string | undefined {
  const ref = safeRef(value);
  if (
    !ref
    || ref.length > 180
    || /^(?:audit|raw|stdout|stderr|provider):/i.test(ref)
    || /(?:^|[/:])(?:Users|Applications|Volumes|private|var|tmp|\.sciforge|raw|stdout|stderr|provider)(?:[/:]|$)/i.test(ref)
    || /\b(?:authorization|bearer|api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|credential|client[_-]?secret)\b|(?:sk|rk|pk)-[A-Za-z0-9._-]{8,}/i.test(ref)
  ) return undefined;
  return ref;
}

function confirmationChoicesForApprovalRef(approvalRef: string | undefined) {
  return approvalRef ? [
    { label: 'Confirm', commandText: `/computer-use approve --approval-ref ${quoteCommandArg(approvalRef)}`, style: 'primary' },
    { label: 'Cancel', commandText: `/computer-use reject --approval-ref ${quoteCommandArg(approvalRef)}`, style: 'secondary' },
  ] : undefined;
}

function recoverActionsForGuiPresentation(presentation: { source?: string; status?: string; displayedRefs?: string[] }) {
  if (!isComputerUseGuiPresentation(presentation)) return [];
  const status = visibleAnswerStatusForGuiPresent(presentation);
  if (status !== 'external-blocked' && status !== 'repair-needed') return [];
  const continuationRef = presentation.displayedRefs?.find((ref) => /(?:^|\/)continuation-request\.json$/i.test(ref));
  if (continuationRef) return [`/computer-use continue --continuation-request-ref ${quoteCommandArg(continuationRef)}`];
  const repairHintRef = presentation.displayedRefs?.find((ref) => /(?:^|\/)repair-hint\.json$/i.test(ref));
  if (repairHintRef) return [`/computer-use repair --repair-hint-ref ${quoteCommandArg(repairHintRef)}`];
  return ['Review the Computer Use evidence refs and rerun from the latest repair hint.'];
}

function visibleAnswerStatusForGuiPresent(presentation: { source?: string; status?: string }) {
  if (!isComputerUseGuiPresentation(presentation)) return 'satisfied';
  const status = presentation.status?.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (status === 'needs-confirmation' || status === 'needs-human') return 'needs-human';
  if (status === 'external-blocked' || status === 'blocked') return 'external-blocked';
  if (status === 'failed' || status === 'failed-with-reason' || status === 'error' || status === 'repair-needed') return 'repair-needed';
  if (status === 'completed' || status === 'done' || status === 'succeeded' || status === 'success') return 'output-materialized';
  return 'partial-ready';
}

function isComputerUseGuiPresentation(presentation: { source?: string }) {
  return /(?:^|:)computer-use(?:$|:)/i.test(presentation.source ?? '');
}

function guiChoicesFromValue(value: unknown): Array<{ label: string; commandText: string; style?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const choices = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = asString(item.label);
    const commandText = asString(item.commandText);
    if (!label || !commandText || !isTerminalEquivalentCommandText(commandText)) return [];
    return [{ label, commandText, style: asString(item.style) }];
  });
  return choices.length ? choices : undefined;
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function artifactSafeForStructuredDoneProjection(artifact: Record<string, unknown> | undefined): artifact is Record<string, unknown> {
  if (!artifact) return false;
  const id = asString(artifact.id);
  const type = asString(artifact.type);
  if (!id || !type) return false;
  if (type !== COMPUTER_USE_VIRTUAL_SCREEN_ARTIFACT_TYPE && type !== COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE) return false;
  const text = JSON.stringify(artifact);
  return !/data:image|;base64,|rawScreenshot|screenshotBase64|providerUrl|providerRoute|Authorization|apiKey|password|secret|token/i.test(text);
}

function sanitizeRecordArray(value: unknown): Record<string, unknown>[] {
  return recordList(value).map((record) => compactRecord(record));
}

const FORBIDDEN_SCREEN_PRESENTATION_KEYS = new Set([
  'rawScreenshot',
  'screenshot',
  'screenshotBase64',
  'imageBase64',
  'base64Screenshot',
  'frameBase64',
  'rawTrace',
  'traceJson',
  'rawJson',
  'rawJSON',
  'providerJson',
  'rawPayload',
  'providerRoute',
  'providerParams',
  'desktopBridge',
  'executorLease',
  'executorLeaseParams',
  'schedulerParams',
  'Authorization',
  'authorization',
  'token',
  'secret',
  'password',
  'credential',
]);

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key, value]) => {
    if (FORBIDDEN_SCREEN_PRESENTATION_KEYS.has(key)) return false;
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (isRecord(value)) return Object.keys(value).length > 0;
    return true;
  }));
}

function normalizeVirtualScreenSurfaceTransport(value: unknown): string | undefined {
  const transport = asString(value);
  return transport === 'webrtc' || transport === 'native-frame-stream' ? transport : undefined;
}

function normalizeVirtualScreenQualityRef(value: unknown, fallbackRef?: string): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    const ref = safeRef(value);
    return ref ? { ref } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const ref = safeRef(value.ref)
    ?? safeRef(value.currentFrameSequenceRef)
    ?? safeRef(value.frameSequenceRef)
    ?? safeRef(value.sequenceRef)
    ?? safeRef(value.currentFrameRef)
    ?? fallbackRef;
  if (!ref) return undefined;
  return compactRecord({
    ref,
    label: safeSummaryText(value.label),
    status: safeSummaryText(value.status),
    transport: normalizeVirtualScreenSurfaceTransport(value.transport ?? value.protocol),
    diagnosticOnly: asBoolean(value.diagnosticOnly),
    sequence: nonNegativeInteger(value.sequence ?? value.currentFrameSequence),
  });
}

function normalizeVirtualScreenSurfaceTransportDescriptor(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const descriptor = compactRecord({
    schemaVersion: safeSummaryText(value.schemaVersion),
    owner: asString(value.owner),
    providerId: safeSummaryText(value.providerId),
    transport: normalizeVirtualScreenSurfaceTransport(value.transport),
    surfaceTransportRef: safeRef(value.surfaceTransportRef),
    liveSurfaceRef: safeRef(value.liveSurfaceRef),
    frameStreamRef: safeRef(value.frameStreamRef),
    currentFrameRef: safeRef(value.currentFrameRef),
    frameTransportContractRef: safeRef(value.frameTransportContractRef),
    frameTelemetryRef: safeRef(value.frameTelemetryRef),
    mediaChannelRef: safeRef(value.mediaChannelRef),
    dataChannelRef: safeRef(value.dataChannelRef),
    currentFrameSequence: nonNegativeInteger(value.currentFrameSequence),
    diagnosticOnly: asBoolean(value.diagnosticOnly),
    productFallback: asBoolean(value.productFallback),
    singleInteractiveTruth: asBoolean(value.singleInteractiveTruth),
  });
  if (
    descriptor.owner !== 'VirtualDisplayProvider'
    || !descriptor.surfaceTransportRef
    || !descriptor.liveSurfaceRef
    || !descriptor.frameStreamRef
    || !descriptor.currentFrameRef
    || descriptor.currentFrameSequence === undefined
    || descriptor.diagnosticOnly !== false
    || descriptor.productFallback !== false
    || descriptor.singleInteractiveTruth !== true
  ) return undefined;
  return descriptor;
}

function normalizeVirtualScreenIsolationFlags(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const flags = compactRecord({
    affectsPhysicalDisplay: asBoolean(value.affectsPhysicalDisplay),
    requiresFocusSteal: asBoolean(value.requiresFocusSteal),
    sharedSystemInputUsed: asBoolean(value.sharedSystemInputUsed),
    systemPointerMoved: asBoolean(value.systemPointerMoved),
    systemKeyboardEventsSent: asBoolean(value.systemKeyboardEventsSent),
    backgroundRenderable: asBoolean(value.backgroundRenderable),
    singleInteractiveTruth: asBoolean(value.singleInteractiveTruth),
    secondInteractiveSurfacePresent: asBoolean(value.secondInteractiveSurfacePresent),
    diagnosticOnly: asBoolean(value.diagnosticOnly),
    providerExecuted: asBoolean(value.providerExecuted),
    failClosedByDefault: asBoolean(value.failClosedByDefault),
    virtualInputExecuted: asBoolean(value.virtualInputExecuted),
    realOsInputExecuted: asBoolean(value.realOsInputExecuted),
  });
  return Object.keys(flags).length ? flags : undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function safeRef(value: unknown): string | undefined {
  const ref = asString(value);
  if (
    !ref
    || /^(?:data:|blob:|file:|javascript:|https?:|provider:)/i.test(ref)
    || ref.startsWith('/')
    || ref.startsWith('~')
    || /base64/i.test(ref)
    || /^\s*[{[]/.test(ref)
  ) return undefined;
  return ref;
}

function safeNativeHostPreflightRef(value: unknown): string | undefined {
  const ref = safeRef(value);
  if (!ref || !ref.startsWith('computer-use:native-host/preflights/')) return undefined;
  if (/(?:^|[:/.-])(?:fixture|fixtures|replay-fixture|snapshot-fixture|mock)(?:[:/.-]|$)/i.test(ref)) return undefined;
  return ref;
}

function safeRefList(value: unknown): string[] {
  const ref = safeRef(value);
  return ref ? [ref] : [];
}

function safeNativeHostPreflightRefArray(value: unknown): string[] | undefined {
  const refs = asStringArray(value)?.map((ref) => safeNativeHostPreflightRef(ref)).filter((ref): ref is string => Boolean(ref));
  return refs?.length ? uniqueStrings(refs) : undefined;
}

function safeRefArray(value: unknown): string[] | undefined {
  const refs = asStringArray(value)?.map((ref) => safeRef(ref)).filter((ref): ref is string => Boolean(ref));
  return refs?.length ? uniqueStrings(refs) : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function safeSummaryText(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) return undefined;
  if (/^\s*[\[{]/.test(text) || /authorization|bearer|api[_-]?key|password|secret|token/i.test(text)) {
    return 'Summary detail is available by ref.';
  }
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function refLabel(ref: string) {
  return ref.replace(/^(?:artifact|file|run|execution-unit|folder|url)::?/i, '').split(/[\\/]/).filter(Boolean).at(-1) ?? ref;
}

function refMime(ref: string) {
  if (/\.(?:png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(ref)) return 'image';
  if (/\.(?:json|jsonl)(?:$|[?#])/i.test(ref)) return 'json';
  if (/\.(?:md|markdown|txt)(?:$|[?#])/i.test(ref)) return 'markdown';
  return 'evidence-ref';
}

function quoteCommandArg(value: string) {
  return JSON.stringify(value);
}

function safeRefSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'current';
}

function isTerminalEquivalentCommandText(commandText: string) {
  return commandText.length > 0
    && !/\b(?:deleteFile|triggerRecover|updateCapabilityPreference|UserActionApi|ProjectionApi)\b/.test(commandText);
}

function runtimeCodexMissingGuiPresentFailure(result: unknown): { type: 'failed'; status: 'failed'; message: string; raw: Record<string, unknown> } {
  const record = isRecord(result) ? result : {};
  return {
    type: 'failed',
    status: 'failed',
    message: 'Runtime Codex completed without gui.present; SciForge failed closed instead of rendering raw provider text.',
    raw: {
      boundary: 'gui-present-required',
      exitCode: asNumber(record.exitCode) ?? 0,
      provider: asString(record.provider),
      model: asString(record.model),
      profile: asString(record.profile),
      workspace: asString(record.workspace),
      commandId: asString(record.commandId),
      attemptId: asString(record.attemptId),
      codexSessionId: asString(record.codexSessionId),
      evidenceRefs: asStringArray(record.evidenceRefs),
    },
  };
}

function isRuntimeCodexDoneEvent(value: unknown) {
  if (!isRecord(value)) return false;
  return isRuntimeCodexEventRecord(value);
}

function isRuntimeCodexEventRecord(value: Record<string, unknown>) {
  return value.schemaVersion === 'sciforge.codex.normalized-event.v1'
    || Boolean(asString(value.commandId)?.startsWith('codex-command-'))
    || asString(value.profile) === 'sciforge-runtime-default'
    || /Runtime Codex/i.test(asString(value.message) ?? '');
}

export function normalizeWorkspaceRuntimeEvent(raw: unknown): AgentStreamEvent {
  const record = isRecord(raw) ? raw : {};
  const interactionProgressRecord = runtimeInteractionProgressEventFromCompactRecord(record);
  const interactionProgress = interactionProgressRecord ? runtimeInteractionProgressPresentation(interactionProgressRecord) : undefined;
  const rawType = asString(record.type) || asString(record.kind) || WORKSPACE_RUNTIME_EVENT_TYPE;
  const type = interactionProgressRecord?.type ?? normalizeRuntimeWorkspaceEventType(rawType, record);
  const source = asString(record.source);
  const toolName = asString(record.toolName);
  const usage = normalizeTokenUsage(record.usage)
    ?? normalizeTokenUsage(isRecord(record.output) ? record.output.usage : undefined)
    ?? normalizeTokenUsage(isRecord(record.result) ? record.result.usage : undefined)
    ?? normalizeTokenUsage(isRecord(record.result) && isRecord(record.result.output) ? record.result.output.usage : undefined);
  const contextWindowState = normalizeContextWindowState(contextWindowCandidate(record), type, record);
  const contextCompaction = normalizeContextCompaction(record.contextCompaction ?? record.compaction ?? record.context_compaction, type, record);
  const workEvidence = normalizeWorkEvidenceRecords(record.workEvidence ?? record.work_evidence);
  const rawFallbackDetail = rawEventDetailFallback(record);
  const auditOnlyDetail = isRuntimeAuditOnlyEvent(record) ? runtimeAuditOnlyEventSummary(record) : undefined;
  const providerMessageDetail = runtimeCodexProviderMessageSummary(record);
  const computerUseGuiDetail = computerUseTuiHostActionsSummary(record);
  const textDeltaDetail = type === TEXT_DELTA_EVENT_TYPE ? safeVisibleDetail(record.text, rawFallbackDetail) : undefined;
  const toolLifecycleDetail = runtimeToolLifecycleDetail(record, type, toolName);
  const baseDetail = textDeltaDetail
    || auditOnlyDetail
    || providerMessageDetail
    || computerUseGuiDetail
    || toolLifecycleDetail
    || interactionProgress?.detail
    || safeVisibleDetail(record.detail, rawFallbackDetail)
    || safeVisibleDetail(record.message, rawFallbackDetail)
    || safeVisibleDetail(record.text, rawFallbackDetail)
    || safeVisibleDetail(record.output, rawFallbackDetail)
    || safeVisibleDetail(record.status, rawFallbackDetail)
    || safeVisibleDetail(record.error, rawFallbackDetail)
    || rawFallbackDetail;
  const usageDetail = formatTokenUsage(usage);
  const detail = [baseDetail, usageDetail].filter(Boolean).join(' | ') || undefined;
  return {
    id: makeId('evt'),
    type,
    label: interactionProgress?.label ?? runtimeStreamEventLabel(type, source, toolName),
    detail,
    usage,
    contextWindowState,
    contextCompaction,
    workEvidence,
    createdAt: nowIso(),
    raw,
  };
}

function runtimeToolLifecycleDetail(record: Record<string, unknown>, type: string, toolName: string | undefined) {
  if (type !== TOOL_CALL_EVENT_TYPE && type !== TOOL_RESULT_EVENT_TYPE) return undefined;
  const command = boundedRuntimeLifecycleText(record.command);
  const outputSummary = boundedRuntimeLifecycleText(record.outputSummary ?? record.output_summary);
  const status = asString(record.status);
  const exitCode = asNumber(record.exitCode ?? record.exit_code);
  const phase = type === TOOL_CALL_EVENT_TYPE ? 'started' : 'completed';
  const title = command
    ? `Shell command ${phase}: ${command}`
    : toolName
      ? `Tool ${phase}: ${toolName}`
      : `Tool ${phase}.`;
  const suffix = [
    status ? `status=${status}` : undefined,
    exitCode !== undefined ? `exit=${exitCode}` : undefined,
    outputSummary ? `output=${outputSummary}` : undefined,
  ].filter(Boolean);
  return suffix.length ? `${title} (${suffix.join(', ')})` : title;
}

function boundedRuntimeLifecycleText(value: unknown) {
  const text = asString(value);
  if (!text) return undefined;
  const redacted = text
    .replace(/\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/gi, 'Bearer [redacted-secret]')
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization)\b\s*[:=]\s*["']?([^"'\s,;)}\]]{8,})/gi,
      (_match, label: string) => `${label}=[redacted-secret]`,
    )
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted-secret]')
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, '[redacted-url]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!redacted || runtimeTextLooksAuditOnly(redacted)) return undefined;
  if (redacted.length <= 320) return redacted;
  return `${redacted.slice(0, 284).replace(/\s+\S*$/, '')} ... ${redacted.slice(-24)}`;
}

function computerUseTuiHostActionsSummary(record: Record<string, unknown>) {
  if (asString(record.type) !== 'computer-use.tui-host-actions') return undefined;
  const actionsEnvelope = isRecord(record.detail) ? record.detail : parseJsonObject(record.detail);
  const actions = recordList(actionsEnvelope?.actions);
  const ports = uniqueStrings(actions.map((action) => asString(action.port)).filter((port): port is string => Boolean(port)));
  if (!ports.length) return 'Computer Use result is ready for GUI presentation.';
  if (ports.includes('gui.ask_user')) return `Computer Use requested visible GUI confirmation via ${ports.join(', ')}.`;
  return `Computer Use result is ready for visible GUI presentation via ${ports.join(', ')}.`;
}

function runtimeCodexProviderMessageSummary(record: Record<string, unknown>) {
  const type = asString(record.type)?.toLowerCase();
  if (type !== 'message') return undefined;
  if (!isRuntimeCodexEventRecord(record)) return undefined;
  return 'Runtime Codex native assistant message recorded; the final assistant answer can render as the primary reply, while raw runtime events, stderr, and plugin diagnostics stay folded in the run audit.';
}

function rawEventDetailFallback(record: Record<string, unknown>) {
  if (isRuntimeAuditOnlyEvent(record)) return runtimeAuditOnlyEventSummary(record);
  if (!Object.keys(record).length) return undefined;
  const rawShaped = ['payload', 'raw', 'stdout', 'stderr', 'jsonl', 'rawJsonl', 'stdoutRef', 'stderrRef', 'rawRef', 'runtimeEventsRef'].some((key) => key in record);
  if (!rawShaped) return undefined;
  return 'Runtime event recorded; structured details are available in the run audit.';
}

function safeVisibleDetail(value: unknown, rawFallback: string | undefined) {
  const text = asString(value);
  if (!text) return undefined;
  if (looksUnsafeTransportBodyText(text)) return rawFallback ?? 'Runtime event recorded; structured details are available in the run audit.';
  if (rawFallback && (isLowInformationStatus(text) || looksPrivateRuntimeText(text))) return rawFallback;
  return text;
}

function isLowInformationStatus(value: string) {
  return /^(?:failed|error|ok|true|false|null|undefined)$/i.test(value.trim());
}

function looksPrivateRuntimeText(value: string) {
  return /^[{[]/.test(value.trim())
    || runtimeTextLooksAuditOnly(value)
    || /<!doctype\s+html|<html\b|<body\b|<script\b|cf-ray|cloudflare/i.test(value)
    || /\bRAW_[A-Z0-9_]+\b/.test(value)
    || /\b(?:stdout|stderr|jsonl|rawJsonl|stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(value)
    || /\bhttps?:\/\/[^\s"'<>]+/i.test(value)
    || /\b(?:Invalid token|Unauthorized|Forbidden)\b/i.test(value);
}

function looksUnsafeTransportBodyText(value: string) {
  return /^[{[]/.test(value.trim())
    || runtimeTextLooksAuditOnly(value)
    || /<!doctype\s+html|<html\b|<body\b|<script\b|cf-ray|cloudflare/i.test(value)
    || /\bRAW_[A-Z0-9_]+\b/.test(value)
    || /\b(?:stdoutRef|stderrRef|rawRef|runtimeEventsRef|raw_jsonl|provider_sse|providerRawOutput|rawOutput)\b/i.test(value)
    || /\b(?:Invalid token|Unauthorized|Forbidden)\b/i.test(value);
}

function normalizeWorkEvidenceRecords(value: unknown): AgentStreamEvent['workEvidence'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records = value.filter(isWorkEvidenceRecord);
  return records.length ? records : undefined;
}

function isWorkEvidenceRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const schema = asString(value.schemaVersion);
  if (schema?.startsWith('sciforge.task-')) return false;
  return Boolean(asString(value.kind))
    && Boolean(asString(value.status))
    && Array.isArray(value.evidenceRefs)
    && Array.isArray(value.recoverActions);
}

function normalizeContextWindowState(value: unknown, type: string, fallback: Record<string, unknown>): AgentStreamEvent['contextWindowState'] | undefined {
  const record = isRecord(value) ? value : type === 'contextWindowState' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const usage = isRecord(record.usage) ? record.usage : record;
  const input = asNumber(record.input) ?? asNumber(record.inputTokens) ?? asNumber(usage.input) ?? asNumber(usage.promptTokens);
  const output = asNumber(record.output) ?? asNumber(record.outputTokens) ?? asNumber(usage.output) ?? asNumber(usage.completionTokens);
  const cacheRead = asNumber(record.cacheRead) ?? asNumber(record.cacheReadTokens) ?? asNumber(usage.cacheRead);
  const cacheWrite = asNumber(record.cacheWrite) ?? asNumber(record.cacheWriteTokens) ?? asNumber(usage.cacheWrite);
  const cache = asNumber(record.cache) ?? asNumber(record.cacheTokens) ?? asNumber(usage.cache) ?? (
    cacheRead !== undefined || cacheWrite !== undefined ? (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined
  );
  const explicitUsedTokens = asNumber(record.usedTokens)
    ?? asNumber(record.used_tokens)
    ?? asNumber(record.used)
    ?? asNumber(record.contextWindowTokens)
    ?? asNumber(record.currentContextWindowTokens)
    ?? asNumber(record.context_window_tokens)
    ?? asNumber(record.current_context_window_tokens)
    ?? asNumber(record.contextLength)
    ?? asNumber(record.context_length)
    ?? asNumber(record.currentContextLength)
    ?? asNumber(record.current_context_length)
    ?? asNumber(record.tokens);
  const usedTokens = explicitUsedTokens;
  const windowTokens = asNumber(record.windowTokens) ?? asNumber(record.window) ?? asNumber(record.contextWindowLimit) ?? asNumber(record.context_window_limit) ?? asNumber(record.limit) ?? asNumber(record.contextWindow);
  const ratio = clampRatio(asNumber(record.ratio) ?? asNumber(record.contextWindowRatio) ?? (
    usedTokens !== undefined && windowTokens ? usedTokens / windowTokens : undefined
  ));
  const hasUsage = input !== undefined || output !== undefined || cache !== undefined || asNumber(usage.total) !== undefined;
  const hasContextTelemetry = usedTokens !== undefined || windowTokens !== undefined || ratio !== undefined;
  const explicitSource = asString(record.source) ?? asString(record.contextWindowSource) ?? asString(record.context_window_source);
  const normalizedSource = explicitSource ? normalizeRuntimeContextWindowSource(explicitSource) : 'unknown';
  const source = explicitSource
    ? (normalizedSource === 'unknown' && hasUsage ? 'provider-usage' : normalizedSource)
    : (hasUsage ? 'provider-usage' : 'unknown');
  const state = {
    backend: asString(record.backend) ?? asString(usage.provider),
    provider: asString(record.provider) ?? asString(usage.provider),
    model: asString(record.model) ?? asString(usage.model),
    usedTokens,
    input,
    output,
    cache,
    window: windowTokens,
    windowTokens,
    ratio,
    source,
    status: normalizeRuntimeContextWindowStatus(asString(record.status), ratio, clampRatio(asNumber(record.autoCompactThreshold))),
    compactCapability: normalizeRuntimeCompactCapability(asString(record.compactCapability) ?? asString(record.compactionCapability)),
    breakdown: normalizeContextBreakdown(record),
    budget: normalizeContextBudget(record.budget),
    auditRefs: asStringArray(record.auditRefs),
    autoCompactThreshold: clampRatio(asNumber(record.autoCompactThreshold)),
    watchThreshold: clampRatio(asNumber(record.watchThreshold)),
    nearLimitThreshold: clampRatio(asNumber(record.nearLimitThreshold)),
    lastCompactedAt: asString(record.lastCompactedAt),
    pendingCompact: typeof record.pendingCompact === 'boolean' ? record.pendingCompact : undefined,
  };
  if (state.compactCapability === 'unknown' && state.backend) {
    state.compactCapability = compactCapabilityForBackend(state.backend);
  }
  return hasContextTelemetry
    ? state
    : undefined;
}

function contextWindowCandidate(record: Record<string, unknown>): unknown {
  return record.contextWindowState
    ?? record.contextWindow
    ?? record.context_window
    ?? (isExplicitContextWindowRecord(record.usage) ? record.usage : undefined);
}

function isExplicitContextWindowRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return [
    'usedTokens',
    'used_tokens',
    'contextWindowTokens',
    'context_window_tokens',
    'currentContextWindowTokens',
    'current_context_window_tokens',
    'contextLength',
    'context_length',
    'currentContextLength',
    'current_context_length',
    'windowTokens',
    'window_tokens',
    'contextWindowLimit',
    'context_window_limit',
    'modelContextWindow',
    'model_context_window',
    'contextWindowRatio',
    'context_window_ratio',
    'contextWindowSource',
    'context_window_source',
  ].some((key) => key in value);
}

function normalizeContextCompaction(value: unknown, type: string, fallback: Record<string, unknown>): AgentStreamEvent['contextCompaction'] | undefined {
  const record = isRecord(value) ? value : type === 'contextCompaction' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const isTag = record.kind === 'compaction' || record.kind === 'partial_compaction';
  const completedAt = asString(record.completedAt) ?? (isTag ? asString(record.createdAt) : undefined);
  const lastCompactedAt = asString(record.lastCompactedAt) ?? completedAt;
  const message = asString(record.message) ?? asString(record.userVisibleSummary) ?? asString(record.detail)
    ?? (isTag ? `${record.kind === 'partial_compaction' ? 'partial' : 'full'} compaction tag ${asString(record.id) ?? ''}`.trim() : undefined);
  return {
    status: normalizeRuntimeContextCompactionStatus(asString(record.status), {
      ok: asBoolean(record.ok) ?? (isTag ? true : undefined),
      completedAt,
      lastCompactedAt,
      message,
    }),
    source: normalizeRuntimeContextWindowSource(asString(record.source)),
    backend: asString(record.backend),
    compactCapability: normalizeRuntimeCompactCapability(asString(record.compactCapability) ?? asString(record.compactionCapability) ?? (isTag ? 'native' : undefined)),
    before: normalizeContextWindowState(record.before, 'contextWindowState', {}),
    after: normalizeContextWindowState(record.after, 'contextWindowState', {}),
    auditRefs: asStringArray(record.auditRefs) ?? (isTag && asString(record.id) ? [`runtime-compaction:${asString(record.id)}`] : undefined),
    startedAt: asString(record.startedAt),
    completedAt,
    lastCompactedAt,
    reason: asString(record.reason) ?? (isTag ? 'runtime-compact' : undefined),
    message,
  };
}

function normalizeContextBudget(value: unknown): NonNullable<AgentStreamEvent['contextWindowState']>['budget'] | undefined {
  if (!isRecord(value)) return undefined;
  return {
    rawRef: asString(value.rawRef),
    rawSha1: asString(value.rawSha1),
    rawBytes: asNumber(value.rawBytes),
    normalizedBytes: asNumber(value.normalizedBytes),
    maxPayloadBytes: asNumber(value.maxPayloadBytes),
    rawTokens: asNumber(value.rawTokens),
    normalizedTokens: asNumber(value.normalizedTokens),
    savedTokens: asNumber(value.savedTokens),
    normalizedBudgetRatio: clampRatio(asNumber(value.normalizedBudgetRatio)),
    decisions: Array.isArray(value.decisions) ? value.decisions.filter(isRecord) : undefined,
  };
}

function normalizeContextBreakdown(record: Record<string, unknown>): NonNullable<AgentStreamEvent['contextWindowState']>['breakdown'] | undefined {
  const nested = firstRecord(
    record.breakdown,
    record.contextBreakdown,
    record.context_breakdown,
    record.categoryTokens,
    record.categories,
  );
  const source = nested ?? record;
  const breakdown = {
    systemPrompt: firstNumber(source, ['systemPrompt', 'system_prompt', 'system', 'systemPromptTokens', 'system_prompt_tokens']),
    toolDefinitions: firstNumber(source, ['toolDefinitions', 'tool_definitions', 'tools', 'toolDefinitionTokens', 'tool_definition_tokens']),
    rules: firstNumber(source, ['rules', 'ruleTokens', 'rulesTokens', 'rules_tokens']),
    skills: firstNumber(source, ['skills', 'skillTokens', 'skillsTokens', 'skills_tokens']),
    mcp: firstNumber(source, ['mcp', 'mcpTokens', 'mcp_tokens', 'mcpServers', 'mcp_servers']),
    subagentDefinitions: firstNumber(source, ['subagentDefinitions', 'subagent_definitions', 'subagents', 'subagentTokens', 'subagent_definition_tokens']),
    conversation: firstNumber(source, ['conversation', 'conversationTokens', 'conversation_tokens', 'messages', 'messageTokens', 'message_tokens']),
  };
  return Object.values(breakdown).some((value) => value !== undefined) ? breakdown : undefined;
}

function firstRecord(...values: unknown[]) {
  return values.find(isRecord);
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function clampRatio(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1.5, value));
}

function normalizeTokenUsage(value: unknown): AgentStreamEvent['usage'] | undefined {
  if (!isRecord(value)) return undefined;
  const usage = {
    input: asNumber(value.input),
    output: asNumber(value.output),
    total: asNumber(value.total),
    cacheRead: asNumber(value.cacheRead),
    cacheWrite: asNumber(value.cacheWrite),
    provider: asString(value.provider),
    model: asString(value.model),
    source: asString(value.source),
  };
  if (
    usage.input === undefined
    && usage.output === undefined
    && usage.total === undefined
    && usage.cacheRead === undefined
    && usage.cacheWrite === undefined
  ) {
    return undefined;
  }
  return usage;
}

function formatTokenUsage(usage: AgentStreamEvent['usage'] | undefined) {
  if (!usage) return undefined;
  const parts = [
    usage.input !== undefined ? `in ${usage.input}` : '',
    usage.output !== undefined ? `out ${usage.output}` : '',
    usage.total !== undefined ? `total ${usage.total}` : '',
    usage.cacheRead !== undefined ? `cache read ${usage.cacheRead}` : '',
    usage.cacheWrite !== undefined ? `cache write ${usage.cacheWrite}` : '',
  ].filter(Boolean);
  const model = [usage.provider, usage.model].filter(Boolean).join('/');
  const suffix = [model, usage.source].filter(Boolean).join(' ');
  return `tokens ${parts.join(', ')}${suffix ? ` (${suffix})` : ''}`;
}

export function toolEvent(type: string, detail: string, rawExtras: Record<string, unknown> = {}): AgentStreamEvent {
  return {
    id: makeId('evt'),
    type,
    label: '项目工具',
    detail,
    createdAt: nowIso(),
    raw: { type, detail, ...rawExtras },
  };
}
