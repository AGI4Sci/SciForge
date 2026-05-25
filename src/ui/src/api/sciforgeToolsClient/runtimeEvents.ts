import type { AgentStreamEvent, SendAgentMessageInput } from '../../domain';
import { makeId, nowIso } from '../../domain';
import {
  WORKSPACE_RUNTIME_EVENT_TYPE,
  compactCapabilityForBackend,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
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
  const rememberGuiIntent = (event: unknown) => {
    if (!isRecord(event)) return;
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
    if ('result' in envelope) result = withGuiIntentRuntimeResult(envelope.result, guiPresent, guiAskUser);
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
  result = withGuiIntentRuntimeResult(result, guiPresent, guiAskUser);
  return { result, error };
}

function withGuiIntentRuntimeResult(
  result: unknown,
  guiPresent: Record<string, unknown> | undefined,
  guiAskUser: Record<string, unknown> | undefined,
): unknown {
  if (guiAskUser) return withGuiAskUserRuntimeResult(result, guiAskUser, guiPresent);
  if (guiPresent) return withGuiPresentRuntimeResult(result, guiPresent);
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
  const genericMessages: string[] = [];
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
      if ((eventName === 'message_delta' || data.type === 'message_delta') && asString(data.text)) {
        genericMessages.push(asString(data.text)!);
      }
      if ((eventName === 'message' || data.type === 'message') && asString(data.text)) {
        genericMessages.push(asString(data.text)!);
      }
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
      const nativeMessage = genericMessages.join('\n').trim();
      if (isRuntimeCodexDoneEvent(data) && nativeMessage) {
        result = withNativeCodexMessageRuntimeResult(data, nativeMessage);
        return;
      }
      if (!isRuntimeCodexDoneEvent(data)) {
        result = withVisibleRuntimeMessage(data, nativeMessage);
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
  const auditRefs = asStringArray(result.evidenceRefs) ?? asStringArray(guiPresent.evidenceRefs) ?? [];
  const runtimeMetadata = runtimeMetadataForProjection(guiPresent, auditRefs);
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
          artifactRefs: presentation.ref ? [presentation.ref] : [],
        },
        artifacts: presentation.ref ? [{
          ref: presentation.ref,
          label: presentation.title ?? presentation.ref,
          mime: presentation.hint ?? 'markdown',
        }] : [],
        executionProcess: [{
          eventId: `${commandId ?? 'runtime-codex'}:gui-present`,
          type: 'GuiPresent',
          summary: `Runtime Codex rendered completion through ${presentation.source}.`,
          timestamp: asString(result.timestamp) ?? new Date().toISOString(),
        }],
        recoverActions: [],
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
          artifactRefs: artifacts.map((artifact) => artifact.ref),
          confirmationStatus: 'needs-confirmation',
          liveAcceptanceEligible: true,
        },
        artifacts,
        executionProcess,
        recoverActions: askUser.choices?.map((choice) => choice.commandText) ?? [],
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
  };
}

function withNativeCodexMessageRuntimeResult(result: unknown, message: string): unknown {
  if (!message.trim() || !isRecord(result)) return result;
  const output = isRecord(result.output) ? result.output : {};
  const commandId = asString(result.commandId);
  const auditRefs = asStringArray(result.evidenceRefs) ?? [];
  const runtimeMetadata = runtimeMetadataForProjection(result, auditRefs);
  return {
    ...result,
    message,
    nativeCodexMessage: {
      schemaVersion: 'sciforge.runtime-codex-native-message.v1',
      source: commandId ? `codex.native-message:${commandId}` : 'codex.native-message',
      text: message,
      commandId,
      attemptId: asString(result.attemptId),
      provider: asString(result.provider),
      model: asString(result.model),
      profile: asString(result.profile),
      workspace: asString(result.workspace),
      codexSessionId: asString(result.codexSessionId),
      liveAcceptanceEligible: false,
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
          liveAcceptanceEligible: false,
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
          liveAcceptanceEligible: false,
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
    provider: asString(primary.provider),
    model: asString(primary.model),
    profile: asString(primary.profile),
    workspace: asString(primary.workspace),
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
    commandId,
    attemptId: asString(event.attemptId) ?? asString(result.attemptId),
    provider: asString(event.provider) ?? asString(result.provider),
    model: asString(event.model) ?? asString(result.model),
    profile: asString(event.profile) ?? asString(result.profile),
    workspace: asString(event.workspace) ?? asString(result.workspace),
  };
}

function guiAskUserFromEvent(event: Record<string, unknown>, result: Record<string, unknown>) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const nested = isRecord(raw.askUser) ? raw.askUser : {};
  const approvalRequest = isRecord(nested.approvalRequest) ? nested.approvalRequest : undefined;
  const relatedRefs = uniqueStrings([
    ...(asStringArray(nested.relatedRefs) ?? []),
    ...(asStringArray(nested.displayedRefs) ?? []),
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
  const choices = guiChoicesFromValue(nested.choices);
  const text = asString(event.text)
    ?? asString(event.message)
    ?? asString(nested.text)
    ?? formatGuiAskUserText({ title, message, approvalRequest, relatedRefs, choices });
  const commandId = asString(event.commandId) ?? asString(result.commandId);
  return {
    schemaVersion: 'sciforge.runtime-codex-gui-ask-user.v1',
    source: asString(nested.source) ?? asString(raw.source) ?? (commandId ? `gui.ask_user:${commandId}` : 'gui.ask_user'),
    kind: asString(nested.kind) ?? 'confirmation',
    title,
    message,
    text,
    submitCommandTemplate: asString(nested.submitCommandTemplate),
    choices,
    approvalRequest,
    relatedRefs,
    displayedRefs: relatedRefs,
    placement: isRecord(nested.placement) ? nested.placement : undefined,
    commandId,
    attemptId: asString(event.attemptId) ?? asString(result.attemptId),
    provider: asString(event.provider) ?? asString(result.provider),
    model: asString(event.model) ?? asString(result.model),
    profile: asString(event.profile) ?? asString(result.profile),
    workspace: asString(event.workspace) ?? asString(result.workspace),
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
    provider: asString(event.provider),
    model: asString(event.model),
    profile: asString(event.profile),
    workspace: asString(event.workspace),
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
            ref: summary.displayedRefs[0],
            displayedRefs: summary.displayedRefs,
            title: asString(payload.title) ?? 'Computer Use result',
            status: asString(payload.status),
            hint: 'markdown',
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
  const displayedRefs = uniqueStrings([
    ...(asStringArray(payload.traceRefs) ?? []),
    ...(asStringArray(payload.screenshotRefs) ?? []),
    ...(asStringArray(payload.artifactRefs) ?? []),
    ...(asStringArray(payload.executionUnitRefs) ?? []),
    ...(asStringArray(payload.workEvidenceRefs) ?? []),
  ]);
  const lines = [
    '## Computer Use result',
    asString(payload.status) ? `Status: \`${asString(payload.status)}\`` : undefined,
    asString(payload.message),
    displayedRefs.length ? ['Evidence refs:', ...displayedRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
  ].filter(Boolean);
  return {
    text: lines.join('\n\n'),
    displayedRefs,
  };
}

function computerUseAskUserFromAction(payload: Record<string, unknown>) {
  const approvalRequest = isRecord(payload.approvalRequest) ? payload.approvalRequest : {};
  const relatedRefs = uniqueStrings(asStringArray(payload.relatedRefs) ?? []);
  const approvalId = asString(approvalRequest.id)
    ?? asString(approvalRequest.approvalRef)
    ?? asString(approvalRequest.approval_ref);
  const choices = approvalId ? [
    { label: 'Approve', commandText: `/computer-use approve --approval-ref ${quoteCommandArg(approvalId)}`, style: 'primary' },
    { label: 'Cancel', commandText: `/computer-use reject --approval-ref ${quoteCommandArg(approvalId)}`, style: 'secondary' },
  ] : undefined;
  const title = 'Computer Use confirmation required';
  const message = asString(approvalRequest.prompt)
    ?? asString(approvalRequest.message)
    ?? asString(approvalRequest.confirmationText)
    ?? asString(approvalRequest.confirmation_text)
    ?? asString(approvalRequest.reason)
    ?? 'Computer Use requested confirmation before executing a guarded action.';
  return {
    kind: 'confirmation',
    title,
    message,
    text: formatGuiAskUserText({ title, message, approvalRequest, relatedRefs, choices }),
    choices,
    approvalRequest,
    relatedRefs,
    displayedRefs: relatedRefs,
  };
}

function formatGuiAskUserText(input: {
  title: string;
  message?: string;
  approvalRequest?: Record<string, unknown>;
  relatedRefs?: string[];
  choices?: Array<{ label: string; commandText: string; style?: string }>;
}) {
  const risk = asString(input.approvalRequest?.riskLevel)
    ?? asString(input.approvalRequest?.risk_level)
    ?? asString(input.approvalRequest?.risk);
  const approvalRef = asString(input.approvalRequest?.id)
    ?? asString(input.approvalRequest?.approvalRef)
    ?? asString(input.approvalRequest?.approval_ref);
  const actionRef = asString(input.approvalRequest?.actionRef)
    ?? asString(input.approvalRequest?.action_ref);
  const actionKind = asString(input.approvalRequest?.actionKind)
    ?? asString(input.approvalRequest?.action_kind);
  const lines = [
    `## ${input.title}`,
    input.message,
    risk ? `Risk: \`${risk}\`` : undefined,
    approvalRef ? `Approval ref: \`${approvalRef}\`` : undefined,
    actionRef ? `Action ref: \`${actionRef}\`` : undefined,
    !actionRef && actionKind ? `Action kind: \`${actionKind}\`` : undefined,
    input.relatedRefs?.length ? ['Evidence refs:', ...input.relatedRefs.map((ref) => `- \`${ref}\``)].join('\n') : undefined,
    input.choices?.length ? ['Choices:', ...input.choices.map((choice) => `- ${choice.label}: \`${choice.commandText}\``)].join('\n') : undefined,
  ].filter(Boolean);
  return lines.join('\n\n');
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
    || asString(value.profile) === 'sciforge-runtime-deepseek'
    || /Runtime Codex/i.test(asString(value.message) ?? '');
}

export function normalizeWorkspaceRuntimeEvent(raw: unknown): AgentStreamEvent {
  const record = isRecord(raw) ? raw : {};
  const interactionProgressRecord = runtimeInteractionProgressEventFromCompactRecord(record);
  const interactionProgress = interactionProgressRecord ? runtimeInteractionProgressPresentation(interactionProgressRecord) : undefined;
  const type = interactionProgressRecord?.type ?? (asString(record.type) || asString(record.kind) || WORKSPACE_RUNTIME_EVENT_TYPE);
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
  const baseDetail = auditOnlyDetail
    || providerMessageDetail
    || computerUseGuiDetail
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
  if (type !== 'message' && type !== 'message_delta') return undefined;
  if (!isRuntimeCodexEventRecord(record)) return undefined;
  return 'Runtime Codex native assistant message recorded; the final assistant answer can render as the primary reply, while raw JSONL, stderr, and plugin diagnostics stay folded in the run audit.';
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
  if (rawFallback && (isLowInformationStatus(text) || looksPrivateRuntimeText(text))) return rawFallback;
  return text;
}

function isLowInformationStatus(value: string) {
  return /^(?:failed|error|ok|true|false|null|undefined)$/i.test(value.trim());
}

function looksPrivateRuntimeText(value: string) {
  return /^[{[]/.test(value.trim())
    || runtimeTextLooksAuditOnly(value)
    || /\b(?:stdout|stderr|jsonl|rawJsonl|stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(value)
    || /\bhttps?:\/\/[^\s"'<>]+/i.test(value)
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
