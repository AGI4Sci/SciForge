import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { isRecord, toStringList, uniqueStrings } from '../gateway-utils.js';
import { groundingForAction, normalizePlatformAction, parseGenericActions, platformActionIssue, platformLauncherGuidance, trimLeadingWaitActions } from '../computer-use/actions.js';
import { toTraceScreenshotRef } from '../computer-use/capture.js';
import type { ComputerUseConfig as VisionSenseConfig, FocusRegion, GenericVisionAction, GroundingResolution, LoopStep, PlannerContractIssue, ScreenshotRef, TraceWindowTarget, VisionPlannerConfig } from '../computer-use/types.js';
import { extractChatCompletionContent, extractJsonObject, isDarwinPlatform, numberConfig, parseJson, platformLabel, runCommand, sanitizeId } from '../computer-use/utils.js';
import { isWindowLocalCoordinateSpace } from '../computer-use/window-target.js';
import { isHighRiskVisionSenseGuiRequest, visionSensePlannerPromptPolicy } from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import {
  actionLedgerCompletionPolicy,
  rewriteGenericPlannerActionPolicy,
  shouldTolerateDenseUiNoEffectActionPolicy,
  visibleArtifactCompletionGapPolicy,
  type ActionLedgerCompletionPolicy,
} from './computer-use-policy-bridge.js';

const PLANNER_IMAGE_MAX_EDGE = Math.max(256, numberConfig(process.env.SCIFORGE_VISION_PLANNER_IMAGE_MAX_EDGE) ?? 512);
export async function appendPlannerStep(params: {
  id: string;
  task: string;
  screenshotRefs: ScreenshotRef[];
  steps: LoopStep[];
  config: VisionSenseConfig;
}) {
  const plannerStepTimeoutMs = Math.max(
    params.config.planner.timeoutMs + 10_000,
    params.config.planner.timeoutMs * 2 + 5_000,
  );
  const plannerResult = await withHardTimeout(
    planGenericActionsFromScreenshot(params.task, params.screenshotRefs[0], params.config, params.steps),
    plannerStepTimeoutMs,
    `VisionPlanner step timed out after ${plannerStepTimeoutMs}ms`,
  ).catch((error) => ({
    ok: false as const,
    actions: [],
    done: false as const,
    reason: error instanceof Error ? error.message : String(error),
    rawResponse: undefined,
  }));
  const hasActions = plannerResult.ok && plannerResult.actions.length > 0;
  params.steps.push({
    id: params.id,
    kind: 'planning',
    status: plannerResult.ok && (hasActions || plannerResult.done) ? 'done' : 'blocked',
    beforeScreenshotRefs: params.screenshotRefs.map(toTraceScreenshotRef),
    verifier: {
      status: plannerResult.ok ? 'checked' : 'blocked',
      reason: plannerResult.ok
        ? plannerResult.done
          ? plannerResult.reason || 'planner reported task done'
          : hasActions
            ? 'planner emitted generic action plan'
            : 'planner emitted no actions'
        : plannerResult.reason,
    },
    execution: {
      planner: 'openai-compatible-vision-planner',
      model: params.config.planner.model,
      status: plannerResult.ok && (hasActions || plannerResult.done) ? 'done' : 'blocked',
      rawResponse: plannerResult.rawResponse,
    },
    failureReason: plannerResult.ok && (hasActions || plannerResult.done) ? undefined : plannerResult.reason || 'VisionPlanner emitted no executable generic actions.',
  });
  return plannerResult;
}

async function planGenericActionsFromScreenshot(
  task: string,
  screenshot: ScreenshotRef | undefined,
  config: VisionSenseConfig,
  steps: LoopStep[] = [],
): Promise<{ ok: true; actions: GenericVisionAction[]; done: boolean; reason?: string; rawResponse: unknown } | { ok: false; actions: []; done: false; reason: string; rawResponse?: unknown }> {
  if (!screenshot) return { ok: false, actions: [], done: false, reason: 'VisionPlanner could not run because no screenshot was captured.' };
  const modelIssue = visionModelIssue(config.planner.model);
  if (modelIssue) return { ok: false, actions: [], done: false, reason: `VisionPlanner model is not configured as a VLM: ${modelIssue}` };
  const runHistory = plannerRunHistory(steps);
  const firstAttempt = await requestGenericPlannerActions(task, screenshot, config, undefined, runHistory);
  if (!firstAttempt.ok && firstAttempt.retryableContractViolation) {
    const retry = await requestGenericPlannerActions(
      task,
      screenshot,
      config,
      plannerRetryInstruction(firstAttempt.contractIssue, config),
      runHistory,
    );
    return retry.ok ? retry : firstAttempt;
  }
  if (!firstAttempt.ok) return firstAttempt;
  if (!firstAttempt.done && (firstAttempt.actions.length === 0 || firstAttempt.actions.every((action) => action.type === 'wait'))) {
    const retry = await requestGenericPlannerActions(
      task,
      screenshot,
      config,
      `The current screenshot has already been captured. Do not return an empty action list or wait as the only action unless done=true. For an underspecified GUI sub-task, choose a conservative non-destructive screen action from the current screenshot, such as scroll on the main visible content, press Escape to dismiss transient overlays, ${platformRecoveryGuidance(config)}, or click a clearly described visible low-risk target. Return at least one non-wait action: click, double_click, drag, type_text, press_key, hotkey, or scroll; or set done=true with actions=[] if the task is complete.`,
      runHistory,
    );
    if (!retry.ok) return retry;
    if (!retry.done && (retry.actions.length === 0 || retry.actions.every((action) => action.type === 'wait'))) {
      if (isHighRiskVisionSenseGuiRequest(task)) {
        return {
          ok: true,
          actions: [{
            type: 'click',
            targetDescription: 'the visible high-risk control requested by the task',
            riskLevel: 'high',
            requiresConfirmation: true,
          }],
          done: false,
          reason: 'High-risk GUI request must fail closed before executor until upstream confirmation is present.',
          rawResponse: retry.rawResponse,
        };
      }
      return {
        ok: false,
        actions: [],
        done: false,
        reason: 'VisionPlanner retried but still emitted no non-wait executable generic actions.',
        rawResponse: retry.rawResponse,
      };
    }
    return guardPlannerNoEffectRepeat(task, screenshot, config, steps, retry, runHistory);
  }
  return guardPlannerNoEffectRepeat(task, screenshot, config, steps, firstAttempt, runHistory);
}

async function guardPlannerNoEffectRepeat(
  task: string,
  screenshot: ScreenshotRef,
  config: VisionSenseConfig,
  steps: LoopStep[],
  attempt: { ok: true; actions: GenericVisionAction[]; done: boolean; reason?: string; rawResponse: unknown },
  runHistory: string,
) {
  const repeated = repeatedNoEffectRoute(attempt.actions, steps);
  if (!repeated || attempt.done) return attempt;
  const retry = await requestGenericPlannerActions(
    task,
    screenshot,
    config,
    [
      `Your previous action repeats a recent no-visible-effect route: ${repeated}.`,
      'The Verifier says that route did not visibly change the target window. Do not use the same action type, same targetDescription/targetRegionDescription, or same scroll direction again.',
      'Choose a different visible generic GUI route from the current screenshot, switch input modality, ask for a local observation using wait with a different targetRegionDescription, or set done=true with actions=[] only if the screenshot already satisfies the round goal.',
    ].join(' '),
    runHistory,
  );
  if (!retry.ok) return retry;
  const repeatedAgain = repeatedNoEffectRoute(retry.actions, steps);
  if (!retry.done && repeatedAgain) {
    return {
      ok: false as const,
      actions: [] as [],
      done: false as const,
      reason: `VisionPlanner repeated a no-visible-effect action route after retry (${repeatedAgain}). The generic planner must choose a different visible route or query a different region before more GUI execution.`,
      rawResponse: retry.rawResponse,
    };
  }
  return retry;
}

export async function rewriteGenericPlannerAction(action: GenericVisionAction, config: VisionSenseConfig, steps: LoopStep[], task: string): Promise<GenericVisionAction> {
  return await rewriteGenericPlannerActionPolicy(action, config, steps, task) ?? action;
}

export async function actionLedgerCompletion(task: string, steps: LoopStep[]): Promise<ActionLedgerCompletionPolicy> {
  return await actionLedgerCompletionPolicy(task, steps) ?? { complete: false };
}

export async function shouldTolerateDenseUiNoEffectAction(task: string, steps: LoopStep[], action: GenericVisionAction) {
  return await shouldTolerateDenseUiNoEffectActionPolicy(task, steps, action) ?? false;
}

export async function visibleArtifactCompletionGap(task: string, steps: LoopStep[]) {
  return visibleArtifactCompletionGapPolicy(task, steps);
}

function plannerRunHistory(steps: LoopStep[]) {
  const executed = steps
    .filter((step) => step.kind === 'gui-execution')
    .slice(-4)
    .map((step, index) => {
      const action: Record<string, unknown> = isRecord(step.plannedAction) ? step.plannedAction : {};
      const type = typeof action.type === 'string' ? action.type : 'unknown';
      const appName = typeof action.appName === 'string' ? ` appName="${compactPlannerHistoryText(action.appName)}"` : '';
      const target = typeof action.targetDescription === 'string' ? ` target="${compactPlannerHistoryText(action.targetDescription)}"` : '';
      const key = typeof action.key === 'string' ? ` key="${action.key}"` : '';
      const direction = typeof action.direction === 'string' ? ` direction="${action.direction}"` : '';
      const status = typeof step.status === 'string' ? step.status : 'unknown';
      const verifier = isRecord(step.verifier) && typeof step.verifier.status === 'string' ? step.verifier.status : 'unknown';
      const pixelDiff = isRecord(step.verifier?.pixelDiff) ? step.verifier.pixelDiff : undefined;
      const noVisibleEffect = pixelDiff?.possiblyNoEffect === true ? ' no-visible-effect=true' : '';
      const execution = isRecord(step.execution) ? step.execution : {};
      const executionHint = type === 'open_app' && typeof execution.stdout === 'string' && execution.stdout
        ? ` execution="${compactPlannerHistoryText(execution.stdout, 120)}"`
        : '';
      const feedback = compactPlannerHistoryText(verifierFeedbackForRunHistory(step), 180);
      const focus = isRecord(step.visualFocus) && isRecord(step.visualFocus.region)
        ? ` focusRegion=${compactFocusRegionForHistory(step.visualFocus.region)}`
        : '';
      const ribbonTarget = typeof action.targetDescription === 'string' && /ribbon|toolbar|menu bar|菜单栏|功能区|选项卡|tab|button|按钮/i.test(action.targetDescription)
        ? ' target-region=toolbar-or-ribbon'
        : '';
      return `${index + 1}. ${type}${appName}${key}${direction}${target}${ribbonTarget}${focus} -> status=${status}, verifier=${verifier}${noVisibleEffect}${executionHint}${feedback ? `; verifierFeedback=${feedback}` : ''}`;
    });
  if (!executed.length) {
    return [
      'No GUI actions have executed yet in this run.',
      'Use the current screenshot to choose the first generic action, or report done=true only if no GUI action is needed.',
    ].join('\n');
  }
	  return [
	    'Already executed generic GUI actions in this run:',
	    ...executed,
    'Do not repeat the same action sequence unless the current screenshot clearly shows the prior action failed.',
    'If open_app for the same app already succeeded and the execution says frontmost, do not emit open_app for that app again; interact with the visible app content or set done=true if the task is complete.',
    'For one-shot recovery/observation tasks, a completed non-wait action with verifier evidence is usually sufficient; return done=true with actions=[] when satisfied.',
  ].join('\n');
}

function repeatedNoEffectRoute(actions: GenericVisionAction[], steps: LoopStep[]) {
  const next = actions.find((action) => action.type !== 'wait');
  if (!next) return undefined;
  const recentNoEffect = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done' && isNoVisibleEffectStep(step))
    .slice(-3);
  const repeatedStep = [...recentNoEffect].reverse().find((step) => {
    const prior = isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined;
    return prior ? sameNoEffectRoute(next, prior) : false;
  });
  if (!repeatedStep || !isRecord(repeatedStep.plannedAction)) return undefined;
  return compactPlannerHistoryText(describeActionRoute(repeatedStep.plannedAction as unknown as GenericVisionAction), 180);
}

export function isNoVisibleEffectStep(step: LoopStep) {
  const pixelDiff = isRecord(step.verifier?.pixelDiff) ? step.verifier.pixelDiff : undefined;
  return pixelDiff?.possiblyNoEffect === true;
}

function sameNoEffectRoute(next: GenericVisionAction, prior: GenericVisionAction) {
  const nextIsMouseTarget = next.type === 'click' || next.type === 'double_click';
  const priorIsMouseTarget = prior.type === 'click' || prior.type === 'double_click';
  if (nextIsMouseTarget && priorIsMouseTarget) {
    return targetRouteOverlap(next, prior);
  }
  if (next.type !== prior.type) return false;
  if (next.type === 'scroll' && prior.type === 'scroll') {
    return next.direction === prior.direction && targetRouteOverlap(next, prior);
  }
  if (next.type === 'press_key' && prior.type === 'press_key') return next.key === prior.key;
  if (next.type === 'hotkey' && prior.type === 'hotkey') return next.keys.join('+') === prior.keys.join('+');
  if (next.type === 'open_app' && prior.type === 'open_app') return compactRouteText(next.appName) === compactRouteText(prior.appName);
  if (next.type === 'type_text' && prior.type === 'type_text') return targetRouteOverlap(next, prior);
  return targetRouteOverlap(next, prior);
}

function targetRouteOverlap(next: GenericVisionAction, prior: GenericVisionAction) {
  const nextTarget = actionRouteTarget(next);
  const priorTarget = actionRouteTarget(prior);
  if (!nextTarget || !priorTarget) return true;
  if (nextTarget === priorTarget) return true;
  const nextTokens = routeTokens(nextTarget);
  const priorTokens = routeTokens(priorTarget);
  if (!nextTokens.length || !priorTokens.length) return false;
  const shared = nextTokens.filter((token) => priorTokens.includes(token)).length;
  return shared / Math.max(nextTokens.length, priorTokens.length) >= 0.5;
}

export function actionRouteTarget(action: GenericVisionAction) {
  return compactRouteText([
    action.targetDescription,
    action.targetRegionDescription,
    action.type === 'drag' ? action.fromTargetDescription : undefined,
    action.type === 'drag' ? action.toTargetDescription : undefined,
  ].filter(Boolean).join(' '));
}

export function compactRouteText(value: string | undefined) {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function routeTokens(value: string) {
  return value
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !['the', 'and', 'for', 'with', 'main', 'content', 'area', 'visible', 'target', 'window'].includes(token));
}

function describeActionRoute(action: GenericVisionAction) {
  const target = actionRouteTarget(action);
  const detail = action.type === 'scroll'
    ? ` direction=${action.direction}`
    : action.type === 'press_key'
      ? ` key=${action.key}`
      : action.type === 'hotkey'
        ? ` keys=${action.keys.join('+')}`
        : action.type === 'open_app'
          ? ` appName=${action.appName}`
          : '';
  return `${action.type}${detail}${target ? ` target="${target}"` : ''}`;
}

function compactPlannerHistoryText(value: string, maxLength = 120) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

function compactFocusRegionForHistory(region: Record<string, unknown>) {
  const x = Math.round(numberConfig(region.x) ?? 0);
  const y = Math.round(numberConfig(region.y) ?? 0);
  const width = Math.round(numberConfig(region.width) ?? 0);
  const height = Math.round(numberConfig(region.height) ?? 0);
  return `bbox(${x},${y},${width},${height})`;
}

function verifierFeedbackForRunHistory(step: LoopStep) {
  const verifier = isRecord(step.verifier) ? step.verifier : {};
  const explicit = typeof verifier.planningFeedback === 'string' ? verifier.planningFeedback.trim() : '';
  if (explicit) return explicit;
  return '';
}

export function nextPlannerActions(actions: GenericVisionAction[], remainingBudget: number) {
  if (remainingBudget <= 0) return [];
  const firstNonWait = actions.findIndex((action) => action.type !== 'wait');
  const firstIndex = firstNonWait >= 0 ? firstNonWait : 0;
  const next = actions.slice(firstIndex, firstIndex + 1);
  const following = actions[firstIndex + 1];
  if (following?.type === 'wait' && remainingBudget > 1) next.push(following);
  return next;
}

async function requestGenericPlannerActions(
  task: string,
  screenshot: ScreenshotRef,
  config: VisionSenseConfig,
  extraInstruction?: string,
  runHistory?: string,
): Promise<{ ok: true; actions: GenericVisionAction[]; done: boolean; reason?: string; rawResponse: unknown } | { ok: false; actions: []; done: false; reason: string; rawResponse?: unknown; retryableContractViolation?: boolean; contractIssue?: PlannerContractIssue }> {
  const plannerImage = await plannerImagePayload(screenshot);
  const appGuidance = await detectedApplicationGuidance(config);
  const response = await postOpenAiChatCompletion(config.planner, [
    {
      role: 'system',
      content: [
        'You are SciForge VisionPlanner for generic Computer Use.',
        'Return only JSON. Do not read DOM or accessibility. Do not output application-private APIs, scripts, selectors, files, or shortcuts that depend on one app.',
        `Execution environment: ${plannerEnvironmentDescription(config)}.`,
        `Window target contract: ${plannerWindowTargetDescription(config)}.`,
        `Current captured target: ${plannerCapturedTargetDescription(screenshot)}.`,
        plannerImage.description,
        appGuidance,
        `Use only keys and modifiers supported by desktopPlatform="${config.desktopPlatform}". Do not use keys from another operating system family.`,
        platformRecoveryGuidance(config),
        'When an app must be opened, prefer open_app with appName. Only open or switch apps when the task explicitly asks to launch/open/switch applications; for current-screen/current-window tasks, operate within the supplied target window.',
        'For file manager tasks, prefer open_app for the platform file manager (Finder on macOS, File Explorer on Windows) before interacting with files. Do not cycle through applications with repeated app-switch hotkeys to find a file manager.',
        'For browser-hosted target windows, the target application content area excludes browser chrome: tab strip, address bar, bookmarks bar, toolbar buttons, extension buttons, and extension popups. Do not target browser chrome unless the task explicitly asks for browser chrome.',
        'For browser research tasks, if the screenshot already shows results or an article/content page related to the requested topic, do not restart the search or edit a search field. Continue with visible result links, page content, scrolling, back navigation, or tab/window switching as generic GUI actions.',
        'Do not describe body text or selected article text as a search input field unless a visible input box boundary, caret, placeholder, or search control is present at that location.',
        'If an unrelated browser extension, permission, save, login, or external-service dialog appears, use Escape or a visible Cancel/Close button once, then return to the target application content. Do not click Retry, Enable, Authorize, Save, Submit, Send, Delete, or Login in unrelated dialogs.',
        'If the supplied screenshot is a transient menu, popover, palette, gallery, or dropdown window, interact only with visible items inside that transient window. If the next needed target is in the underlying document/app window and is not visible in the captured target, use press_key Escape or a visible close/cancel control to dismiss the transient window first.',
        'If the screenshot shows a document/template/gallery chooser and a template or item is already visibly selected, do not click the selected thumbnail again. Use the visible Create/New/Open/OK button, or use Cancel/Escape only when the task needs to leave the chooser.',
        'For visual targets, output targetDescription text only; never output x/y/fromX/fromY/toX/toY coordinates. Coordinates are produced by the Grounder in the target-window screenshot coordinate system.',
        'Planner screenshots may be budget-scaled for model latency. Do not infer exact pixel coordinates from them; describe visual targets semantically and let the Grounder use the original window screenshot.',
        'For dense UI, small icons, table rows, menus, dialogs, or ambiguous regions, include targetRegionDescription to name the larger visual region to inspect first; the runtime will crop that region and run a second fine Grounder inside it before execution.',
        'You may output wait with targetRegionDescription when the next step should be local observation only; the runtime will record focusRegion evidence and replan from the updated run history.',
        'Do not put pixel boxes in focusRegion unless it was copied from prior run history; prefer targetRegionDescription text so vision-sense can choose and clip the focus region.',
        'Allowed action types: open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, wait.',
        'Do not emit unsupported actions such as right_click, context_click, context_menu, menu_select, rename, move_file, copy_file, or app-private commands. For rename/move workflows, use only visible clicks, double_click, drag, type_text, press_key, open_app, scroll, or platform recovery hotkeys.',
        'Hotkeys are allowed only for platform-level recovery such as app/window switching or launcher activation. Do not use app-specific or browser-specific shortcuts such as new tab, address bar focus, refresh, save, close tab, copy, paste, bold, or menu commands; use visible controls and generic typing/clicking instead.',
        'Return {"done": boolean, "reason": string, "actions": [...]}. Set done=true only when the supplied screenshot shows the requested GUI task is complete; otherwise return exactly one next generic action. Include a short wait after that action only when the GUI needs time to settle.',
        'Use the run history to avoid repeating completed actions. If the task is a low-risk recovery/observation task and at least one requested non-wait action has already executed with verifier evidence, set done=true with actions=[] unless the screenshot clearly shows another required unfinished step.',
        'If run history marks a click or double_click target as no-visible-effect=true and the current screenshot is unchanged, do not repeat the same mouse action on the same target. Choose a different visible generic GUI route or a different generic input modality that the screenshot supports.',
        ...visionSensePlannerPromptPolicy.domainTaskInstructions,
        'The supplied screenshot is the observation state. Do not use wait as the only action to request another observation.',
        visionSensePlannerPromptPolicy.highRiskActionInstruction,
        extraInstruction,
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Task: ${task}\n${runHistory ? `Run history:\n${runHistory}\n` : ''}Return {"done":false,"reason":"...","actions":[one generic next action]} or {"done":true,"reason":"...","actions":[]} when the current screenshot plus run history show the task is complete. Stop before final high-risk actions unless explicitly confirmed by upstream.` },
        { type: 'image_url', image_url: { url: plannerImage.dataUrl } },
      ],
    },
  ]);
  if (!response.ok) return { ok: false, actions: [], done: false, reason: `VisionPlanner request failed: ${response.error}` };
  const content = extractChatCompletionContent(response.body);
  if (!content) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: 'VisionPlanner response did not include message content.',
      rawResponse: response.body,
      retryableContractViolation: true,
      contractIssue: 'empty-message-content',
    };
  }
  const json = extractJsonObject(content);
  if (!isRecord(json) && !Array.isArray(json)) return { ok: false, actions: [], done: false, reason: 'VisionPlanner response was not valid JSON.', rawResponse: response.body };
  const rawActions = isRecord(json) && Array.isArray(json.actions) ? json.actions : Array.isArray(json) ? json : [];
  const done = isRecord(json) && typeof json.done === 'boolean' ? json.done : false;
  const reason = isRecord(json) && typeof json.reason === 'string' ? json.reason : undefined;
  const coordinateViolation = rawActions.find((action) => isRecord(action) && ['x', 'y', 'fromX', 'fromY', 'toX', 'toY'].some((key) => key in action));
  if (coordinateViolation) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: 'VisionPlanner output coordinates, which violates the generic planner contract. Coordinates must come from Grounder.',
      rawResponse: response.body,
      retryableContractViolation: true,
      contractIssue: 'coordinate-output',
    };
  }
  const actions = parseGenericActions(rawActions).map((action) => normalizePlatformAction(action, config));
  const unsupportedAction = rawActions.length > 0 && actions.length === 0 && !done;
  if (unsupportedAction) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: 'VisionPlanner emitted no supported generic action. Use only open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, or wait.',
      rawResponse: response.body,
      retryableContractViolation: true,
      contractIssue: 'unsupported-action',
    };
  }
  const platformIssue = actions.map((action) => platformActionIssue(action, config)).find(Boolean);
  if (platformIssue) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: platformIssue,
      rawResponse: response.body,
      retryableContractViolation: true,
      contractIssue: 'platform-incompatible-action',
    };
  }
  return { ok: true, actions: trimLeadingWaitActions(actions, done), done, reason, rawResponse: response.body };
}

async function plannerImagePayload(screenshot: ScreenshotRef) {
  const originalBytes = await readFile(screenshot.absPath);
  const maxEdge = Math.max(screenshot.width ?? 0, screenshot.height ?? 0);
  if (!isDarwinPlatform(process.platform) || maxEdge <= PLANNER_IMAGE_MAX_EDGE) {
    return {
      dataUrl: `data:image/png;base64,${originalBytes.toString('base64')}`,
      description: `Planner image input uses the original screenshot (${screenshot.width ?? 'unknown'}x${screenshot.height ?? 'unknown'}).`,
    };
  }

  const previewPath = join(
    resolve(screenshot.absPath, '..'),
    `${sanitizeId(screenshot.id || basename(screenshot.absPath)) || 'screenshot'}-planner-preview.png`,
  );
  const result = await runCommand('sips', ['-s', 'format', 'png', '-Z', String(PLANNER_IMAGE_MAX_EDGE), screenshot.absPath, '--out', previewPath], { timeoutMs: 15000 });
  if (result.exitCode !== 0) {
    return {
      dataUrl: `data:image/png;base64,${originalBytes.toString('base64')}`,
      description: `Planner image input uses the original screenshot because preview scaling failed (${screenshot.width ?? 'unknown'}x${screenshot.height ?? 'unknown'}).`,
    };
  }
  const previewBytes = await readFile(previewPath);
  return {
    dataUrl: `data:image/png;base64,${previewBytes.toString('base64')}`,
    description: `Planner image input was budget-scaled for latency; original screenshot ref remains ${screenshot.path} (${screenshot.width ?? 'unknown'}x${screenshot.height ?? 'unknown'}), Grounder uses original pixels.`,
  };
}

function plannerRetryInstruction(issue: PlannerContractIssue | undefined, config: VisionSenseConfig) {
  if (issue === 'platform-incompatible-action') {
    return [
      'Your previous JSON used an action that cannot be executed in the current operating system.',
      `Rewrite for ${plannerEnvironmentDescription(config)} using only supported keys/modifiers and generic visible GUI actions.`,
      platformLauncherGuidance(config.desktopPlatform),
    ].join(' ');
  }
  if (issue === 'empty-message-content') {
    return 'Your previous response had empty final message content. Return only the JSON object in final message content now; do not put the action plan only in reasoning_content, analysis, prose, markdown, or tool calls.';
  }
  if (issue === 'unsupported-action') {
    return [
      'Your previous JSON used an unsupported action type. Do not use right_click, context_click, context_menu, menu_select, rename, move_file, or app-private commands.',
      'Rewrite using exactly one supported generic action: open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, or wait.',
      'For file rename/move tasks, first select visible files with click/double_click, use visible fields/buttons or generic press_key/type_text when the focused UI supports text entry, and drag only between visible locations.',
    ].join(' ');
  }
  return 'Your previous JSON violated the planner contract by including screen coordinates. Rewrite the plan without x/y/fromX/fromY/toX/toY. Use targetDescription, fromTargetDescription, and toTargetDescription so the Grounder can produce coordinates.';
}

function plannerEnvironmentDescription(config: VisionSenseConfig) {
  return `${platformLabel(config.desktopPlatform)} desktop controlled by screenshots plus generic mouse/keyboard events`;
}

function platformRecoveryGuidance(config: VisionSenseConfig) {
  if (isDarwinPlatform(config.desktopPlatform)) {
    return 'use Command+Tab for app/window recovery on macOS; treat task text that says Alt+Tab as the cross-platform intent for Command+Tab on darwin';
  }
  return 'use the platform-native app/window switch hotkey only when the task explicitly asks to switch/recover windows';
}

async function detectedApplicationGuidance(config: VisionSenseConfig) {
  if (!isDarwinPlatform(config.desktopPlatform)) return '';
  const candidates = [
    { name: 'Microsoft Word', paths: ['/Applications/Microsoft Word.app'] },
    { name: 'Microsoft PowerPoint', paths: ['/Applications/Microsoft PowerPoint.app'] },
    { name: 'Microsoft Excel', paths: ['/Applications/Microsoft Excel.app'] },
    { name: 'Keynote', paths: ['/Applications/Keynote.app', '/System/Applications/Keynote.app'] },
    { name: 'Pages', paths: ['/Applications/Pages.app', '/System/Applications/Pages.app'] },
    { name: 'TextEdit', paths: ['/System/Applications/TextEdit.app', '/Applications/TextEdit.app'] },
    { name: 'Finder', paths: ['/System/Library/CoreServices/Finder.app'] },
  ];
  const installed: string[] = [];
  const missing: string[] = [];
  for (const candidate of candidates) {
    if (await anyPathExists(candidate.paths)) {
      installed.push(candidate.name);
    } else {
      missing.push(candidate.name);
    }
  }
  return [
    `Detected installed GUI applications for this run: ${installed.length ? installed.join(', ') : 'unknown'}.`,
    missing.length ? `Do not choose these application names unless they are visibly present or explicitly opened by the user: ${missing.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

async function anyPathExists(paths: string[]) {
  for (const path of paths) {
    try {
      const info = await stat(path);
      if (info.isDirectory()) return true;
    } catch {
      // Missing applications are expected on developer machines.
    }
  }
  return false;
}

export function visionModelIssue(model: string | undefined) {
  if (!model) return 'set visionSense.plannerModel/SCIFORGE_VISION_PLANNER_MODEL or visionSense.visualGrounderModel/SCIFORGE_VISION_GROUNDER_LLM_MODEL to a vision-capable model such as qwen3.6-plus';
  const normalized = model.trim().toLowerCase();
  if (/deepseek[-_/]?v?4|deepseek[-_/]?v?3|deepseek[-_/]?r1/.test(normalized) && !/vision|vl|qwen-vl/.test(normalized)) {
    return `model "${model}" appears to be text-only; use a vision-capable model such as qwen3.6-plus for screenshot inputs`;
  }
  return '';
}

function plannerWindowTargetDescription(config: VisionSenseConfig) {
  const target = config.windowTarget;
  if (!target.enabled || target.mode === 'display') return 'display capture fallback; coordinates are interpreted in screen/display space';
  return [
    `mode=${target.mode}`,
    `required=${target.required}`,
    `coordinateSpace=${target.coordinateSpace}`,
    `inputIsolation=${target.inputIsolation}`,
    target.appName ? `appName=${JSON.stringify(target.appName)}` : '',
    target.title ? `title=${JSON.stringify(target.title)}` : '',
    target.windowId !== undefined ? `windowId=${target.windowId}` : '',
  ].filter(Boolean).join(' ');
}

function plannerCapturedTargetDescription(screenshot: ScreenshotRef | undefined) {
  const target = screenshot?.windowTarget;
  if (!target) return 'no screenshot target metadata';
  return [
    target.title ? `title=${JSON.stringify(target.title)}` : '',
    target.appName ? `app=${JSON.stringify(target.appName)}` : '',
    target.bundleId ? `bundle=${JSON.stringify(target.bundleId)}` : '',
    target.captureKind ? `captureKind=${target.captureKind}` : '',
    target.bounds ? `bounds=${target.bounds.width}x${target.bounds.height}` : '',
    target.focused === true ? 'focused=true' : target.focused === false ? 'focused=false' : '',
  ].filter(Boolean).join(' ') || 'target metadata present';
}

export async function postOpenAiChatCompletion(planner: VisionPlannerConfig, messages: Array<Record<string, unknown>>) {
  if (!planner.baseUrl || !planner.apiKey || !planner.model) {
    return { ok: false as const, error: 'planner baseUrl/apiKey/model are required' };
  }
  const url = planner.baseUrl.replace(/\/+$/, '').endsWith('/chat/completions')
    ? planner.baseUrl.replace(/\/+$/, '')
    : `${planner.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  try {
    const response = await withHardTimeout(fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${planner.apiKey}`,
      },
      body: JSON.stringify({
        model: planner.model,
        messages,
        temperature: 0,
        max_tokens: planner.maxTokens,
        response_format: { type: 'json_object' },
        ...plannerThinkingControl(planner),
      }),
      signal: controller.signal,
    }), planner.timeoutMs, `OpenAI-compatible chat completion timed out after ${planner.timeoutMs}ms`, () => controller.abort());
    const text = await withHardTimeout(
      response.text(),
      planner.timeoutMs,
      `OpenAI-compatible chat completion body timed out after ${planner.timeoutMs}ms`,
      () => controller.abort(),
    );
    const parsed = text ? parseJson(text) : {};
    if (!response.ok) return { ok: false as const, error: `HTTP ${response.status}: ${text.slice(0, 500)}` };
    return { ok: true as const, body: isRecord(parsed) ? parsed : { value: parsed } };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

function plannerThinkingControl(planner: VisionPlannerConfig) {
  if (process.env.SCIFORGE_VISION_PLANNER_ENABLE_THINKING === '1') return {};
  if (!/qwen3/i.test(planner.model || '')) return {};
  return {
    enable_thinking: false,
    extra_body: {
      enable_thinking: false,
    },
  };
}

export async function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
