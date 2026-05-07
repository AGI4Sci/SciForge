import type { ComputerUseConfig as VisionSenseConfig, GenericVisionAction, LoopStep, ScreenshotRef, TraceWindowTarget } from '../computer-use/types.js';
import { isDarwinPlatform, numberConfig } from '../computer-use/utils.js';
import { isWindowLocalCoordinateSpace } from '../computer-use/window-target.js';
import { uniqueStrings, isRecord } from '../gateway-utils.js';
export function bindWindowTargetFromOpenAppAction(config: VisionSenseConfig, action: GenericVisionAction) {
  if (action.type !== 'open_app') return;
  const appName = action.appName.trim();
  if (!appName) return;
  config.windowTarget = {
    ...config.windowTarget,
    enabled: true,
    required: false,
    mode: 'app-window',
    appName,
    coordinateSpace: config.windowTarget.coordinateSpace === 'screen' ? 'window-local' : config.windowTarget.coordinateSpace,
    windowId: undefined,
    processId: undefined,
    bundleId: undefined,
    title: undefined,
    bounds: undefined,
    contentRect: undefined,
    displayId: undefined,
    focused: undefined,
    minimized: undefined,
    occluded: undefined,
  };
}

export function windowConsistencyMetadata(beforeRefs: ScreenshotRef[], afterRefs: ScreenshotRef[], config: VisionSenseConfig) {
  const before = beforeRefs[0];
  const after = afterRefs[0];
  const beforeTarget = before?.windowTarget;
  const afterTarget = after?.windowTarget;
  const beforeIdentity = windowIdentity(beforeTarget);
  const afterIdentity = windowIdentity(afterTarget);
  const sameWindow = Boolean(beforeIdentity && afterIdentity && beforeIdentity === afterIdentity);
  const targetScope = config.windowTarget.enabled && config.windowTarget.mode !== 'display' ? 'window' : 'display';
  const scopeOk = targetScope === 'display'
    ? true
    : beforeRefs.every((ref) => ref.captureScope === 'window') && afterRefs.every((ref) => ref.captureScope === 'window');
  const lifecycle = [beforeTarget, afterTarget].filter(Boolean).map((target) => ({
    identity: windowIdentity(target),
    focused: target?.focused,
    minimized: target?.minimized,
    occluded: target?.occluded,
    bounds: target?.bounds,
    contentRect: target?.contentRect,
    displayId: target?.displayId,
    captureTimestamp: target?.captureTimestamp,
  }));
  return {
    status: scopeOk && (targetScope === 'display' || sameWindow) ? 'same-target-window' : 'window-lifecycle-changed-or-unverified',
    requiredScope: targetScope,
    beforeWindowIdentity: beforeIdentity,
    afterWindowIdentity: afterIdentity,
    sameWindow,
    scopeOk,
    beforeScreenshotRefs: beforeRefs.map((ref) => ref.path),
    afterScreenshotRefs: afterRefs.map((ref) => ref.path),
    lifecycle,
    recoveryPolicy: 'if identity/bounds/display/focus changes, re-resolve WindowTarget and re-capture before planning the next action',
  };
}

export function windowLifecycleTrace(target: TraceWindowTarget, refs: ScreenshotRef[]) {
  const windowRefs = refs.filter((ref) => ref.captureScope === 'window' || ref.windowTarget?.captureKind === 'window');
  const identities = uniqueStrings(windowRefs.map((ref) => windowIdentity(ref.windowTarget)).filter((value): value is string => Boolean(value)));
  const displayIds = uniqueStrings(windowRefs.map((ref) => String(ref.displayId)).filter(Boolean));
  const lifecycleSamples = windowRefs.slice(-5).map((ref) => ({
    screenshotRef: ref.path,
    identity: windowIdentity(ref.windowTarget),
    displayId: ref.displayId,
    bounds: ref.windowTarget?.bounds,
    contentRect: ref.windowTarget?.contentRect,
    focused: ref.windowTarget?.focused,
    minimized: ref.windowTarget?.minimized,
    occluded: ref.windowTarget?.occluded,
    captureTimestamp: ref.captureTimestamp ?? ref.windowTarget?.captureTimestamp,
  }));
  return {
    targetIdentity: windowIdentity(target),
    observedIdentities: identities,
    observedDisplayIds: displayIds,
    sampleCount: windowRefs.length,
    status: identities.length <= 1 ? 'stable-or-single-window' : 'window-migrated-or-recovered',
    recoveryPolicy: 're-resolve target window by id/app/title when displayId, bounds, focus, minimized, or occlusion state changes',
    samples: lifecycleSamples,
  };
}

function windowIdentity(target: TraceWindowTarget | undefined) {
  if (!target) return undefined;
  return [
    target.windowId ?? target.title ?? target.appName ?? target.bundleId ?? 'unknown-window',
    target.bundleId ?? target.appName ?? 'unknown-app',
  ].join(':');
}

export function inferExecutorCoordinateScale(screenshot: ScreenshotRef | undefined, config: VisionSenseConfig) {
  const bounds = screenshot?.windowTarget?.bounds;
  if (screenshot?.width && screenshot.height && bounds?.width && bounds.height && isWindowLocalCoordinateSpace(screenshot.windowTarget?.coordinateSpace)) {
    const widthRatio = screenshot.width / Math.max(1, bounds.width);
    const heightRatio = screenshot.height / Math.max(1, bounds.height);
    const ratio = Math.min(widthRatio, heightRatio);
    if (isDarwinPlatform(config.desktopPlatform) && ratio >= 1.5 && ratio <= 3.5) return Math.round(ratio);
  }
  if (!screenshot?.width || !screenshot.height) return 1;
  if (isDarwinPlatform(config.desktopPlatform) && screenshot.width >= 2500 && screenshot.height >= 1200) return 2;
  return 1;
}
export function localCoordinateMetadata(grounding: Record<string, unknown> | undefined, action: GenericVisionAction, screenshot: ScreenshotRef | undefined) {
  const space = isWindowLocalCoordinateSpace(screenshot?.windowTarget?.coordinateSpace) ? 'window' : 'screen';
  if (action.type === 'click' || action.type === 'double_click') {
    const x = numberConfig(grounding?.screenshotX, grounding?.localX, action.x);
    const y = numberConfig(grounding?.screenshotY, grounding?.localY, action.y);
    return {
      space,
      coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? space,
      x,
      y,
      localX: x,
      localY: y,
      screenshotRef: screenshot?.path,
    };
  }
  if (action.type === 'drag') {
    const fromX = numberConfig(grounding?.screenshotFromX, grounding?.localFromX, action.fromX);
    const fromY = numberConfig(grounding?.screenshotFromY, grounding?.localFromY, action.fromY);
    const toX = numberConfig(grounding?.screenshotToX, grounding?.localToX, action.toX);
    const toY = numberConfig(grounding?.screenshotToY, grounding?.localToY, action.toY);
    return {
      space,
      coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? space,
      fromX,
      fromY,
      toX,
      toY,
      point: {
        x: fromX,
        y: fromY,
        localX: fromX,
        localY: fromY,
      },
      start: {
        x: fromX,
        y: fromY,
        localX: fromX,
        localY: fromY,
      },
      end: {
        x: toX,
        y: toY,
        localX: toX,
        localY: toY,
      },
      localFromX: fromX,
      localFromY: fromY,
      localToX: toX,
      localToY: toY,
      screenshotRef: screenshot?.path,
    };
  }
  return { space, screenshotRef: screenshot?.path };
}

export function mappedCoordinateMetadata(grounding: Record<string, unknown> | undefined, action: GenericVisionAction) {
  if (action.type === 'click' || action.type === 'double_click') {
    return {
      space: 'executor',
      x: numberConfig(grounding?.executorX, action.x),
      y: numberConfig(grounding?.executorY, action.y),
      scale: numberConfig(grounding?.executorCoordinateScale),
    };
  }
  if (action.type === 'drag') {
    return {
      space: 'executor',
      fromX: numberConfig(grounding?.executorFromX, action.fromX),
      fromY: numberConfig(grounding?.executorFromY, action.fromY),
      toX: numberConfig(grounding?.executorToX, action.toX),
      toY: numberConfig(grounding?.executorToY, action.toY),
      scale: numberConfig(grounding?.executorCoordinateScale),
    };
  }
  return { space: 'executor' };
}

