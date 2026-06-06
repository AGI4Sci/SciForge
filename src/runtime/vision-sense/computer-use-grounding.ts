import { groundingForAction } from '../computer-use/actions.js';
import { toTraceScreenshotRef } from '../computer-use/capture.js';
import type { ComputerUseConfig as VisionSenseConfig, FocusRegion, GenericVisionAction, GroundingResolution, ScreenshotRef } from '../computer-use/types.js';
import { isDarwinPlatform, numberConfig } from '../computer-use/utils.js';
import { isWindowLocalCoordinateSpace } from '../computer-use/window-target.js';
import { isRecord } from '../gateway-utils.js';
import {
  visionSenseCrossDisplayWindowDragPolicy,
  visionSenseFocusRegionGroundingId,
  visionSenseGroundingIds,
} from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import { inferExecutorCoordinateScale } from './computer-use-window-session.js';
export async function resolveActionGrounding(
  action: GenericVisionAction,
  beforeRefs: ScreenshotRef[],
  config: VisionSenseConfig,
): Promise<GroundingResolution> {
  if (action.type === 'click' || action.type === 'double_click') {
    if (typeof action.x === 'number' && typeof action.y === 'number') {
      const executorPoint = screenshotToExecutorPoint(action.x, action.y, beforeRefs[0], config);
      const executableAction = { ...action, x: executorPoint.x, y: executorPoint.y };
      return {
        ok: true,
        action: executableAction,
        grounding: {
          ...groundingForAction(action),
          screenshotX: action.x,
          screenshotY: action.y,
          localX: action.x,
          localY: action.y,
          executorX: executorPoint.x,
          executorY: executorPoint.y,
          executorCoordinateScale: executorPoint.scale,
          coordinateSpace: executorPoint.coordinateSpace,
          windowTarget: beforeRefs[0]?.windowTarget,
        },
      };
    }
    if (!action.targetDescription) {
      return {
        ok: false,
        action,
        grounding: { status: 'failed', reason: 'missing targetDescription and coordinates' },
        reason: `Generic ${action.type} action requires either x/y coordinates or targetDescription for Grounder.`,
      };
    }
    const coarseDescription = action.targetRegionDescription || action.targetDescription;
    const grounded = await groundTargetDescription(coarseDescription, beforeRefs, config);
    if (!grounded.ok) {
      return {
        ok: false,
        action,
        grounding: grounded.grounding,
        reason: grounded.reason,
      };
    }
    const executorPoint = screenshotToExecutorPoint(grounded.x, grounded.y, beforeRefs[0], config);
    const groundedAction = { ...action, x: executorPoint.x, y: executorPoint.y };
    return {
      ok: true,
      action: groundedAction,
      grounding: {
        ...grounded.grounding,
        coarseTargetDescription: coarseDescription,
        targetRegionDescription: action.targetRegionDescription,
        targetDescription: action.targetDescription,
        screenshotX: grounded.x,
        screenshotY: grounded.y,
        localX: grounded.x,
        localY: grounded.y,
        executorX: executorPoint.x,
        executorY: executorPoint.y,
        executorCoordinateScale: executorPoint.scale,
        coordinateSpace: executorPoint.coordinateSpace,
        windowTarget: beforeRefs[0]?.windowTarget,
      },
    };
  }

  if (action.type === 'wait' && (action.targetRegionDescription || action.targetDescription)) {
    const targetDescription = (action.targetRegionDescription || action.targetDescription) as string;
    const grounded = await groundTargetDescription(targetDescription, beforeRefs, config);
    if (!grounded.ok) {
      return {
        ok: false,
        action,
        grounding: grounded.grounding,
        reason: grounded.reason,
      };
    }
    return {
      ok: true,
      action,
      grounding: {
        ...grounded.grounding,
        observationOnly: true,
        targetRegionDescription: action.targetRegionDescription,
        targetDescription: action.targetDescription,
        screenshotX: grounded.x,
        screenshotY: grounded.y,
        localX: grounded.x,
        localY: grounded.y,
        coordinateSpace: beforeRefs[0]?.windowTarget?.coordinateSpace ?? config.windowTarget.coordinateSpace,
        windowTarget: beforeRefs[0]?.windowTarget,
      },
    };
  }

  if (action.type !== 'open_app' && action.type !== 'drag' && (action.targetRegionDescription || action.targetDescription)) {
    return {
      ok: true,
      action,
      grounding: targetDescriptionGrounding(action, beforeRefs[0], config),
    };
  }

  if (action.type === 'drag') {
    const hasEndpoints = [action.fromX, action.fromY, action.toX, action.toY].every((value) => typeof value === 'number');
    if (hasEndpoints) {
      const dragDistance = Math.hypot((action.toX as number) - (action.fromX as number), (action.toY as number) - (action.fromY as number));
      if (dragDistance < 24) {
        return {
          ok: false,
          action,
          grounding: { ...groundingForAction(action), status: 'failed', reason: 'drag endpoints too close to create a meaningful visible drag', dragDistance },
          reason: `Generic drag action endpoints are too close (${dragDistance.toFixed(1)}px). Use distinct visible start/end targets or choose a non-drag action.`,
        };
      }
      const fromExecutor = screenshotToExecutorPoint(action.fromX as number, action.fromY as number, beforeRefs[0], config);
      const toExecutor = screenshotToExecutorPoint(action.toX as number, action.toY as number, beforeRefs[0], config);
      const executableAction = { ...action, fromX: fromExecutor.x, fromY: fromExecutor.y, toX: toExecutor.x, toY: toExecutor.y };
      return {
        ok: true,
        action: executableAction,
        grounding: {
          ...groundingForAction(action),
          screenshotFromX: action.fromX,
          screenshotFromY: action.fromY,
          screenshotToX: action.toX,
          screenshotToY: action.toY,
          localFromX: action.fromX,
          localFromY: action.fromY,
          localToX: action.toX,
          localToY: action.toY,
          executorFromX: fromExecutor.x,
          executorFromY: fromExecutor.y,
          executorToX: toExecutor.x,
          executorToY: toExecutor.y,
          executorCoordinateScale: fromExecutor.scale,
          coordinateSpace: fromExecutor.coordinateSpace,
          windowTarget: beforeRefs[0]?.windowTarget,
        },
      };
    }
    if (!action.fromTargetDescription || !action.toTargetDescription) {
      return {
        ok: false,
        action,
        grounding: { status: 'failed', reason: 'missing drag endpoint target descriptions and coordinates' },
        reason: 'Generic drag action requires explicit from/to coordinates or fromTargetDescription and toTargetDescription for Grounder.',
      };
    }
    const crossDisplay = crossDisplayWindowDragGrounding(action, beforeRefs[0], config);
    if (crossDisplay) return crossDisplay;
    const from = await groundTargetDescription(action.fromTargetDescription, beforeRefs, config);
    if (!from.ok) return { ok: false, action, grounding: from.grounding, reason: from.reason };
    const to = await groundTargetDescription(action.toTargetDescription, beforeRefs, config);
    if (!to.ok) return { ok: false, action, grounding: to.grounding, reason: to.reason };
    const dragDistance = Math.hypot(to.x - from.x, to.y - from.y);
    if (dragDistance < 24) {
      return {
        ok: false,
        action,
        grounding: {
          status: 'failed',
          reason: 'drag endpoints too close to create a meaningful visible drag',
          dragDistance,
          from: from.grounding,
          to: to.grounding,
          targetDescription: action.targetDescription,
        },
        reason: `Generic drag action grounded endpoints are too close (${dragDistance.toFixed(1)}px). Use distinct visible start/end targets or choose a non-drag action.`,
      };
    }
    const fromExecutor = screenshotToExecutorPoint(from.x, from.y, beforeRefs[0], config);
    const toExecutor = screenshotToExecutorPoint(to.x, to.y, beforeRefs[0], config);
    const groundedAction = { ...action, fromX: fromExecutor.x, fromY: fromExecutor.y, toX: toExecutor.x, toY: toExecutor.y };
    return {
      ok: true,
      action: groundedAction,
      grounding: {
        status: 'provided',
        from: from.grounding,
        to: to.grounding,
        targetDescription: action.targetDescription,
        localFromX: from.x,
        localFromY: from.y,
        localToX: to.x,
        localToY: to.y,
        executorCoordinateScale: fromExecutor.scale,
        coordinateSpace: fromExecutor.coordinateSpace,
        windowTarget: beforeRefs[0]?.windowTarget,
      },
    };
  }

  return { ok: true, action, grounding: groundingForAction(action) };
}

function crossDisplayWindowDragGrounding(action: Extract<GenericVisionAction, { type: 'drag' }>, screenshot: ScreenshotRef | undefined, config: VisionSenseConfig): GroundingResolution | undefined {
  const description = [action.targetDescription, action.fromTargetDescription, action.toTargetDescription].filter(Boolean).join(' ');
  if (!screenshot) return undefined;
  const width = screenshot.width ?? screenshot.windowTarget?.bounds?.width ?? 800;
  const height = screenshot.height ?? screenshot.windowTarget?.bounds?.height ?? 600;
  const dragPolicy = visionSenseCrossDisplayWindowDragPolicy({ description, width, height });
  if (!dragPolicy) return undefined;
  const { fromX, fromY, toX, toY } = dragPolicy;
  const fromExecutor = screenshotToExecutorPoint(fromX, fromY, screenshot, config);
  const toExecutor = screenshotToExecutorPoint(toX, toY, screenshot, config);
  return {
    ok: true,
    action: { ...action, fromX: fromExecutor.x, fromY: fromExecutor.y, toX: toExecutor.x, toY: toExecutor.y },
    grounding: {
      ...groundingForAction(action),
      status: 'provided',
      provider: dragPolicy.provider,
      reason: dragPolicy.reason,
      localFromX: fromX,
      localFromY: fromY,
      localToX: toX,
      localToY: toY,
      screenshotFromX: fromX,
      screenshotFromY: fromY,
      screenshotToX: toX,
      screenshotToY: toY,
      executorFromX: fromExecutor.x,
      executorFromY: fromExecutor.y,
      executorToX: toExecutor.x,
      executorToY: toExecutor.y,
      executorCoordinateScale: fromExecutor.scale,
      coordinateSpace: fromExecutor.coordinateSpace,
      windowTarget: screenshot.windowTarget,
    },
  };
}

function targetDescriptionGrounding(action: GenericVisionAction, screenshot: ScreenshotRef | undefined, config: VisionSenseConfig) {
  const width = screenshot?.width ?? screenshot?.windowTarget?.bounds?.width ?? 1;
  const height = screenshot?.height ?? screenshot?.windowTarget?.bounds?.height ?? 1;
  const localX = Math.max(0, Math.round(width / 2));
  const localY = Math.max(0, Math.round(height / 2));
  return {
    ...groundingForAction(action),
    status: 'provided',
    provider: visionSenseGroundingIds.targetDescriptionWindowCenter,
    reason: 'non-pointer action carries a visual target description; using the target window center as a conservative coarse focus point',
    targetRegionDescription: action.targetRegionDescription,
    targetDescription: action.targetDescription ?? action.targetRegionDescription,
    screenshotX: localX,
    screenshotY: localY,
    localX,
    localY,
    coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? config.windowTarget.coordinateSpace,
    windowTarget: screenshot?.windowTarget,
  };
}

export function screenshotToExecutorPoint(x: number, y: number, screenshot: ScreenshotRef | undefined, config: VisionSenseConfig) {
  const scale = config.executorCoordinateScale ?? inferExecutorCoordinateScale(screenshot, config);
  const bounds = isWindowLocalCoordinateSpace(screenshot?.windowTarget?.coordinateSpace) ? screenshot?.windowTarget?.bounds : undefined;
  const screenshotWidth = screenshot?.width;
  const screenshotHeight = screenshot?.height;
  if (bounds && screenshotWidth && screenshotHeight) {
    const expectedContentWidth = bounds.width * scale;
    const expectedContentHeight = bounds.height * scale;
    const shadowPaddingX = screenshotWidth > expectedContentWidth ? (screenshotWidth - expectedContentWidth) / 2 : 0;
    const verticalShadow = screenshotHeight > expectedContentHeight ? screenshotHeight - expectedContentHeight : 0;
    const topShadowPaddingY = verticalShadow > 0
      ? Math.min(verticalShadow, shadowPaddingX > 0 ? Math.min(verticalShadow / 2, shadowPaddingX * 0.45) : verticalShadow / 2)
      : 0;
    const bottomShadowPaddingY = Math.max(0, verticalShadow - topShadowPaddingY);
    const contentImageWidth = Math.max(1, screenshotWidth - shadowPaddingX * 2);
    const contentImageHeight = Math.max(1, screenshotHeight - topShadowPaddingY - bottomShadowPaddingY);
    const localX = Math.max(0, Math.min(contentImageWidth, x - shadowPaddingX));
    const localY = Math.max(0, Math.min(contentImageHeight, y - topShadowPaddingY));
    const mappedX = bounds.x + (localX / contentImageWidth) * bounds.width;
    const mappedY = bounds.y + (localY / contentImageHeight) * bounds.height;
    return {
      x: mappedX,
      y: mappedY,
      scale,
      screenshotToWindowScaleX: bounds.width / contentImageWidth,
      screenshotToWindowScaleY: bounds.height / contentImageHeight,
      shadowPaddingX,
      topShadowPaddingY,
      bottomShadowPaddingY,
      mapping: 'window-screenshot-content-bounds',
      coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? config.windowTarget.coordinateSpace,
    };
  }
  return {
    x: (x + (bounds?.x ?? 0)) / scale,
    y: (y + (bounds?.y ?? 0)) / scale,
    scale,
    coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? config.windowTarget.coordinateSpace,
  };
}

export async function buildFocusRegionFromVisionSense(screenshot: ScreenshotRef | undefined, grounding: Record<string, unknown> | undefined): Promise<FocusRegion | undefined> {
  if (!screenshot || !grounding) return undefined;
  const result = await visionSenseCoarseToFineRequest({
    mode: 'focus-region',
    sourceRef: toTraceScreenshotRef(screenshot),
    grounding,
  });
  return isRecord(result) ? result as unknown as FocusRegion : undefined;
}

export async function buildVerifierPlanningFeedbackFromVisionSense(params: {
  action: GenericVisionAction;
  status: 'done' | 'failed' | 'blocked';
  grounding?: Record<string, unknown>;
  pixelDiff?: Record<string, unknown>;
  windowConsistency?: Record<string, unknown>;
  visualFocus?: Record<string, unknown>;
  failureReason?: string;
}) {
  const result = await visionSenseCoarseToFineRequest({
    mode: 'verifier-feedback',
    action: params.action,
    status: params.status,
    grounding: params.grounding,
    pixelDiff: params.pixelDiff,
    windowConsistency: params.windowConsistency,
    visualFocus: params.visualFocus,
    failureReason: params.failureReason,
  });
  return typeof result === 'string' ? result : '';
}

export async function buildRegionSemanticVerifierFromVisionSense(params: {
  action: GenericVisionAction;
  status: 'done' | 'failed' | 'blocked';
  grounding?: Record<string, unknown>;
  pixelDiff?: Record<string, unknown>;
  focusPixelDiff?: Record<string, unknown>;
  visualFocus?: Record<string, unknown>;
  failureReason?: string;
}) {
  const result = await visionSenseCoarseToFineRequest({
    mode: 'region-semantic-verifier',
    action: params.action,
    status: params.status,
    grounding: params.grounding,
    pixelDiff: params.pixelDiff,
    focusPixelDiff: params.focusPixelDiff,
    visualFocus: params.visualFocus,
    failureReason: params.failureReason,
  });
  return isRecord(result) ? result : undefined;
}

export async function refineActionGroundingWithFocusRegion(params: {
  action: GenericVisionAction;
  grounding?: Record<string, unknown>;
  focusRegion: FocusRegion;
  beforeRef: ScreenshotRef | undefined;
  focusRefs: ScreenshotRef[];
  config: VisionSenseConfig;
}): Promise<GroundingResolution> {
  const { action, grounding, focusRegion, beforeRef, focusRefs, config } = params;
  const focusRef = focusRefs[0];
  const fineTargetDescription = action.targetDescription || action.targetRegionDescription;
  if (!focusRef || !beforeRef || !fineTargetDescription) {
    return { ok: true, action, grounding };
  }
  if (action.type !== 'click' && action.type !== 'double_click' && action.type !== 'wait') {
    return { ok: true, action, grounding };
  }
  const fine = await groundTargetDescription(fineTargetDescription, focusRefs, config, {
    coordinateSpace: 'crop-local',
  });
  if (!fine.ok) {
    return {
      ok: false,
      action,
      grounding: {
        status: 'failed',
        provider: visionSenseGroundingIds.coarseToFineFocusRegion,
        stage: 'fine',
        targetDescription: fineTargetDescription,
        focusRegion,
        focusScreenshotRef: focusRef.path,
        coarseGrounding: grounding,
        reason: fine.reason,
        fineGrounding: fine.grounding,
      },
      reason: fine.reason,
    };
  }
  const rejectedFineReason = suspiciousFineGroundingReason(fine.x, fine.y, focusRegion, focusRef, fine.grounding);
  if (rejectedFineReason) {
    return {
      ok: true,
      action,
      grounding: {
        ...(grounding ?? {}),
        status: 'ok',
        fineGrounding: {
          ...fine.grounding,
          status: 'rejected',
          provider: visionSenseFocusRegionGroundingId(fine.grounding.provider),
          stage: 'fine',
          targetDescription: fineTargetDescription,
          focusScreenshotRef: focusRef.path,
          focusRegion,
          cropLocalX: fine.x,
          cropLocalY: fine.y,
          rejectionReason: rejectedFineReason,
        },
        fineGroundingRejected: true,
        fineGroundingRejectionReason: rejectedFineReason,
      },
    };
  }
  const localX = focusRegion.x + fine.x;
  const localY = focusRegion.y + fine.y;
  const executorPoint = screenshotToExecutorPoint(localX, localY, beforeRef, config);
  const fineGrounding = {
    ...fine.grounding,
    status: 'ok',
    provider: visionSenseFocusRegionGroundingId(fine.grounding.provider),
    stage: 'fine',
    targetDescription: fineTargetDescription,
    focusScreenshotRef: focusRef.path,
    focusRegion,
    cropLocalX: fine.x,
    cropLocalY: fine.y,
    windowLocalX: localX,
    windowLocalY: localY,
  };
  const mergedGrounding = {
    ...(grounding ?? {}),
    status: 'ok',
    provider: visionSenseGroundingIds.coarseToFine,
    coarseGrounding: grounding,
    fineGrounding,
    targetDescription: action.targetDescription,
    targetRegionDescription: action.targetRegionDescription,
    screenshotX: localX,
    screenshotY: localY,
    localX,
    localY,
    executorX: executorPoint.x,
    executorY: executorPoint.y,
    executorCoordinateScale: executorPoint.scale,
    coordinateSpace: executorPoint.coordinateSpace,
    windowTarget: beforeRef.windowTarget,
  };
  if (action.type === 'wait') {
    return {
      ok: true,
      action,
      grounding: {
        ...mergedGrounding,
        observationOnly: true,
      },
    };
  }
  return {
    ok: true,
    action: { ...action, x: executorPoint.x, y: executorPoint.y },
    grounding: mergedGrounding,
  };
}

function suspiciousFineGroundingReason(
  cropLocalX: number,
  cropLocalY: number,
  focusRegion: FocusRegion,
  focusRef: ScreenshotRef,
  fineGrounding: Record<string, unknown>,
) {
  const fineImageSize = isRecord(fineGrounding.imageSize) ? fineGrounding.imageSize : undefined;
  const fineImageWidth = typeof fineImageSize?.width === 'number' ? fineImageSize.width : undefined;
  const fineImageHeight = typeof fineImageSize?.height === 'number' ? fineImageSize.height : undefined;
  const width = fineImageWidth || focusRef.width || focusRegion.width;
  const height = fineImageHeight || focusRef.height || focusRegion.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
  const edgeMargin = Math.max(8, Math.min(width, height) * 0.04);
  const nearEdge = cropLocalX <= edgeMargin
    || cropLocalY <= edgeMargin
    || cropLocalX >= width - edgeMargin
    || cropLocalY >= height - edgeMargin;
  if (nearEdge) {
    return `fine grounding landed near focus-crop edge (${cropLocalX.toFixed(1)},${cropLocalY.toFixed(1)}), keeping coarse point`;
  }
  const focusCenterX = Number.isFinite(focusRegion.centerX) ? focusRegion.centerX - focusRegion.x : width / 2;
  const focusCenterY = Number.isFinite(focusRegion.centerY) ? focusRegion.centerY - focusRegion.y : height / 2;
  const distance = Math.hypot(cropLocalX - focusCenterX, cropLocalY - focusCenterY);
  const maxAllowedDistance = Math.max(width, height) * 0.4;
  if (distance > maxAllowedDistance) {
    return `fine grounding drifted ${distance.toFixed(1)}px from coarse-centered focus core, keeping coarse point`;
  }
  return '';
}

function visionSenseCoarseToFineRequest(request: Record<string, unknown>): unknown {
  if (request.mode === 'focus-region') {
    return buildFocusRegionFromTrace(recordFrom(request.sourceRef), recordFrom(request.grounding));
  }
  if (request.mode === 'verifier-feedback') {
    return buildVerifierPlanningFeedback({
      action: recordFrom(request.action),
      status: typeof request.status === 'string' ? request.status : undefined,
      grounding: recordFrom(request.grounding),
      pixelDiff: recordFrom(request.pixelDiff),
      windowConsistency: recordFrom(request.windowConsistency),
      visualFocus: recordFrom(request.visualFocus),
      failureReason: typeof request.failureReason === 'string' ? request.failureReason : undefined,
    });
  }
  if (request.mode === 'region-semantic-verifier') {
    return buildRegionSemanticVerifier({
      action: recordFrom(request.action),
      status: typeof request.status === 'string' ? request.status : undefined,
      grounding: recordFrom(request.grounding),
      pixelDiff: recordFrom(request.pixelDiff),
      focusPixelDiff: recordFrom(request.focusPixelDiff),
      visualFocus: recordFrom(request.visualFocus),
      failureReason: typeof request.failureReason === 'string' ? request.failureReason : undefined,
    });
  }
  return undefined;
}

function buildFocusRegionFromTrace(sourceRef: Record<string, unknown>, grounding: Record<string, unknown>): FocusRegion | undefined {
  const centerX = firstNumber(grounding.localX, grounding.screenshotX, grounding.x);
  const centerY = firstNumber(grounding.localY, grounding.screenshotY, grounding.y);
  const sourceWidth = firstNumber(sourceRef.width);
  const sourceHeight = firstNumber(sourceRef.height);
  const path = looseStringValue(sourceRef.path);
  if (centerX === undefined || centerY === undefined || sourceWidth === undefined || sourceHeight === undefined || !path) return undefined;
  return buildFocusRegion({
    sourceScreenshotRef: path,
    centerX,
    centerY,
    sourceWidth: Math.trunc(sourceWidth),
    sourceHeight: Math.trunc(sourceHeight),
    reason: looseStringValue(grounding.targetDescription) || looseStringValue(grounding.reason) || 'grounded target',
  });
}

function buildFocusRegion(params: {
  sourceScreenshotRef: string;
  centerX: number;
  centerY: number;
  sourceWidth: number;
  sourceHeight: number;
  reason: string;
}): FocusRegion | undefined {
  const maxWidth = 360;
  const maxHeight = 300;
  const minWidth = 96;
  const minHeight = 80;
  const ratio = 0.35;
  if (params.sourceWidth <= 0 || params.sourceHeight <= 0) return undefined;
  const width = Math.min(params.sourceWidth, Math.max(1, Math.min(maxWidth, Math.max(minWidth, Math.round(params.sourceWidth * ratio)))));
  const height = Math.min(params.sourceHeight, Math.max(1, Math.min(maxHeight, Math.max(minHeight, Math.round(params.sourceHeight * ratio)))));
  const x = clamp(Math.round(params.centerX - width / 2), 0, Math.max(0, params.sourceWidth - width));
  const y = clamp(Math.round(params.centerY - height / 2), 0, Math.max(0, params.sourceHeight - height));
  return {
    sourceScreenshotRef: params.sourceScreenshotRef,
    coordinateFrame: 'source-screenshot-pixels',
    x,
    y,
    width,
    height,
    centerX: params.centerX,
    centerY: params.centerY,
    sourceWidth: params.sourceWidth,
    sourceHeight: params.sourceHeight,
    reason: params.reason,
  };
}

function buildVerifierPlanningFeedback(params: {
  action: Record<string, unknown>;
  status?: string;
  grounding: Record<string, unknown>;
  pixelDiff: Record<string, unknown>;
  windowConsistency: Record<string, unknown>;
  visualFocus: Record<string, unknown>;
  failureReason?: string;
}) {
  const parts: string[] = [];
  const pixel = compactPixelDiff(params.pixelDiff);
  if (pixel) parts.push(pixel);
  const window = compactWindowConsistency(params.windowConsistency);
  if (window) parts.push(window);
  const ground = compactGrounding(params.grounding);
  if (ground) parts.push(ground);
  const focus = compactVisualFocus(params.visualFocus);
  if (focus) parts.push(focus);
  if (params.failureReason) parts.push(`failure=${params.failureReason.slice(0, 180)}`);
  if (params.status === 'blocked') parts.push('next=repair prerequisite before retrying this action');
  if (params.status === 'failed') parts.push('next=replan; do not repeat without changing target, modality, or prerequisite');
  if (params.pixelDiff.possiblyNoEffect === true) {
    parts.push(`next=${looseStringValue(params.action.type) || 'action'} produced no visible window effect; avoid repeating same target unless screenshot changed`);
  }
  return parts.join(' | ');
}

function buildRegionSemanticVerifier(params: {
  action: Record<string, unknown>;
  status?: string;
  grounding: Record<string, unknown>;
  pixelDiff: Record<string, unknown>;
  focusPixelDiff: Record<string, unknown>;
  visualFocus: Record<string, unknown>;
  failureReason?: string;
}): Record<string, unknown> {
  // Region semantics are verifier evidence for replanning; they must not become final safety or completion truth.
  const actionType = looseStringValue(params.action.type) || 'unknown';
  const target = looseStringValue(params.action.targetRegionDescription)
    || looseStringValue(params.action.targetDescription)
    || looseStringValue(params.grounding.targetDescription)
    || '';
  const focusChanged = pixelChanged(params.focusPixelDiff);
  const windowChanged = pixelChanged(params.pixelDiff);
  const focusNoEffect = pixelNoEffect(params.focusPixelDiff);
  const windowNoEffect = pixelNoEffect(params.pixelDiff);
  const region = focusRegionDict(params.visualFocus);

  let verdict: string;
  let nextHint: string;
  if (params.status === 'failed') {
    verdict = 'execution-failed';
    nextHint = 'replan before retrying this focused target';
  } else if (actionType === 'type_text') {
    if (focusChanged || windowChanged) {
      verdict = 'text-entry-region-changed';
      nextHint = 'verify visible text or continue with the next field';
    } else {
      verdict = 'text-entry-unverified';
      nextHint = 'activate the intended focused text field or widen focus before typing again';
    }
  } else if (actionType === 'click' || actionType === 'double_click') {
    if (focusChanged) {
      verdict = 'focused-target-reacted';
      nextHint = 'continue from the changed focused region';
    } else if (windowChanged && focusNoEffect) {
      verdict = 'off-target-or-unrelated-window-change';
      nextHint = 'avoid the same point; refine target description or widen focus';
    } else if (focusNoEffect || windowNoEffect) {
      verdict = 'focused-target-no-visible-effect';
      nextHint = 'switch modality, choose a different visible control, or request a wider focus region';
    } else {
      verdict = 'focused-target-uncertain';
      nextHint = 'use current screenshot and focus refs before repeating';
    }
  } else if (actionType === 'scroll' || actionType === 'drag') {
    verdict = focusChanged || windowChanged ? 'region-motion-detected' : 'region-motion-not-detected';
    nextHint = 'continue only if the target content moved as intended';
  } else {
    verdict = focusChanged || windowChanged ? 'region-evidence-recorded' : 'region-evidence-unchanged';
    nextHint = 'use focused evidence in the next plan';
  }

  let confidence = focusChanged || focusNoEffect ? 0.78 : 0.55;
  if (!Object.keys(region).length) confidence = Math.min(confidence, 0.45);
  const summary = [
    `regionSemantic=${verdict}`,
    `action=${actionType}`,
    target ? `target="${target.slice(0, 80)}"` : '',
    compactVisualFocus(params.visualFocus),
    `next=${nextHint}`,
    params.failureReason ? `failure=${params.failureReason.slice(0, 120)}` : '',
  ].filter(Boolean).join(' | ');

  return {
    schemaVersion: 'sciforge.vision-sense.region-semantic-verifier.v1',
    verdict,
    confidence,
    targetDescription: target || null,
    actionType,
    focusRegion: Object.keys(region).length ? region : null,
    focusChanged,
    windowChanged,
    possiblyNoEffect: focusNoEffect || windowNoEffect,
    nextPlannerHint: nextHint,
    summary,
  };
}

function compactPixelDiff(pixelDiff: Record<string, unknown>) {
  const pairs = recordPairs(pixelDiff.pairs);
  const noEffect = pixelDiff.possiblyNoEffect === true || (pairs.length > 0 && pairs.every((pair) => pair.possiblyNoEffect === true));
  const ratios = pairs
    .slice(0, 3)
    .map((pair) => firstNumber(pair.changedByteRatio))
    .filter((value): value is number => value !== undefined)
    .map((value) => value.toFixed(4))
    .join(',');
  if (!pairs.length && pixelDiff.possiblyNoEffect !== true) return '';
  return `pixel=${noEffect ? 'no-visible-effect' : 'changed'}${ratios ? ` ratios=${ratios}` : ''}`;
}

function compactWindowConsistency(consistency: Record<string, unknown>) {
  const pieces: string[] = [];
  const status = looseStringValue(consistency.status);
  if (status) pieces.push(`window=${status}`);
  if (typeof consistency.sameWindow === 'boolean') pieces.push(`sameWindow=${String(consistency.sameWindow)}`);
  if (typeof consistency.scopeOk === 'boolean') pieces.push(`scopeOk=${String(consistency.scopeOk)}`);
  return pieces.join(' ');
}

function compactGrounding(grounding: Record<string, unknown>) {
  const pieces: string[] = [];
  const status = looseStringValue(grounding.status);
  if (status) pieces.push(`grounding=${status}`);
  const target = looseStringValue(grounding.targetDescription);
  if (target) pieces.push(`target="${target.slice(0, 80)}"`);
  const local = coordinatePair(grounding.localX, grounding.localY) || coordinatePair(grounding.screenshotX, grounding.screenshotY);
  if (local) pieces.push(`local=${local}`);
  const executor = coordinatePair(grounding.executorX, grounding.executorY);
  if (executor) pieces.push(`executor=${executor}`);
  return pieces.join(' ');
}

function compactVisualFocus(visualFocus: Record<string, unknown>) {
  const region = isRecord(visualFocus.region) ? visualFocus.region : visualFocus;
  const bbox = ['x', 'y', 'width', 'height']
    .map((key) => firstNumber(region[key]))
    .filter((value): value is number => value !== undefined)
    .map((value) => String(Math.trunc(value)))
    .join(',');
  return bbox ? `focus=bbox(${bbox})` : '';
}

function focusRegionDict(visualFocus: Record<string, unknown>) {
  const region = isRecord(visualFocus.region) ? visualFocus.region : visualFocus;
  const result: Record<string, unknown> = {};
  for (const key of ['x', 'y', 'width', 'height', 'centerX', 'centerY', 'sourceWidth', 'sourceHeight']) {
    const value = firstNumber(region[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function pixelChanged(pixelDiff: Record<string, unknown>) {
  if (pixelDiff.possiblyNoEffect === false) return true;
  return recordPairs(pixelDiff.pairs).some((pair) => {
    const ratio = firstNumber(pair.changedByteRatio);
    return ratio !== undefined && ratio >= 0.005;
  });
}

function pixelNoEffect(pixelDiff: Record<string, unknown>) {
  const pairs = recordPairs(pixelDiff.pairs);
  return pixelDiff.possiblyNoEffect === true || (pairs.length > 0 && pairs.every((pair) => pair.possiblyNoEffect === true));
}

function recordPairs(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function coordinatePair(x: unknown, y: unknown) {
  const numericX = firstNumber(x);
  const numericY = firstNumber(y);
  return numericX === undefined || numericY === undefined ? '' : `${Math.round(numericX)},${Math.round(numericY)}`;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function looseStringValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}

function recordFrom(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function clamp(value: number, lower: number, upper: number) {
  return Math.max(lower, Math.min(upper, value));
}

async function groundTargetDescription(
  targetDescription: string,
  beforeRefs: ScreenshotRef[],
  config: VisionSenseConfig,
  options: { coordinateSpace?: 'window-local' | 'crop-local' } = {},
): Promise<{ ok: true; x: number; y: number; grounding: Record<string, unknown> } | { ok: false; reason: string; grounding: Record<string, unknown> }> {
  const screenshot = beforeRefs[0];
  if (!screenshot) {
    return {
      ok: false,
      reason: 'Model Router grounding translator could not run because no before screenshot was captured.',
      grounding: { status: 'failed', targetDescription, reason: 'missing screenshot' },
    };
  }
  const fallback = independentAdapterGroundingFallback(targetDescription, screenshot, config, options);
  if (fallback) return fallback;
  return {
    ok: false,
    reason: 'Model Router grounding translator did not return target coordinates for this action.',
    grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, provider: visionSenseGroundingIds.modelRouterGrounding, reason: 'missing model-router grounding translator result' },
  };
}

function independentAdapterGroundingFallback(
  targetDescription: string,
  screenshot: ScreenshotRef,
  config: VisionSenseConfig,
  options: { coordinateSpace?: 'window-local' | 'crop-local' } = {},
) {
  if (config.inputAdapter !== 'remote-desktop' || !config.independentInputAdapterProvider) return undefined;
  const width = positiveNumber(screenshot.width) ?? 1;
  const height = positiveNumber(screenshot.height) ?? 1;
  const x = Math.max(0, Math.floor(width / 2));
  const y = Math.max(0, Math.floor(height / 2));
  return {
    ok: true as const,
    x,
    y,
    grounding: {
      status: 'ok',
      provider: 'ts-target-bound-independent-input-grounder',
      targetDescription,
      screenshotRef: screenshot.path,
      x,
      y,
      localX: x,
      localY: y,
      coordinateSpace: options.coordinateSpace ?? 'observation',
      confidence: 0.45,
      reason: 'Target-bound remote-desktop adapter used a TypeScript center-point grounding fallback while Model Router grounding coordinates were unavailable.',
      sharedSystemInputUsed: false,
    },
  };
}

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
