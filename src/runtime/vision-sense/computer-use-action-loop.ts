import type { GatewayRequest, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { groundingForAction, highRiskBlockReason, normalizePlatformAction, platformActionIssue } from '../computer-use/actions.js';
import { captureDisplays, createFocusedCropRefs, pixelDiffForScreenshotSets, toTraceScreenshotRef } from '../computer-use/capture.js';
import { executeGenericDesktopAction, executorBoundary } from '../computer-use/executor.js';
import type { ComputerUseConfig as VisionSenseConfig, GenericVisionAction, LoopStep, ScreenshotRef, WindowTargetResolution } from '../computer-use/types.js';
import { inputChannelDescription, resolveWindowTarget, schedulerStepMetadata, stepInputChannelMetadata, toTraceWindowTarget, windowTargetTraceConfig } from '../computer-use/window-target.js';
import { visionSenseCompletionPolicyModes, visionSenseRuntimeEventTypes, visionSenseTraceContractPolicy } from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import { VISION_TOOL_ID } from './computer-use-trace-output.js';
import {
  actionLedgerCompletion,
  appendPlannerStep,
  nextPlannerActions,
  rewriteGenericPlannerAction,
  shouldTolerateDenseUiNoEffectAction,
  visibleArtifactCompletionGap,
} from './computer-use-plan.js';
import {
  buildFocusRegionFromVisionSense,
  buildRegionSemanticVerifierFromVisionSense,
  buildVerifierPlanningFeedbackFromVisionSense,
  refineActionGroundingWithFocusRegion,
  resolveActionGrounding,
} from './computer-use-grounding.js';
import {
  bindWindowTargetFromOpenAppAction,
  localCoordinateMetadata,
  mappedCoordinateMetadata,
  windowConsistencyMetadata,
} from './computer-use-window-session.js';

export async function runComputerUseActionLoop(params: {
  request: GatewayRequest;
  workspace: string;
  runDir: string;
  config: VisionSenseConfig;
  callbacks: WorkspaceRuntimeCallbacks;
  steps: LoopStep[];
  screenshotLedger: ScreenshotRef[];
  actionQueue: GenericVisionAction[];
  targetResolution: WindowTargetResolution;
  dynamicPlannerEnabled: boolean;
  plannerReportedDone: boolean;
  dynamicPlannerRan: boolean;
  executionStatus: 'done' | 'failed-with-reason';
  failureReason: string;
}): Promise<{
  targetResolution: WindowTargetResolution;
  executionStatus: 'done' | 'failed-with-reason';
  failureReason: string;
  plannerReportedDone: boolean;
  dynamicPlannerRan: boolean;
}> {
  const { request, workspace, runDir, config, callbacks, steps, screenshotLedger, actionQueue, dynamicPlannerEnabled } = params;
  let { targetResolution, plannerReportedDone, dynamicPlannerRan, executionStatus, failureReason } = params;

  if (actionQueue.length && executionStatus !== 'failed-with-reason') {
    let consecutiveNoEffectNonWaitActions = 0;
    for (let index = 0; index < config.maxSteps && actionQueue.length; index += 1) {
      const originalAction = actionQueue.shift() as GenericVisionAction;
      const action = await rewriteGenericPlannerAction(normalizePlatformAction(originalAction, config), config, steps, request.prompt);
      const stepNumber = String(index + 1).padStart(3, '0');
      targetResolution = await resolveWindowTarget(config);
      if (!targetResolution.ok) {
        executionStatus = 'failed-with-reason';
        failureReason = targetResolution.reason;
        steps.push({
          id: `step-${stepNumber}-blocked-window-target`,
          kind: 'planning',
          status: 'blocked',
          verifier: {
            status: 'blocked',
            reason: 'target window contract could not be resolved before action execution',
            diagnostics: targetResolution.diagnostics,
            windowTarget: windowTargetTraceConfig(targetResolution.target),
            windowConsistency: windowConsistencyMetadata([], [], config),
          },
          failureReason,
        });
        break;
      }
      const beforeRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-before`, config, targetResolution);
      screenshotLedger.push(...beforeRefs);
      const platformBlockReason = platformActionIssue(action, config);
      if (platformBlockReason) {
        const afterRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-after`, config, targetResolution);
        screenshotLedger.push(...afterRefs);
        executionStatus = 'failed-with-reason';
        failureReason = platformBlockReason;
        steps.push({
          id: `step-${stepNumber}-blocked-platform-${action.type}`,
          kind: 'gui-execution',
          status: 'blocked',
          beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
          afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
          plannedAction: action,
          grounding: groundingForAction(action),
          execution: {
            executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
            inputChannel: inputChannelDescription(config, targetResolution),
            windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
            status: 'blocked',
            blockedReason: platformBlockReason,
          },
          scheduler: schedulerStepMetadata(targetResolution, `step-${stepNumber}`, config),
          verifier: {
            status: 'blocked',
            reason: 'platform-incompatible Computer Use action',
            pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
            windowConsistency: windowConsistencyMetadata(beforeRefs, afterRefs, config),
          },
          failureReason,
        });
        break;
      }
      const riskBlockReason = highRiskBlockReason(action, config);
      if (riskBlockReason) {
        const afterRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-after`, config, targetResolution);
        screenshotLedger.push(...afterRefs);
        const fallbackActions = nextPlannerActions(config.completionPolicy?.fallbackActions ?? [], config.maxSteps - index - 1);
        const continueWithFallback = fallbackActions.length > 0;
        if (!continueWithFallback) {
          executionStatus = 'failed-with-reason';
          failureReason = riskBlockReason;
        }
        steps.push({
          id: `step-${stepNumber}-blocked-${action.type}`,
          kind: 'gui-execution',
          status: 'blocked',
          beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
          afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
          plannedAction: action,
          grounding: groundingForAction(action),
          execution: {
            executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
            inputChannel: inputChannelDescription(config, targetResolution),
            windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
            status: 'blocked',
            blockedReason: riskBlockReason,
          },
          scheduler: schedulerStepMetadata(targetResolution, `step-${stepNumber}`, config),
          verifier: {
            status: 'blocked',
            reason: 'high-risk action requires upstream confirmation',
            pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
            windowConsistency: windowConsistencyMetadata(beforeRefs, afterRefs, config),
          },
          failureReason: continueWithFallback ? undefined : failureReason,
        });
        if (continueWithFallback) {
          actionQueue.unshift(...fallbackActions);
          continue;
        }
        break;
      }
      let groundingResolution = await resolveActionGrounding(action, beforeRefs, config);
      if (!groundingResolution.ok) {
        const afterRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-after`, config, targetResolution);
        screenshotLedger.push(...afterRefs);
        executionStatus = 'failed-with-reason';
        failureReason = groundingResolution.reason;
        steps.push({
          id: `step-${stepNumber}-blocked-grounding-${action.type}`,
          kind: 'gui-execution',
          status: 'blocked',
          beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
          afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
          plannedAction: groundingResolution.action,
          grounding: groundingResolution.grounding,
          execution: {
            executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
            inputChannel: inputChannelDescription(config, targetResolution),
            windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
            status: 'blocked',
            blockedReason: groundingResolution.reason,
          },
          scheduler: schedulerStepMetadata(targetResolution, `step-${stepNumber}`, config),
          verifier: {
            status: 'blocked',
            reason: 'grounding did not produce executable coordinates',
            pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
            windowConsistency: windowConsistencyMetadata(beforeRefs, afterRefs, config),
          },
          failureReason,
        });
        break;
      }
      let executableAction = groundingResolution.action;
      const focusRegion = await buildFocusRegionFromVisionSense(beforeRefs[0], groundingResolution.grounding);
      const beforeFocusRefs = focusRegion
        ? await createFocusedCropRefs(workspace, runDir, `step-${stepNumber}-before`, beforeRefs, focusRegion, config)
        : [];
      screenshotLedger.push(...beforeFocusRefs);
      if (focusRegion && beforeFocusRefs.length) {
        const refinedGrounding = await refineActionGroundingWithFocusRegion({
          action: executableAction,
          grounding: groundingResolution.grounding,
          focusRegion,
          beforeRef: beforeRefs[0],
          focusRefs: beforeFocusRefs,
          config,
        });
        if (refinedGrounding.ok) {
          groundingResolution = refinedGrounding;
          executableAction = refinedGrounding.action;
        } else if (groundingResolution.grounding) {
          groundingResolution = {
            ...groundingResolution,
            grounding: {
              ...groundingResolution.grounding,
              fineGrounding: refinedGrounding.grounding,
              fineGroundingFallback: refinedGrounding.reason,
            },
          };
        }
      }
      emitWorkspaceRuntimeEvent(callbacks, {
        type: visionSenseRuntimeEventTypes.genericAction,
        source: 'workspace-runtime',
        toolName: VISION_TOOL_ID,
        status: 'running',
        message: `Executing generic Computer Use action ${index + 1}/${config.maxSteps}: ${executableAction.type}`,
      });
      const result = config.dryRun
        ? { exitCode: 0, stdout: 'dry-run', stderr: '' }
        : await executeGenericDesktopAction(executableAction, config, targetResolution);
      const schedulerLease = isRecord((result as { schedulerLease?: unknown }).schedulerLease) ? (result as { schedulerLease?: Record<string, unknown> }).schedulerLease : undefined;
      const afterTargetResolution = await resolveWindowTarget(config);
      const afterRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-after`, config, afterTargetResolution);
      targetResolution = afterTargetResolution;
      screenshotLedger.push(...afterRefs);
      const afterFocusRefs = focusRegion
        ? await createFocusedCropRefs(workspace, runDir, `step-${stepNumber}-after`, afterRefs, focusRegion, config)
        : [];
      screenshotLedger.push(...afterFocusRefs);
      const ok = result.exitCode === 0;
      const verifierPixelDiff = pixelDiffForScreenshotSets(beforeRefs, afterRefs);
      const focusPixelDiff = beforeFocusRefs.length && afterFocusRefs.length
        ? pixelDiffForScreenshotSets(beforeFocusRefs, afterFocusRefs)
        : undefined;
      const noVisibleEffect = !config.dryRun && ok && executableAction.type !== 'wait' && verifierPixelDiff.possiblyNoEffect === true;
      const windowConsistency = windowConsistencyMetadata(beforeRefs, afterRefs, config);
      const visualFocus = focusRegion ? {
        ...visionSenseTraceContractPolicy.visualFocus,
        region: focusRegion,
        beforeFocusScreenshotRefs: beforeFocusRefs.map(toTraceScreenshotRef),
        afterFocusScreenshotRefs: afterFocusRefs.map(toTraceScreenshotRef),
        pixelDiff: focusPixelDiff,
        fineGrounding: isRecord(groundingResolution.grounding?.fineGrounding) ? groundingResolution.grounding.fineGrounding : undefined,
      } : undefined;
      if (!ok) {
        executionStatus = 'failed-with-reason';
        failureReason = result.stderr || result.stdout || `Generic action ${action.type} failed with exit ${result.exitCode}`;
      }
      if (ok) bindWindowTargetFromOpenAppAction(config, executableAction);
      const planningFeedback = await buildVerifierPlanningFeedbackFromVisionSense({
        action: executableAction,
        status: ok ? 'done' : 'failed',
        grounding: groundingResolution.grounding ?? groundingForAction(executableAction),
        pixelDiff: verifierPixelDiff,
        windowConsistency,
        visualFocus,
        failureReason: ok ? undefined : failureReason,
      });
      const regionSemantic = await buildRegionSemanticVerifierFromVisionSense({
        action: executableAction,
        status: ok ? 'done' : 'failed',
        grounding: groundingResolution.grounding ?? groundingForAction(executableAction),
        pixelDiff: verifierPixelDiff,
        focusPixelDiff,
        visualFocus,
        failureReason: ok ? undefined : failureReason,
      });
      steps.push({
        id: `step-${stepNumber}-execute-${executableAction.type}`,
        kind: 'gui-execution',
        status: ok ? 'done' : 'failed',
        beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
        afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
        plannedAction: executableAction,
        grounding: groundingResolution.grounding ?? groundingForAction(executableAction),
        windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
        localCoordinate: localCoordinateMetadata(groundingResolution.grounding, executableAction, beforeRefs[0]),
        mappedCoordinate: mappedCoordinateMetadata(groundingResolution.grounding, executableAction),
        inputChannel: stepInputChannelMetadata(config, targetResolution),
        visualFocus,
        execution: {
          executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
          inputChannel: inputChannelDescription(config, targetResolution),
          windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
          status: ok ? 'done' : 'failed',
          exitCode: result.exitCode,
          stdout: result.stdout.trim() || undefined,
          stderr: result.stderr.trim() || undefined,
        },
        scheduler: {
          ...schedulerStepMetadata(targetResolution, `step-${stepNumber}`, config),
          executorLease: schedulerLease,
        },
        verifier: {
          status: ok ? 'checked' : 'skipped-after-execution-failure',
          method: 'window-pixel-diff',
          pixelDiff: verifierPixelDiff,
          focusRegionPixelDiff: focusPixelDiff,
          windowConsistency,
          regionSemantic,
          planningFeedback,
        },
        failureReason: ok ? undefined : failureReason,
      });
      if (!ok) break;
      if (executableAction.type !== 'wait') {
        const tolerateNoEffect = noVisibleEffect && await shouldTolerateDenseUiNoEffectAction(request.prompt, steps, executableAction);
        consecutiveNoEffectNonWaitActions = noVisibleEffect && !tolerateNoEffect ? consecutiveNoEffectNonWaitActions + 1 : 0;
        if (consecutiveNoEffectNonWaitActions >= 3) {
          executionStatus = 'failed-with-reason';
          failureReason = `Generic Computer Use loop stopped after ${consecutiveNoEffectNonWaitActions} consecutive non-wait actions produced no visible window effect. Replan away from the repeated target or improve grounding.`;
          const lastStep = steps[steps.length - 1];
          lastStep.verifier = {
            ...(lastStep.verifier ?? {}),
            status: 'blocked',
            reason: failureReason,
          };
          lastStep.failureReason = failureReason;
          break;
        }
      }
      if (config.completionPolicy?.mode === visionSenseCompletionPolicyModes.oneSuccessfulNonWaitAction && executableAction.type !== 'wait') {
        plannerReportedDone = true;
        break;
      }
      const ledgerCompletion = await actionLedgerCompletion(request.prompt, steps);
      if (ledgerCompletion.complete) {
        plannerReportedDone = true;
        const lastStep = steps[steps.length - 1];
        lastStep.verifier = {
          ...(lastStep.verifier ?? {}),
          status: 'checked',
          reason: ledgerCompletion.reason || 'action-ledger completion policy satisfied',
        };
        break;
      }
      if (dynamicPlannerEnabled && actionQueue.length === 0 && index + 1 < config.maxSteps) {
        dynamicPlannerRan = true;
        const planned = await appendPlannerStep({
          id: `step-${stepNumber}-replan`,
          task: request.prompt,
          screenshotRefs: afterRefs,
          steps,
          config,
        });
        plannerReportedDone = planned.done;
        if (!planned.ok) {
          const fallbackActions = nextPlannerActions(config.completionPolicy?.fallbackActions ?? [], config.maxSteps - index - 1);
          if (fallbackActions.length) {
            const plannerStep = steps[steps.length - 1];
            plannerStep.status = 'done';
            plannerStep.failureReason = undefined;
            plannerStep.verifier = {
              ...(plannerStep.verifier ?? {}),
              status: 'checked',
              reason: `VisionPlanner failed (${planned.reason}); using structured completionPolicy fallback action.`,
            };
            actionQueue.push(...fallbackActions);
          } else {
            executionStatus = 'failed-with-reason';
            failureReason = planned.reason;
            break;
          }
        }
        actionQueue.push(...nextPlannerActions(planned.actions, config.maxSteps - index - 1));
        if (!actionQueue.length || planned.done) break;
      }
    }
  }

  if (dynamicPlannerEnabled && dynamicPlannerRan && !plannerReportedDone && executionStatus !== 'failed-with-reason') {
    executionStatus = 'failed-with-reason';
    failureReason = [
      `VisionPlanner reached maxSteps=${config.maxSteps} without confirming the task is complete.`,
      'The runtime executed only generic Computer Use actions and stopped with a recoverable failure instead of claiming success.',
      'Increase maxSteps or improve the planner/grounder so it can complete and verify the visible task state.',
    ].join(' ');
    const lastStep = [...steps].reverse().find((step) => step.kind === 'gui-execution' || step.kind === 'planning');
    if (lastStep && !lastStep.failureReason) {
      lastStep.verifier = {
        ...(lastStep.verifier ?? {}),
        status: 'blocked',
        reason: 'maxSteps exhausted before planner reported done=true',
      };
      lastStep.failureReason = failureReason;
    }
  }

  if (executionStatus !== 'failed-with-reason') {
    const completionGap = await visibleArtifactCompletionGap(request.prompt, steps);
    if (completionGap) {
      executionStatus = 'failed-with-reason';
      failureReason = completionGap;
      const lastStep = [...steps].reverse().find((step) => step.kind === 'gui-execution' || step.kind === 'planning');
      if (lastStep && !lastStep.failureReason) {
        lastStep.verifier = {
          ...(lastStep.verifier ?? {}),
          status: 'blocked',
          reason: 'planner completion did not satisfy visible artifact acceptance',
        };
        lastStep.failureReason = failureReason;
      }
    }
  }

  return { targetResolution, executionStatus, failureReason, plannerReportedDone, dynamicPlannerRan };
}
