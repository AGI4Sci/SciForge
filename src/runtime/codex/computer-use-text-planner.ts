import type { AgentCliAdapter } from './agent-cli-adapter.js';
import { createCodexAppServerRuntimeAdapter } from './codex-runtime-adapter.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';

export const COMPUTER_USE_TEXT_PLANNER_SCHEMA = 'sciforge.computer-use.codex-text-planner.v1';

export interface ComputerUseTextPlannerInput {
  task: string;
  observation: Record<string, unknown>;
  plannerAcceptanceContract?: Record<string, unknown>;
  recentActions: string;
  verifierFeedback: string;
  desktopPlatform: string;
  maxStepsRemaining: number;
  extraInstruction?: string;
}

export interface ComputerUseTextPlannerOptions {
  workspace: string;
  adapter?: AgentCliAdapter;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  commandId?: string;
  attemptId?: string;
  profile?: string;
  abortSignal?: AbortSignal;
  allowOpenAiRuntime?: boolean;
}

export type ComputerUseTextPlannerRun =
  | {
      ok: true;
      text: string;
      raw: {
        schemaVersion: typeof COMPUTER_USE_TEXT_PLANNER_SCHEMA;
        commandId: string;
        attemptId: string;
        codexSessionId?: string;
        diagnosticSummary: string;
        diagnostics: PlannerRunDiagnostics;
        events: PlannerEventSummary[];
      };
    }
  | {
      ok: false;
      reason: string;
      raw: {
        schemaVersion: typeof COMPUTER_USE_TEXT_PLANNER_SCHEMA;
        commandId?: string;
        attemptId?: string;
        codexSessionId?: string;
        diagnosticSummary: string;
        diagnostics: PlannerRunDiagnostics;
        events: PlannerEventSummary[];
      };
    };

type PlannerEventSummary = {
  type: NormalizedAgentEvent['type'];
  status?: string;
  message?: string;
  text?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
  rawEventType?: string;
  rawPayloadType?: string;
  rawItemType?: string;
  rawStatus?: string;
};

type PlannerRunDiagnostics = {
  eventCounts: Record<string, number>;
  terminalEventCounts: Record<string, number>;
  rawJsonlEventCounts: Record<string, number>;
  sawFinalMessage: boolean;
  sawMessageDelta: boolean;
  sawPlannerText: boolean;
  emptyFinal: boolean;
  abort: {
    observed: boolean;
    abortSignalAborted: boolean;
    sources: string[];
    signal?: NodeJS.Signals | string | null;
  };
  lastEvent?: PlannerEventSummary;
};

export async function runComputerUseCodexTextPlanner(
  input: ComputerUseTextPlannerInput,
  options: ComputerUseTextPlannerOptions,
): Promise<ComputerUseTextPlannerRun> {
  const env = plannerRuntimeEnv(options.env ?? process.env);
  const adapter = options.adapter ?? createCodexAppServerRuntimeAdapter({ env });
  const commandText = buildComputerUseTextPlannerCommand(input);
  const turn = await adapter.startTurn({
    commandText,
    workspacePath: options.workspace,
    commandId: options.commandId,
    attemptId: options.attemptId,
    profile: options.profile,
    abortSignal: options.abortSignal,
    allowOpenAiRuntime: options.allowOpenAiRuntime,
    guiExtension: { enabled: false },
  });

  const events: PlannerEventSummary[] = [];
  let finalMessage = '';
  let deltaText = '';
  let failed: NormalizedAgentEvent | undefined;
  for await (const event of turn.events) {
    events.push(summarizePlannerEvent(event));
    if (event.type === 'message' && event.text) finalMessage = event.text;
    if (event.type === 'message_delta' && event.text) deltaText += event.text;
    if (event.type === 'failed' || event.type === 'cancelled') failed = event;
  }

  const text = (finalMessage || deltaText).trim();
  const diagnostics = buildPlannerRunDiagnostics(events, {
    finalText: text,
    abortSignalAborted: options.abortSignal?.aborted ?? false,
  });
  const diagnosticSummary = formatPlannerDiagnosticSummary(diagnostics);

  if (failed) {
    return {
      ok: false,
      reason: withPlannerDiagnosticSummary(
        failed.message || `Runtime Codex planner ${failed.type}.`,
        diagnosticSummary,
      ),
      raw: {
        schemaVersion: COMPUTER_USE_TEXT_PLANNER_SCHEMA,
        commandId: turn.turnId,
        attemptId: turn.attemptId,
        codexSessionId: failed.codexSessionId ?? turn.codexSessionId,
        diagnosticSummary,
        diagnostics,
        events,
      },
    };
  }

  if (!text) {
    return {
      ok: false,
      reason: withPlannerDiagnosticSummary(
        'Runtime Codex text planner completed without final JSON text.',
        diagnosticSummary,
      ),
      raw: {
        schemaVersion: COMPUTER_USE_TEXT_PLANNER_SCHEMA,
        commandId: turn.turnId,
        attemptId: turn.attemptId,
        codexSessionId: turn.codexSessionId,
        diagnosticSummary,
        diagnostics,
        events,
      },
    };
  }

  return {
    ok: true,
    text,
    raw: {
      schemaVersion: COMPUTER_USE_TEXT_PLANNER_SCHEMA,
      commandId: turn.turnId,
      attemptId: turn.attemptId,
      codexSessionId: turn.codexSessionId,
      diagnosticSummary,
      diagnostics,
      events,
    },
  };
}

export async function runComputerUseDirectChatTextPlannerFallback(
  input: ComputerUseTextPlannerInput,
  options: ComputerUseTextPlannerOptions,
  triggerMessage = 'Runtime Codex text planner transport timed out before returning a terminal event.',
): Promise<ComputerUseTextPlannerRun> {
  const triggerEvent: PlannerEventSummary = {
    type: 'failed',
    status: 'model-router-planner-required',
    message: triggerMessage,
    exitCode: null,
    signal: null,
  };
  const events = [triggerEvent];
  const diagnostics = buildPlannerRunDiagnostics(events, {
    finalText: '',
    abortSignalAborted: options.abortSignal?.aborted ?? false,
  });
  const diagnosticSummary = formatPlannerDiagnosticSummary(diagnostics);
  return {
    ok: false,
    reason: withPlannerDiagnosticSummary(
      [
        'Computer Use planner requires the registered Model Router provider/capability path.',
        'Direct OpenAI-compatible chat fallback is disabled so Computer Use cannot silently bypass the Model Router profile.',
        triggerMessage,
      ].join(' '),
      diagnosticSummary,
    ),
    raw: {
      schemaVersion: COMPUTER_USE_TEXT_PLANNER_SCHEMA,
      commandId: options.commandId,
      attemptId: options.attemptId,
      diagnosticSummary,
      diagnostics,
      events,
    },
  };
}

export function buildComputerUseTextPlannerCommand(input: ComputerUseTextPlannerInput) {
  return [
    'You are the SciForge Computer Use planner running inside Runtime Codex CLI/TUI.',
    'You are a text-only planner. Use only the compact observation, visible text, recent action ledger, and verifier feedback below.',
    'Do not inspect screenshots, files, GUI state, DOM, accessibility trees, browser automation state, selectors, HTML, app private APIs, or external resources. Do not call tools.',
    'Screenshot paths and refs are opaque evidence identifiers for the Grounder/Verifier; do not open them and do not infer pixel positions from them.',
    'Return exactly one JSON object and no markdown, prose, code fences, or tool calls.',
    'Allowed success shapes:',
    '{"done":true,"reason":"task is already complete from the compact observation and action ledger","actions":[]}',
    '{"done":false,"reason":"short next-step reason","actions":[{"type":"click","targetDescription":"visible target","targetRegionDescription":"optional larger visible region"}]}',
    '{"done":false,"reason":"short app launch reason","actions":[{"type":"open_app","appName":"Safari"}]}',
    '{"done":false,"reason":"short text entry reason","actions":[{"type":"type_text","text":"literal text to type"}]}',
    '{"done":false,"reason":"short keypress reason","actions":[{"type":"press_key","key":"Enter"}]}',
    'Allowed structured failure shape:',
    '{"done":false,"reason":"why no safe generic action is available","actions":[],"failure":{"code":"blocked-or-insufficient-observation","recoverable":true}}',
    'When not done and not failing, actions must contain exactly one generic action.',
    'If the task needs multiple GUI actions, return only the single next unexecuted action for this turn; a later planner turn will choose the following action after verifier feedback.',
    'Use Recent actions as authoritative history. Do not repeat an already executed open_app, type_text, press_key, hotkey, click, drag, scroll, or wait action unless verifier feedback explicitly asks for retry.',
    'Allowed action types: open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, wait.',
    'For open_app, appName is required. Do not use targetDescription, target, selector, or application-private launch fields for app launch.',
    'For type_text, text is required and must be the exact literal text to type. Do not put text in targetDescription.',
    'For press_key, key is required, for example "Enter", "Tab", or "Escape".',
    'For hotkey, keys is required as an array of generic key names, for example ["command","space"].',
    'For scroll, direction is required and must be one of up, down, left, right.',
    'For click and double_click, targetDescription is required. For drag, fromTargetDescription and toTargetDescription are required.',
    'Never output coordinate fields: x, y, fromX, fromY, toX, toY, bbox, bounds, selector, elementId, accessibilityId.',
    'Use targetDescription/fromTargetDescription/toTargetDescription text for visual targets; Grounder owns all coordinates.',
    'Hotkeys must be generic platform recovery only, not app-private shortcuts.',
    'Never use Command+S, Ctrl+S, browser/app save shortcuts, or menu shortcuts for save/export workflows. Use visible in-window controls, file dialogs, filename/path fields, and visible Save/Open/OK buttons only.',
    'If the task explicitly requires saving/exporting an artifact, task-required Save, Save As, filename/path, location, and file dialog UI is in scope. Do not dismiss those dialogs. Dismiss only unrelated save/login/permission dialogs.',
    'For visually ambiguous toolbars or title bars, do not target neighboring toggles, navigation icons, or action clusters by proximity alone. Describe the intended visible label/icon/shape, and name a targetRegionDescription that excludes nearby non-target controls.',
    'Never describe an intended target as "near" a non-target control or put the non-target control in the positive target region. If nearby controls must be mentioned, mention them only as excluded or avoided non-target controls.',
    'Do not target a File menu/tab unless it is visibly inside the captured target window. If a File menu is only in the macOS menu bar outside a target-window screenshot, choose another visible in-window save control or return the structured failure JSON shape.',
    'The current compact observation is the only truth source for what is visible now. Recent action targetDescription text and verifier pixel changes are history only; they do not prove a File, Save As, Browse, filename/path field, or dialog is currently visible.',
    'For save workflows, do not claim File, Save As, Browse, filename/path, location, or file-dialog controls are visible unless the current compact observation summary, visibleTexts, or window title explicitly contains that label or a save/open/file-dialog marker.',
    'For labeled save/file controls, only target them when current observation.visibleTexts, the observation summary, or the window title contains matching label/context: File/文件, Save As/另存为, Browse/浏览, filename/file name/文件名, path/location/where/路径/位置, Save/Open/Choose/保存/打开/选择.',
    'A prior click with verifier no-effect or changed=false does not prove a new dialog/control exists. If the current observation still shows the editor/canvas/ribbon, re-evaluate from that visible state instead of following the intended save route.',
    'Never say a dialog "should now be visible." If the window title is still a document title and visibleTexts still show editor/ribbon/canvas text, treat the dialog as absent. Choose another currently visible control or return the structured failure JSON shape.',
    'Do not type a filesystem path until the compact observation shows a visible Save/Save As/Open/Choose dialog or filename/path/location field. First click that visible filename/path/location field; then type the literal path in a later planner turn.',
    'High-risk send/delete/pay/authorize/publish/submit actions must use riskLevel="high" and requiresConfirmation=true.',
    'Do not mark ordinary focus, selection, inspection, text-field, search-field, checkbox, radio, dropdown, menu, toggle, switch, or scroll actions as high risk unless the target itself is a high-risk send/delete/pay/authorize/publish/submit/upload/share/overwrite control.',
    'When the task or current round asks for low-risk controls, inspection, visual evidence, or action quota, use only visibly safe targets such as text fields, search/filter fields, checkboxes, radios, dropdowns, menus, tabs, toggles, scroll areas, blank content areas, or focus/selection targets.',
    'Never use Export, Share, Save, Save As, Submit, Send, Delete, Remove, Pay, Purchase, Authorize, Approve, Publish, Upload, Overwrite, Replace, Login, or Sign in controls as low-risk quota filler. If only those controls are visible, return the structured failure JSON shape instead of choosing them.',
    'If Planner acceptance contract JSON is present, use it to scope this planner turn without inventing evidence.',
    'When the contract includes roundPrompt or expectedTrace, treat that current round as the completion scope: satisfy the visible round prompt and expectedTrace with compact observation, Recent actions, and verifier feedback.',
    'Scenario-level acceptance, requirements, requiredEvidence, validationContract, and safetyBoundary are constraints and future-round context; do not try to satisfy every scenario-level acceptance item inside one round unless the current roundPrompt or expectedTrace explicitly asks for it.',
    'Use the acceptance contract to choose the next missing evidence-producing generic action for the current completion scope. Return done=true when the compact observation, Recent actions, and verifier feedback already support that current scope.',
    'If the current roundPrompt, expectedTrace, or requirements ask for a final artifact, evidence summary, action mapping, field/control evidence summary, or refs-first report, do not finish with only screenshots or clicks. First produce a visible typed/exported artifact using safe generic actions, then let the host surface its artifact refs and gui.present metadata.',
    'For round-scoped Computer Use validation, the current round needs at least one non-wait GUI action in Recent actions to produce executor and verifier evidence. If this round has no executed GUI actions yet, do not return done=true; emit one safe low-risk visible focus, cancel, navigation, selection, or inspection action, or return a structured failure if none is safe.',
    'If acceptanceProgress specifies suggestedCurrentRoundActionTarget or suggestedCurrentRoundNonWaitActionTarget, treat it as a minimum evidence-producing action quota for this current round. While Recent actions show fewer current-round executed GUI actions than that quota and maxStepsRemaining is positive, prefer the next safe visible generic action over done=true; return structured failure only when no safe visible action remains.',
    'If acceptanceProgress includes observedScenarioActionCount or remainingScenarioActionCount, the current-round quota may include prior-round shortfall; do not stop at an even per-round average when the contract asks this round to cover remaining scenario actions.',
    'Do not count prior-round actions or scenario-level summaries as current-round GUI evidence. Prior-round refs may guide safety, but only this round Recent actions and verifier feedback prove current-round execution.',
    'Never invent evidence from the acceptance contract; it describes required outcomes, not current GUI state.',
    input.extraInstruction ? `Additional contract instruction: ${input.extraInstruction}` : undefined,
    '',
    `desktopPlatform: ${input.desktopPlatform}`,
    `maxStepsRemaining: ${input.maxStepsRemaining}`,
    '',
    'Task:',
    input.task,
    '',
    input.plannerAcceptanceContract ? 'Planner acceptance contract JSON:' : undefined,
    input.plannerAcceptanceContract ? boundedJson(input.plannerAcceptanceContract) : undefined,
    input.plannerAcceptanceContract ? '' : undefined,
    'Compact observation JSON:',
    boundedJson(input.observation),
    '',
    'Recent actions:',
    input.recentActions || 'No GUI actions have executed yet in this run.',
    '',
    'Verifier feedback:',
    input.verifierFeedback || 'No verifier feedback yet.',
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

function plannerRuntimeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    SCIFORGE_RUNTIME_CODEX_SANDBOX: env.SCIFORGE_RUNTIME_CODEX_PLANNER_SANDBOX
      || env.SCIFORGE_RUNTIME_CODEX_SANDBOX
      || 'read-only',
  };
}

function summarizePlannerEvent(event: NormalizedAgentEvent): PlannerEventSummary {
  const raw = isRecord(event.raw) ? event.raw : undefined;
  const payload = isRecord(raw?.payload) ? raw.payload : undefined;
  const item = isRecord(raw?.item)
    ? raw.item
    : isRecord(payload?.item)
      ? payload.item
      : isRecord(payload)
        ? payload
        : undefined;
  return {
    type: event.type,
    status: event.status,
    message: boundText(event.message, 320),
    text: boundText(event.text, 320),
    exitCode: event.exitCode,
    signal: event.signal,
    rawEventType: boundText(stringField(raw?.type) ?? stringField(raw?.event), 120),
    rawPayloadType: boundText(stringField(payload?.type), 120),
    rawItemType: boundText(stringField(item?.type), 120),
    rawStatus: boundText(stringField(raw?.status) ?? stringField(item?.status), 120),
  };
}

function buildPlannerRunDiagnostics(
  events: PlannerEventSummary[],
  input: { finalText: string; abortSignalAborted: boolean },
): PlannerRunDiagnostics {
  const eventCounts = countBy(events, (event) => event.type);
  const terminalEventCounts = countBy(
    events.filter((event) => event.type === 'done' || event.type === 'failed' || event.type === 'cancelled'),
    (event) => event.type,
  );
  const rawJsonlEventCounts = countBy(
    events.filter((event) => event.status === 'raw-jsonl'),
    (event) => event.rawEventType ?? event.rawPayloadType ?? event.rawItemType ?? 'unknown',
  );
  const sawFinalMessage = events.some((event) => event.type === 'message' && Boolean(event.text));
  const sawMessageDelta = events.some((event) => event.type === 'message_delta' && Boolean(event.text));
  const signalEvent = events.find((event) => event.signal);
  const cancelledEvent = events.find((event) => event.type === 'cancelled');
  const abortSources = [
    input.abortSignalAborted ? 'abort-signal' : undefined,
    cancelledEvent ? 'cancelled-event' : undefined,
    signalEvent ? 'terminal-signal' : undefined,
  ].filter((source): source is string => Boolean(source));

  return {
    eventCounts,
    terminalEventCounts,
    rawJsonlEventCounts,
    sawFinalMessage,
    sawMessageDelta,
    sawPlannerText: Boolean(input.finalText),
    emptyFinal: !input.finalText,
    abort: {
      observed: abortSources.length > 0,
      abortSignalAborted: input.abortSignalAborted,
      sources: [...new Set(abortSources)],
      signal: signalEvent?.signal ?? cancelledEvent?.signal,
    },
    lastEvent: events[events.length - 1],
  };
}

function formatPlannerDiagnosticSummary(diagnostics: PlannerRunDiagnostics): string {
  const eventCounts = formatCounts(diagnostics.eventCounts) || 'none';
  const terminalEventCounts = formatCounts(diagnostics.terminalEventCounts) || 'none';
  const rawJsonlEventCounts = formatCounts(diagnostics.rawJsonlEventCounts) || 'none';
  const abort = diagnostics.abort.observed
    ? [
        `aborted=true`,
        diagnostics.abort.sources.length ? `sources=${diagnostics.abort.sources.join('+')}` : undefined,
        diagnostics.abort.signal ? `signal=${diagnostics.abort.signal}` : undefined,
      ].filter(Boolean).join(',')
    : `aborted=false`;
  return [
    `eventCounts=${eventCounts}`,
    `terminalEventCounts=${terminalEventCounts}`,
    `rawJsonlEventCounts=${rawJsonlEventCounts}`,
    `plannerText=message:${diagnostics.sawFinalMessage ? 'yes' : 'no'},delta:${diagnostics.sawMessageDelta ? 'yes' : 'no'},emptyFinal:${diagnostics.emptyFinal ? 'yes' : 'no'}`,
    abort,
  ].join('; ');
}

function withPlannerDiagnosticSummary(reason: string, diagnosticSummary: string) {
  return `${reason} Diagnostics: ${diagnosticSummary}.`;
}

function countBy<T>(values: T[], keyForValue: (value: T) => string | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyForValue(value);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join(',');
}

function boundedJson(value: unknown) {
  const json = JSON.stringify(value, null, 2);
  return json.length <= 8000 ? json : `${json.slice(0, 8000)}\n...truncated...`;
}

function boundText(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
