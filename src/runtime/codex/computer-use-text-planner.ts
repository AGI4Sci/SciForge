import type { AgentCliAdapter } from './agent-cli-adapter.js';
import { CodexExecJsonAdapter } from './codex-exec-json-adapter.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';
import {
  chatCompletionToResponse,
  responsesToChatCompletions,
  type ResponsesRequest,
} from '../../../packages/backend/src/response-compat.js';

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
  const adapter = options.adapter ?? new CodexExecJsonAdapter({ env });
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
    const fallback = await runDirectChatPlannerFallback(commandText, options, diagnostics, events);
    if (fallback.ok) return fallback;
    return {
      ok: false,
      reason: withPlannerDiagnosticSummary(
        [failed.message || `Runtime Codex planner ${failed.type}.`, fallback.reason].filter(Boolean).join(' '),
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
    const fallback = await runDirectChatPlannerFallback(commandText, options, diagnostics, events);
    if (fallback.ok) return fallback;
    return {
      ok: false,
      reason: withPlannerDiagnosticSummary(
        ['Runtime Codex text planner completed without final JSON text.', fallback.reason].filter(Boolean).join(' '),
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
  const commandText = buildComputerUseTextPlannerCommand(input);
  const triggerEvent: PlannerEventSummary = {
    type: 'failed',
    status: 'direct-chat-fallback-trigger',
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
  const fallback = await runDirectChatPlannerFallback(commandText, options, diagnostics, events, { force: true });
  if (fallback.ok) return fallback;
  return {
    ok: false,
    reason: withPlannerDiagnosticSummary(
      ['Direct chat planner fallback failed after Runtime Codex planner transport timeout.', fallback.reason].filter(Boolean).join(' '),
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

type DirectChatFallbackResult =
  | Extract<ComputerUseTextPlannerRun, { ok: true }>
  | { ok: false; reason?: string };

async function runDirectChatPlannerFallback(
  commandText: string,
  options: ComputerUseTextPlannerOptions,
  codexDiagnostics: PlannerRunDiagnostics,
  codexEvents: PlannerEventSummary[],
  fallbackOptions: { force?: boolean } = {},
): Promise<DirectChatFallbackResult> {
  const env = options.env ?? process.env;
  if (env.SCIFORGE_COMPUTER_USE_DIRECT_TEXT_PLANNER === '0') return { ok: false };
  if (!fallbackOptions.force && !shouldUseDirectChatPlannerFallback(codexEvents)) return { ok: false };
  if (options.abortSignal?.aborted) return { ok: false, reason: 'Direct chat fallback skipped because the planner was aborted.' };
  const config = directChatPlannerConfig(env);
  if (!config.ok) {
    return {
      ok: false,
      reason: `Direct chat planner fallback skipped because config is incomplete. Missing env: ${config.missing.join('; ')}.`,
    };
  }

  const timeoutMs = positiveInteger(env.SCIFORGE_COMPUTER_USE_DIRECT_TEXT_PLANNER_TIMEOUT_MS) ?? 90000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  options.abortSignal?.addEventListener('abort', abort, { once: true });
  const startedEvent: PlannerEventSummary = {
    type: 'audit',
    status: 'direct-chat-fallback-started',
    message: `Direct OpenAI-compatible text planner fallback started with model ${config.value.model}.`,
  };
  const events = [...codexEvents, startedEvent];
  try {
    const maxAttempts = Math.min(5, 1 + (positiveInteger(env.SCIFORGE_COMPUTER_USE_DIRECT_TEXT_PLANNER_RETRIES) ?? 2));
    let lastFailure: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let bodyText = '';
      try {
        const response = await (options.fetchImpl ?? fetch)(`${config.value.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.value.apiKey}`,
          },
          body: JSON.stringify(directChatPlannerRequest(commandText, config.value, env)),
          signal: controller.signal,
        });
        bodyText = await response.text();
        if (!response.ok) {
          lastFailure = `HTTP ${response.status}: ${scrubDirectChatText(bodyText)}`;
          if (attempt < maxAttempts && shouldRetryDirectChatFallbackStatus(response.status)) {
            await sleep(directChatPlannerRetryDelayMs(attempt), controller.signal);
            continue;
          }
          return {
            ok: false,
            reason: `Direct chat planner fallback failed after ${attempt}/${maxAttempts} attempt(s): ${lastFailure}.`,
          };
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        lastFailure = directChatPlannerErrorMessage(error);
        if (attempt < maxAttempts) {
          await sleep(directChatPlannerRetryDelayMs(attempt), controller.signal);
          continue;
        }
        return {
          ok: false,
          reason: `Direct chat planner fallback failed after ${attempt}/${maxAttempts} attempt(s): ${lastFailure}.`,
        };
      }
      const content = directChatPlannerResponseText(bodyText, config.value.model);
      if (!content) {
        return {
          ok: false,
          reason: 'Direct chat planner fallback returned no Responses output_text.',
        };
      }
      const fallbackEvents = [
        ...events,
        ...(attempt > 1 ? [{
          type: 'audit' as const,
          status: 'direct-chat-fallback-retried',
          message: `Direct OpenAI-compatible text planner fallback completed after ${attempt}/${maxAttempts} attempts.`,
        }] : []),
        {
          type: 'message' as const,
          status: 'direct-chat-fallback',
          text: boundText(content, 320),
        },
        {
          type: 'done' as const,
          status: 'direct-chat-fallback',
          message: 'Direct OpenAI-compatible text planner fallback completed.',
          exitCode: 0,
          signal: null,
        },
      ];
      const diagnostics = buildPlannerRunDiagnostics(fallbackEvents, {
        finalText: content,
        abortSignalAborted: options.abortSignal?.aborted ?? false,
      });
      return {
        ok: true,
        text: content.trim(),
        raw: {
          schemaVersion: COMPUTER_USE_TEXT_PLANNER_SCHEMA,
          commandId: options.commandId ?? 'codex-computer-use-plan-direct-chat-fallback',
          attemptId: options.attemptId ?? 'codex-computer-use-plan-direct-chat-fallback-attempt',
          diagnosticSummary: [
            'directChatFallback=used',
            `directChatAttempts=${attempt}/${maxAttempts}`,
            `codexDiagnostics=${formatPlannerDiagnosticSummary(codexDiagnostics)}`,
            formatPlannerDiagnosticSummary(diagnostics),
          ].join('; '),
          diagnostics,
          events: fallbackEvents,
        },
      };
    }
    return { ok: false, reason: `Direct chat planner fallback did not run. ${lastFailure ?? ''}`.trim() };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError'
      ? 'Direct chat planner fallback timed out or was aborted.'
      : `Direct chat planner fallback failed: ${error instanceof Error ? error.message : String(error)}.`;
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
    options.abortSignal?.removeEventListener('abort', abort);
  }
}

function shouldRetryDirectChatFallbackStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function directChatPlannerRetryDelayMs(attempt: number) {
  return Math.min(2000, 250 * 2 ** Math.max(0, attempt - 1));
}

async function sleep(ms: number, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

type DirectChatPlannerConfig =
  | {
      ok: true;
      value: {
        apiKey: string;
        baseUrl: string;
        model: string;
      };
    }
  | {
      ok: false;
      missing: string[];
    };

function directChatPlannerConfig(env: NodeJS.ProcessEnv): DirectChatPlannerConfig {
  const apiKey = firstNonEmpty(env.SCIFORGE_RUNTIME_API_KEY);
  const baseUrl = stripTrailingSlash(firstNonEmpty(
    env.SCIFORGE_COMPUTER_USE_TEXT_PLANNER_BASE_URL,
    env.SCIFORGE_PROXY_UPSTREAM_BASE_URL,
    env.SCIFORGE_RUNTIME_BASE_URL,
  ));
  const model = firstNonEmpty(
    env.SCIFORGE_COMPUTER_USE_TEXT_PLANNER_MODEL,
    env.SCIFORGE_RUNTIME_MODEL,
    env.SCIFORGE_PROXY_DEFAULT_MODEL,
  );
  const missing = [
    !apiKey ? 'SCIFORGE_RUNTIME_API_KEY' : undefined,
    !baseUrl ? 'one of SCIFORGE_COMPUTER_USE_TEXT_PLANNER_BASE_URL, SCIFORGE_PROXY_UPSTREAM_BASE_URL, SCIFORGE_RUNTIME_BASE_URL' : undefined,
    !model ? 'one of SCIFORGE_COMPUTER_USE_TEXT_PLANNER_MODEL, SCIFORGE_RUNTIME_MODEL, SCIFORGE_PROXY_DEFAULT_MODEL' : undefined,
  ].filter((value): value is string => Boolean(value));
  if (!apiKey || !baseUrl || !model) return { ok: false, missing };
  return { ok: true, value: { apiKey, baseUrl, model } };
}

function directChatPlannerRequest(
  commandText: string,
  config: Extract<DirectChatPlannerConfig, { ok: true }>['value'],
  env: NodeJS.ProcessEnv,
) {
  const responsesRequest: ResponsesRequest = {
    model: config.model,
    input: commandText,
    stream: false,
    temperature: 0,
    max_output_tokens: positiveInteger(env.SCIFORGE_COMPUTER_USE_DIRECT_TEXT_PLANNER_MAX_TOKENS) ?? 768,
    metadata: { source: 'computer-use-direct-text-planner-fallback' },
  };
  const chatRequest = responsesToChatCompletions(responsesRequest, { defaultModel: config.model });
  chatRequest.stream = false;
  return chatRequest;
}

function directChatPlannerResponseText(bodyText: string, model: string) {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    const response = chatCompletionToResponse(parsed, { model });
    return stringField(response.output_text)?.trim();
  } catch {
    return undefined;
  }
}

function shouldUseDirectChatPlannerFallback(events: PlannerEventSummary[]) {
  const text = events.map((event) => [
    event.status,
    event.message,
    event.text,
    event.rawEventType,
    event.rawPayloadType,
    event.rawItemType,
    event.rawStatus,
    event.exitCode === 1 ? 'exit-code-1' : undefined,
  ].filter(Boolean).join(' ')).join(' ').toLowerCase();
  return /(?:502|503|504|bad gateway|gateway timeout|service unavailable|timeout|timed out|econnreset|econnrefused|enotfound|fetch failed|socket hang up|connection reset|network error|transport|proxy|upstream|tls|ssl|certificate)/i.test(text);
}

function scrubDirectChatText(value: string) {
  return boundText(value.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]'), 320);
}

function directChatPlannerErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return scrubDirectChatText(String(error));
  const cause = error.cause instanceof Error ? `; cause=${error.cause.message}` : '';
  return scrubDirectChatText(`${error.message}${cause}`);
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value): value is string => Boolean(value?.trim()))?.trim();
}

function stripTrailingSlash(value: string | undefined) {
  return value?.replace(/\/+$/, '');
}

function positiveInteger(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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
    'For macOS PowerPoint-style title bars, do not target the AutoSave toggle or Home/house icon. If saving from the editor, target the small floppy-disk Save icon immediately to the right of the Home/house icon, and name a targetRegionDescription that excludes AutoSave.',
    'Never describe a Save icon as "near AutoSave" or put AutoSave in the positive target region. If AutoSave is mentioned at all, mention it only as an excluded/avoided non-target control; use stable anchors such as the Home/house icon and undo controls.',
    'Do not target a File menu/tab unless it is visibly inside the captured target window. If a File menu is only in the macOS menu bar outside a target-window screenshot, choose another visible in-window save control or return the structured failure JSON shape.',
    'The current compact observation is the only truth source for what is visible now. Recent action targetDescription text and verifier pixel changes are history only; they do not prove a File, Save As, Browse, filename/path field, or dialog is currently visible.',
    'For save workflows, do not claim File, Save As, Browse, filename/path, location, or file-dialog controls are visible unless the current compact observation summary, visibleTexts, or window title explicitly contains that label or a save/open/file-dialog marker.',
    'For labeled save/file controls, only target them when current observation.visibleTexts, the observation summary, or the window title contains matching label/context: File/文件, Save As/另存为, Browse/浏览, filename/file name/文件名, path/location/where/路径/位置, Save/Open/Choose/保存/打开/选择.',
    'A prior click with verifier no-effect or changed=false does not prove a new dialog/control exists. If the current observation still shows the editor/canvas/ribbon, re-evaluate from that visible state instead of following the intended save route.',
    'Never say a dialog "should now be visible." If the window title is still a document title and visibleTexts still show editor/ribbon/canvas text, treat the dialog as absent. Choose another currently visible control or return the structured failure JSON shape.',
    'Do not type a filesystem path until the compact observation shows a visible Save/Save As/Open/Choose dialog or filename/path/location field. First click that visible filename/path/location field; then type the literal path in a later planner turn.',
    'High-risk send/delete/pay/authorize/publish/submit actions must use riskLevel="high" and requiresConfirmation=true.',
    'If Planner acceptance contract JSON is present, use it to scope this planner turn without inventing evidence.',
    'When the contract includes roundPrompt or expectedTrace, treat that current round as the completion scope: satisfy the visible round prompt and expectedTrace with compact observation, Recent actions, and verifier feedback.',
    'Scenario-level acceptance, requirements, requiredEvidence, validationContract, and safetyBoundary are constraints and future-round context; do not try to satisfy every scenario-level acceptance item inside one round unless the current roundPrompt or expectedTrace explicitly asks for it.',
    'Use the acceptance contract to choose the next missing evidence-producing generic action for the current completion scope. Return done=true when the compact observation, Recent actions, and verifier feedback already support that current scope.',
    'For round-scoped Computer Use validation, the current round needs at least one non-wait GUI action in Recent actions to produce executor and verifier evidence. If this round has no executed GUI actions yet, do not return done=true; emit one safe low-risk visible focus, cancel, navigation, selection, or inspection action, or return a structured failure if none is safe.',
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
