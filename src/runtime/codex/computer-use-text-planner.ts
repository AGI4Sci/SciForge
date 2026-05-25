import type { AgentCliAdapter } from './agent-cli-adapter.js';
import { CodexExecJsonAdapter } from './codex-exec-json-adapter.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';

export const COMPUTER_USE_TEXT_PLANNER_SCHEMA = 'sciforge.computer-use.codex-text-planner.v1';

export interface ComputerUseTextPlannerInput {
  task: string;
  observation: Record<string, unknown>;
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

  if (failed) {
    return {
      ok: false,
      reason: failed.message || `Runtime Codex planner ${failed.type}.`,
      raw: {
        schemaVersion: COMPUTER_USE_TEXT_PLANNER_SCHEMA,
        commandId: turn.turnId,
        attemptId: turn.attemptId,
        codexSessionId: failed.codexSessionId ?? turn.codexSessionId,
        events,
      },
    };
  }

  const text = (finalMessage || deltaText).trim();
  if (!text) {
    return {
      ok: false,
      reason: 'Runtime Codex text planner completed without final JSON text.',
      raw: {
        schemaVersion: COMPUTER_USE_TEXT_PLANNER_SCHEMA,
        commandId: turn.turnId,
        attemptId: turn.attemptId,
        codexSessionId: turn.codexSessionId,
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
    input.extraInstruction ? `Additional contract instruction: ${input.extraInstruction}` : undefined,
    '',
    `desktopPlatform: ${input.desktopPlatform}`,
    `maxStepsRemaining: ${input.maxStepsRemaining}`,
    '',
    'Task:',
    input.task,
    '',
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
  return {
    type: event.type,
    status: event.status,
    message: boundText(event.message, 320),
    text: boundText(event.text, 320),
    exitCode: event.exitCode,
    signal: event.signal,
  };
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
