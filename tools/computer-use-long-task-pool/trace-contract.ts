import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { allowedActionTypes } from './contracts.js';
import type { ComputerUseLongTraceValidation } from './contracts.js';
import { loadComputerUseLongTaskPool } from './task-pool.js';
import {
  collectKeys,
  emptyTraceValidation,
  firstString,
  hasForbiddenPrivateFields,
  hasInputChannelMetadata,
  hasSchedulerMetadata,
  hasStepWindowTarget,
  hasWindowBounds,
  hasWindowLocalCoordinates,
  hasWindowVerifierMetadata,
  inferWorkspacePathFromTracePath,
  isRecord,
  resolveTraceRefPath,
  screenshotRefHasWindowMetadata,
  screenshotStepRefs,
  validatePngRef,
  validateTraceContractWithVisionSense,
  verifierReportsNoVisibleEffect,
} from './support.js';

export async function validateComputerUseLongTrace(options: {
  scenarioId: string;
  tracePath: string;
  workspacePath?: string;
}): Promise<ComputerUseLongTraceValidation> {
  const pool = await loadComputerUseLongTaskPool();
  const scenario = pool.scenarios.find((item) => item.id === options.scenarioId);
  if (!scenario) throw new Error(`Unknown CU-LONG scenario: ${options.scenarioId}`);
  const tracePath = resolve(options.tracePath);
  const workspacePath = resolve(options.workspacePath || inferWorkspacePathFromTracePath(tracePath) || dirname(tracePath));
  const rawText = await readFile(tracePath, 'utf8');
  const visionSenseContract = await validateTraceContractWithVisionSense({ tracePath, workspacePath, rawText });
  if (visionSenseContract) {
    return {
      ok: visionSenseContract.issues.length === 0,
      scenarioId: scenario.id,
      tracePath,
      checkedScreenshotRefs: visionSenseContract.checkedScreenshotRefs,
      issues: visionSenseContract.issues,
      metrics: visionSenseContract.metrics,
    };
  }
  const issues: string[] = [];
  if (/data:image|;base64,/i.test(rawText)) issues.push('trace must not include inline image dataUrl/base64 payloads');
  const trace = JSON.parse(rawText) as unknown;
  if (!isRecord(trace)) {
    return emptyTraceValidation(options.scenarioId, tracePath, ['trace must be a JSON object']);
  }

  if (trace.schemaVersion !== 'sciforge.vision-trace.v1') issues.push('trace.schemaVersion must be sciforge.vision-trace.v1');
  const traceConfig = isRecord(trace.config) ? trace.config : {};
  const realGuiTrace = traceConfig.dryRun === false;
  const traceWindowTarget = isRecord(trace.windowTarget)
    ? trace.windowTarget
    : isRecord(trace.windowTargeting)
      ? trace.windowTargeting
      : isRecord(traceConfig.windowTarget)
        ? traceConfig.windowTarget
        : undefined;
  if (!traceWindowTarget) {
    issues.push('trace.windowTarget must record selected target window metadata');
  } else {
    const targetId = firstString(traceWindowTarget.windowId, traceWindowTarget.id, traceWindowTarget.handle, traceWindowTarget.title, traceWindowTarget.appName, traceWindowTarget.bundleId);
    if (!targetId) issues.push('trace.windowTarget missing stable window identity');
    if (!hasWindowBounds(traceWindowTarget)) issues.push('trace.windowTarget missing window bounds');
    const coordinateSpace = firstString(traceWindowTarget.coordinateSpace, traceWindowTarget.coordinates);
    if (!coordinateSpace || !/window(?:-local)?/i.test(coordinateSpace)) issues.push('trace.windowTarget.coordinateSpace must be window-local');
  }
  const traceScheduler = isRecord(trace.scheduler) ? trace.scheduler : undefined;
  if (!traceScheduler) {
    issues.push('trace.scheduler must record serialized GUI action scheduling metadata');
  } else {
    const schedulerMode = firstString(traceScheduler.mode, traceScheduler.policy, traceScheduler.queue);
    if (!schedulerMode || !/serial|ordered|single|window/i.test(schedulerMode)) {
      issues.push('trace.scheduler must declare serialized/ordered window action scheduling');
    }
    const lockId = firstString(traceScheduler.lockId, traceScheduler.schedulerLockId);
    if (!lockId) issues.push('trace.scheduler missing scheduler lock id');
    const lockScope = firstString(traceScheduler.lockScope, traceScheduler.scope);
    if (!lockScope || !/window|display|shared-system-input/i.test(lockScope)) {
      issues.push('trace.scheduler.lockScope must bind actions to a target window, display fallback, or shared system input lock');
    }
    const focusPolicy = firstString(traceScheduler.focusPolicy, traceScheduler.focus);
    if (!focusPolicy || !/focus|fail-closed|best-effort/i.test(focusPolicy)) issues.push('trace.scheduler.focusPolicy must describe focus/isolation behavior');
    const interferenceRisk = firstString(traceScheduler.interferenceRisk, traceScheduler.risk);
    if (!interferenceRisk) issues.push('trace.scheduler.interferenceRisk must record user/device interference risk');
    const executorLock = isRecord(traceScheduler.executorLock) ? traceScheduler.executorLock : {};
    if (realGuiTrace) {
      if (executorLock.provider !== 'filesystem-lease') {
        issues.push('trace.scheduler.executorLock must declare filesystem-lease for real GUI execution');
      }
      if (typeof executorLock.timeoutMs !== 'number' || executorLock.timeoutMs < 1) {
        issues.push('trace.scheduler.executorLock.timeoutMs must be positive for real GUI execution');
      }
      if (typeof executorLock.staleLockMs !== 'number' || executorLock.staleLockMs < 1) {
        issues.push('trace.scheduler.executorLock.staleLockMs must be positive for real GUI execution');
      }
    }
  }
  const genericComputerUse = isRecord(trace.genericComputerUse) ? trace.genericComputerUse : {};
  const appSpecificShortcuts = Array.isArray(genericComputerUse.appSpecificShortcuts) ? genericComputerUse.appSpecificShortcuts : undefined;
  if (!appSpecificShortcuts || appSpecificShortcuts.length !== 0) issues.push('genericComputerUse.appSpecificShortcuts must be []');
  const traceInputChannel = firstString(genericComputerUse.inputChannel, genericComputerUse.inputChannelMode, trace.inputChannel);
  if (!traceInputChannel || !/generic|mouse|keyboard|desktop/i.test(traceInputChannel)) {
    issues.push('genericComputerUse.inputChannel must declare generic mouse/keyboard input');
  }
  const inputChannelContract = isRecord(genericComputerUse.inputChannelContract) ? genericComputerUse.inputChannelContract : {};
  const userDeviceImpact = firstString(inputChannelContract.userDeviceImpact, inputChannelContract.pointerMode, inputChannelContract.keyboardMode);
  if (!userDeviceImpact || !/none|fail-closed|focused-target|frontmost|system|virtual/i.test(userDeviceImpact)) {
    issues.push('genericComputerUse.inputChannelContract must declare user-device impact and isolation behavior');
  }
  const pointerOwnership = firstString(inputChannelContract.pointerKeyboardOwnership, inputChannelContract.pointerMode);
  if (realGuiTrace && /shared-system-pointer-keyboard|system-cursor-events/i.test(pointerOwnership ?? '')) {
    const visualPointer = firstString(inputChannelContract.visualPointer, traceConfig.showVisualCursor);
    if (!visualPointer || !/sciforge|distinct|overlay|true/i.test(visualPointer)) {
      issues.push('real shared-system Computer Use traces must declare a distinct SciForge visual pointer overlay');
    }
  }
  if (inputChannelContract.highRiskConfirmationRequired !== true) {
    issues.push('genericComputerUse.inputChannelContract.highRiskConfirmationRequired must be true');
  }
  const actionSchema = new Set(Array.isArray(genericComputerUse.actionSchema) ? genericComputerUse.actionSchema.map(String) : []);
  for (const action of allowedActionTypes) {
    if (!actionSchema.has(action)) issues.push(`genericComputerUse.actionSchema missing ${action}`);
  }
  const coordinateContract = isRecord(genericComputerUse.coordinateContract) ? genericComputerUse.coordinateContract : {};
  const localFrame = firstString(coordinateContract.localCoordinateFrame, coordinateContract.grounderOutput, coordinateContract.executorInput);
  if (!localFrame || !/window|target-window/i.test(localFrame)) {
    issues.push('genericComputerUse.coordinateContract must declare window-local Grounder/executor coordinates');
  }
  const verifierContract = isRecord(genericComputerUse.verifierContract) ? genericComputerUse.verifierContract : {};
  const verifierScope = firstString(verifierContract.screenshotScope, verifierContract.beforeAfterWindowConsistency, verifierContract.completionEvidence);
  if (!verifierScope || !/window/i.test(verifierScope)) {
    issues.push('genericComputerUse.verifierContract must require window-based before/after verification');
  }

  const windowLifecycle = isRecord(trace.windowLifecycle) ? trace.windowLifecycle : {};
  const lifecyclePolicy = firstString(windowLifecycle.recoveryPolicy, windowLifecycle.status);
  if (!lifecyclePolicy || !/window|recover|stable|migrated/i.test(lifecyclePolicy)) {
    issues.push('trace.windowLifecycle must record window lifecycle/recovery evidence');
  }

  const imageMemory = isRecord(trace.imageMemory) ? trace.imageMemory : {};
  if (imageMemory.policy !== 'file-ref-only') issues.push('imageMemory.policy must be file-ref-only');
  const screenshotRefs = Array.isArray(imageMemory.refs) ? imageMemory.refs.filter(isRecord) : [];
  if (!screenshotRefs.length) issues.push('imageMemory.refs must include screenshot refs');
  const checkedScreenshotRefs: string[] = [];
  for (const ref of screenshotRefs) {
    const refPath = typeof ref.path === 'string' ? ref.path : '';
    if (!refPath) {
      issues.push('screenshot ref missing path');
      continue;
    }
    checkedScreenshotRefs.push(refPath);
    const resolved = resolveTraceRefPath(refPath, workspacePath, dirname(tracePath));
    const fileIssues = await validatePngRef(resolved, refPath);
    issues.push(...fileIssues);
    if (typeof ref.sha256 !== 'string' || ref.sha256.length !== 64) issues.push(`screenshot ref ${refPath} missing sha256`);
    if (typeof ref.width !== 'number' || typeof ref.height !== 'number') issues.push(`screenshot ref ${refPath} missing width/height`);
    if (!screenshotRefHasWindowMetadata(ref)) issues.push(`screenshot ref ${refPath} missing window screenshot metadata`);
  }

  const steps = Array.isArray(trace.steps) ? trace.steps.filter(isRecord) : [];
  if (!steps.length) issues.push('trace.steps must include step records');
  let actionCount = 0;
  let nonWaitActionCount = 0;
  let effectiveNonWaitActionCount = 0;
  let consecutiveNoEffectNonWaitActions = 0;
  let maxConsecutiveNoEffectNonWaitActions = 0;
  let blockedCount = 0;
  let failedCount = 0;
  let plannerOnlyDone = false;
  for (const [index, step] of steps.entries()) {
    const status = String(step.status || '');
    if (status === 'blocked') blockedCount += 1;
    if (status === 'failed') failedCount += 1;
    if (step.kind === 'gui-execution') {
      actionCount += 1;
      const action = isRecord(step.plannedAction) ? step.plannedAction : undefined;
      const type = typeof action?.type === 'string' ? action.type : '';
      if (!allowedActionTypes.has(type)) issues.push(`steps[${index}].plannedAction.type is not a generic action`);
      const nonWaitAction = Boolean(type && type !== 'wait');
      if (nonWaitAction) nonWaitActionCount += 1;
      if (hasForbiddenPrivateFields(action)) issues.push(`steps[${index}].plannedAction contains DOM/accessibility/private-app fields`);
      if (!Array.isArray(step.beforeScreenshotRefs) || !step.beforeScreenshotRefs.length) issues.push(`steps[${index}] missing beforeScreenshotRefs`);
      if (!Array.isArray(step.afterScreenshotRefs) || !step.afterScreenshotRefs.length) issues.push(`steps[${index}] missing afterScreenshotRefs`);
      for (const ref of [...screenshotStepRefs(step.beforeScreenshotRefs), ...screenshotStepRefs(step.afterScreenshotRefs)]) {
        if (!screenshotRefHasWindowMetadata(ref)) issues.push(`steps[${index}] screenshot ref missing window metadata`);
      }
      if (!isRecord(step.execution)) issues.push(`steps[${index}] missing execution record`);
      if (isRecord(step.execution) && !hasInputChannelMetadata(step.execution, action)) issues.push(`steps[${index}] execution missing input-channel metadata`);
      if (!isRecord(step.verifier)) issues.push(`steps[${index}] missing verifier record`);
      if (isRecord(step.verifier) && !hasWindowVerifierMetadata(step.verifier)) issues.push(`steps[${index}] verifier missing window consistency metadata`);
      if (nonWaitAction && status === 'done') {
        const noVisibleEffect = realGuiTrace && isRecord(step.verifier) && verifierReportsNoVisibleEffect(step.verifier);
        if (noVisibleEffect) {
          consecutiveNoEffectNonWaitActions += 1;
          maxConsecutiveNoEffectNonWaitActions = Math.max(maxConsecutiveNoEffectNonWaitActions, consecutiveNoEffectNonWaitActions);
        } else {
          consecutiveNoEffectNonWaitActions = 0;
          effectiveNonWaitActionCount += 1;
        }
      }
      if ((type === 'click' || type === 'double_click' || type === 'drag') && status === 'done' && !isRecord(step.grounding)) {
        issues.push(`steps[${index}] ${type} action missing grounding record`);
      }
      if ((type === 'click' || type === 'double_click' || type === 'drag') && status === 'done') {
        if (!hasWindowLocalCoordinates(action) && !hasWindowLocalCoordinates(step.localCoordinate)) issues.push(`steps[${index}].plannedAction missing window-local coordinates`);
        if (isRecord(step.grounding) && !hasWindowLocalCoordinates(step.grounding) && !hasWindowLocalCoordinates(step.localCoordinate)) issues.push(`steps[${index}].grounding missing window-local coordinates`);
      }
      if (!hasStepWindowTarget(step, traceWindowTarget)) issues.push(`steps[${index}] missing windowTarget metadata`);
      if (!hasSchedulerMetadata(step, traceScheduler)) issues.push(`steps[${index}] missing scheduler metadata`);
      if (realGuiTrace && (status === 'done' || status === 'failed')) {
        const stepScheduler = isRecord(step.scheduler) ? step.scheduler : {};
        const executorLease = isRecord(stepScheduler.executorLease) ? stepScheduler.executorLease : {};
        if (executorLease.mode !== 'real-gui-executor-lock') {
          issues.push(`steps[${index}] real GUI execution missing executor scheduler lease`);
        }
        if (!firstString(executorLease.lockId)) {
          issues.push(`steps[${index}] real GUI executor lease missing lock id`);
        }
        if (executorLease.status === 'timeout') {
          if (typeof executorLease.waitMs !== 'number') issues.push(`steps[${index}] real GUI executor lease timeout missing wait evidence`);
        } else if (!firstString(executorLease.acquiredAt) || !firstString(executorLease.releasedAt)) {
          issues.push(`steps[${index}] real GUI executor lease missing acquire/release evidence`);
        }
      }
    }
    if (step.kind === 'planning' && !isRecord(step.execution)) {
      issues.push(`steps[${index}] planning step missing planner execution record`);
    }
    if (step.kind === 'planning' && step.status === 'done' && plannerStepReportedDoneWithoutActions(step)) {
      plannerOnlyDone = true;
    }
  }

  const requestText = isRecord(trace.request) && typeof trace.request.text === 'string' ? trace.request.text : '';
  const allowsPlannerOnlyTrace = plannerOnlyDone && isPlannerOnlyEvidenceTask(requestText);
  const traceTaskText = [requestText, scenario.title, scenario.goal, ...scenario.acceptance].join('\n');
  const allowsDenseUiNoEffectRun = isLowRiskSettingsFormTrace(traceTaskText) || isLowRiskFileManagerTrace(traceTaskText);
  const allowsVisualRecheckNoEffect = isVisualRecheckTrace(traceTaskText) && nonWaitActionCount >= 3;
  if (actionCount === 0 && !allowsPlannerOnlyTrace) issues.push('trace must include at least one gui-execution step for CU-LONG validation');
  if (nonWaitActionCount === 0 && !allowsPlannerOnlyTrace) issues.push('trace must include at least one non-wait generic GUI action');
  if (realGuiTrace && nonWaitActionCount > 0 && effectiveNonWaitActionCount === 0 && !allowsPlannerOnlyTrace && !allowsVisualRecheckNoEffect) {
    issues.push('real GUI trace must include at least one visibly effective non-wait action');
  }
  if (realGuiTrace && maxConsecutiveNoEffectNonWaitActions >= 3 && !allowsPlannerOnlyTrace && !allowsDenseUiNoEffectRun) {
    issues.push(`real GUI trace has ${maxConsecutiveNoEffectNonWaitActions} consecutive non-wait actions without visible effect`);
  }
  const serializedKeys = collectKeys(trace).map((key) => key.toLowerCase());
  for (const forbidden of ['domselector', 'selector', 'accessibilitylabel', 'aria', 'xpath', 'cssselector', 'appapi', 'privateshortcut']) {
    if (serializedKeys.includes(forbidden.toLowerCase())) issues.push(`trace contains forbidden private field key: ${forbidden}`);
  }

  return {
    ok: issues.length === 0,
    scenarioId: scenario.id,
    tracePath,
    checkedScreenshotRefs,
    issues,
    metrics: {
      stepCount: steps.length,
      actionCount,
      nonWaitActionCount,
      effectiveNonWaitActionCount,
      screenshotCount: screenshotRefs.length,
      blockedCount,
      failedCount,
    },
  };
}

function isVisualRecheckTrace(text: string) {
  const task = text || '';
  return isLowRiskSettingsFormTrace(task) && /recheck|inspect|verify|重新检查|检查|复查|视觉.*检查/i.test(task);
}

function isLowRiskSettingsFormTrace(text: string) {
  const task = text || '';
  const settingsIntent = /settings|preferences|preference pane|设置|偏好设置|长表单|密集 UI|字段/i.test(task);
  const denseControlIntent = /form|controls|表单|控件|搜索框|文本框|下拉|复选框|切换开关|按钮/i.test(task);
  return settingsIntent && denseControlIntent;
}

function isLowRiskFileManagerTrace(text: string) {
  const task = text || '';
  return /file manager|finder|file explorer|files?|folders?|directory|文件管理器|访达|文件|文件夹|目录/i.test(task)
    && /delete|trash|remove|erase|删除|废纸篓|移除|清空|危险|high-risk|fail closed/i.test(task);
}

function plannerStepReportedDoneWithoutActions(step: Record<string, unknown>) {
  const execution = isRecord(step.execution) ? step.execution : undefined;
  const rawResponse = isRecord(execution?.rawResponse) ? execution.rawResponse : undefined;
  if (rawResponse?.done === true && Array.isArray(rawResponse.actions) && rawResponse.actions.length === 0) return true;
  const choices = Array.isArray(rawResponse?.choices) ? rawResponse.choices.filter(isRecord) : [];
  for (const choice of choices) {
    const message = isRecord(choice.message) ? choice.message : undefined;
    const content = typeof message?.content === 'string' ? message.content : '';
    const parsed = extractJsonObject(content);
    if (isRecord(parsed) && parsed.done === true && Array.isArray(parsed.actions) && parsed.actions.length === 0) return true;
  }
  return false;
}

function isPlannerOnlyEvidenceTask(text: string) {
  return /trace refs?|trace paths?|image memory|artifact|action ledger|failure diagnostics|sha256|displayId|尺寸|文件引用|截图引用|复盘|总结|汇总|回答|报告|handoff|refs?|summary|report/i.test(text);
}

function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
