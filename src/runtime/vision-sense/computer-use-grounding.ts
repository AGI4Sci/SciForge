import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { isRecord, toStringList } from '../gateway-utils.js';
import { groundingForAction } from '../computer-use/actions.js';
import { toTraceScreenshotRef } from '../computer-use/capture.js';
import type { ComputerUseConfig as VisionSenseConfig, FocusRegion, GenericVisionAction, GroundingResolution, ScreenshotRef } from '../computer-use/types.js';
import { extractChatCompletionContent, extractJsonObject, isDarwinPlatform, numberConfig, parseJson, runCommand, sanitizeId } from '../computer-use/utils.js';
import { isWindowLocalCoordinateSpace } from '../computer-use/window-target.js';
import {
  visionSenseCrossDisplayWindowDragPolicy,
  visionSenseFocusRegionGroundingId,
  visionSenseGroundingIds,
} from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import { postOpenAiChatCompletion, visionModelIssue, withHardTimeout } from './computer-use-plan.js';
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
    const shadowPaddingY = screenshotHeight > expectedContentHeight ? (screenshotHeight - expectedContentHeight) / 2 : 0;
    const contentImageWidth = Math.max(1, screenshotWidth - shadowPaddingX * 2);
    const contentImageHeight = Math.max(1, screenshotHeight - shadowPaddingY * 2);
    const localX = Math.max(0, Math.min(contentImageWidth, x - shadowPaddingX));
    const localY = Math.max(0, Math.min(contentImageHeight, y - shadowPaddingY));
    const mappedX = bounds.x + (localX / contentImageWidth) * bounds.width;
    const mappedY = bounds.y + (localY / contentImageHeight) * bounds.height;
    return {
      x: mappedX,
      y: mappedY,
      scale,
      screenshotToWindowScaleX: bounds.width / contentImageWidth,
      screenshotToWindowScaleY: bounds.height / contentImageHeight,
      shadowPaddingX,
      shadowPaddingY,
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
  const fine = await groundTargetDescription(fineTargetDescription, focusRefs, config);
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

async function visionSenseCoarseToFineRequest(request: Record<string, unknown>) {
  const python = process.env.SCIFORGE_VISION_SENSE_PYTHON || 'python3';
  const modulePath = resolve('packages/observe/vision/sciforge_vision_sense/coarse_to_fine.py');
  const code = [
    'import importlib.util, sys',
    `spec = importlib.util.spec_from_file_location("sciforge_vision_sense_coarse_to_fine_runtime", ${JSON.stringify(modulePath)})`,
    'module = importlib.util.module_from_spec(spec)',
    'sys.modules[spec.name] = module',
    'spec.loader.exec_module(module)',
    'main = module.main',
    'raise SystemExit(main([sys.argv[1]]))',
  ].join('; ');
  const result = await runCommand(python, ['-c', code, JSON.stringify(request)], { timeoutMs: 10000 });
  if (result.exitCode !== 0) return undefined;
  const parsed = parseJson(result.stdout.trim());
  if (!isRecord(parsed) || parsed.ok !== true) return undefined;
  return parsed.result;
}

async function groundTargetDescription(
  targetDescription: string,
  beforeRefs: ScreenshotRef[],
  config: VisionSenseConfig,
): Promise<{ ok: true; x: number; y: number; grounding: Record<string, unknown> } | { ok: false; reason: string; grounding: Record<string, unknown> }> {
  const screenshot = beforeRefs[0];
  if (!screenshot) {
    return {
      ok: false,
      reason: 'Grounder could not run because no before screenshot was captured.',
      grounding: { status: 'failed', targetDescription, reason: 'missing screenshot' },
    };
  }
  if (!config.grounder.baseUrl) {
    return groundTargetWithVisionModel(targetDescription, screenshot, config);
  }
  const imagePath = await resolveGrounderImagePath(screenshot, config);
  if (!imagePath.ok) {
    return {
      ok: false,
      reason: imagePath.reason,
      grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, reason: imagePath.reason },
    };
  }

  const startedAt = Date.now();
  const grounderPrompt = [
    'Locate the UI element for a mouse click in the supplied screenshot.',
    'Return click coordinates only; do not return typing commands, text content, or action plans.',
    `Target: ${targetDescription}`,
  ].join(' ');
  const grounderUrl = `${config.grounder.baseUrl.replace(/\/+$/, '')}/predict/`;
  const response = await postJsonWithTimeout(
    grounderUrl,
    {
      ...(!imagePath.imageBase64 ? { image_path: imagePath.path } : {}),
      ...(imagePath.imageBase64 ? { image_base64: imagePath.imageBase64, image_mime_type: imagePath.imageMimeType ?? 'image/png' } : {}),
      text_prompt: grounderPrompt,
      coordinate_space: screenshot.windowTarget?.coordinateSpace ?? 'screen',
      window_target: screenshot.windowTarget,
    },
    config.grounder.timeoutMs,
  );
  if (!response.ok) {
    const fallback = await groundTargetWithVisionModel(targetDescription, screenshot, config);
    if (fallback.ok) {
      return {
        ...fallback,
        grounding: {
          ...fallback.grounding,
          fallbackFrom: visionSenseGroundingIds.kvGround,
          kvGroundUrl: grounderUrl,
          kvGroundFailure: response.error,
        },
      };
    }
    return {
      ok: false,
      reason: [
        `KV Grounder request failed at ${grounderUrl}: ${response.error}.`,
        `Fallback visual Grounder failed: ${fallback.reason}`,
      ].join(' '),
      grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, imagePath: imagePath.path, provider: visionSenseGroundingIds.kvGround, grounderUrl, error: response.error, fallbackReason: fallback.reason },
    };
  }
  const coordinates = parseGrounderCoordinates(response.body);
  if (!coordinates) {
    const fallback = await groundTargetWithVisionModel(targetDescription, screenshot, config);
    if (fallback.ok) {
      return {
        ...fallback,
        grounding: {
          ...fallback.grounding,
          fallbackFrom: visionSenseGroundingIds.kvGround,
          kvGroundFailure: 'response did not include usable coordinates',
          kvGroundRawResponse: response.body,
        },
      };
    }
    return {
      ok: false,
      reason: fallback.reason === 'No visual Grounder is configured.'
        ? 'Grounder response did not include usable coordinates.'
        : `Grounder response did not include usable coordinates; fallback visual Grounder also failed: ${fallback.reason}`,
      grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, imagePath: imagePath.path, rawResponse: response.body, fallbackReason: fallback.reason },
    };
  }
  return {
    ok: true,
    x: coordinates.x,
    y: coordinates.y,
    grounding: {
      status: 'ok',
      provider: visionSenseGroundingIds.kvGround,
      targetDescription,
      screenshotRef: screenshot.path,
      imagePath: imagePath.path,
      imageUploaded: imagePath.uploaded === true,
      x: coordinates.x,
      y: coordinates.y,
      latencyMs: Date.now() - startedAt,
      rawResponse: response.body,
    },
  };
}

async function groundTargetWithVisionModel(
  targetDescription: string,
  screenshot: ScreenshotRef,
  config: VisionSenseConfig,
): Promise<{ ok: true; x: number; y: number; grounding: Record<string, unknown> } | { ok: false; reason: string; grounding: Record<string, unknown> }> {
  if (!config.grounder.visionBaseUrl || !config.grounder.visionApiKey || !config.grounder.visionModel) {
    return {
      ok: false,
      reason: [
        'No Grounder is configured. Set SCIFORGE_VISION_KV_GROUND_URL for KV-Ground,',
        'or configure SCIFORGE_VISION_GROUNDER_LLM_BASE_URL/API_KEY/MODEL for an OpenAI-compatible visual Grounder.',
      ].join(' '),
      grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, reason: 'missing grounder provider' },
    };
  }
  const modelIssue = visionModelIssue(config.grounder.visionModel);
  if (modelIssue) {
    return {
      ok: false,
      reason: `OpenAI-compatible visual Grounder model is not configured as a VLM: ${modelIssue}`,
      grounding: { status: 'failed', provider: visionSenseGroundingIds.openAiCompatibleVisionGrounder, targetDescription, screenshotRef: screenshot.path, reason: 'text-only model configured for visual grounding' },
    };
  }
  const startedAt = Date.now();
  const imageBase64 = (await readFile(screenshot.absPath)).toString('base64');
  const response = await postOpenAiChatCompletion(
    {
      baseUrl: config.grounder.visionBaseUrl,
      apiKey: config.grounder.visionApiKey,
      model: config.grounder.visionModel,
      timeoutMs: config.grounder.visionTimeoutMs,
      maxTokens: config.grounder.visionMaxTokens,
    },
    [
      {
        role: 'system',
        content: [
          'You are SciForge Grounder for generic Computer Use.',
          'Return only JSON with pixel coordinates in the supplied target-window screenshot coordinate system.',
          'Do not use DOM, accessibility, selectors, app APIs, or private shortcuts.',
          'Schema: {"coordinates":[x,y],"confidence":0..1,"reason":"short visual evidence"}.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Locate this visual target: ${targetDescription}\nScreenshot size metadata: width=${screenshot.width ?? 'unknown'} height=${screenshot.height ?? 'unknown'}.\nWindow target metadata: ${JSON.stringify(screenshot.windowTarget ?? { mode: 'display', coordinateSpace: 'screen' })}.` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      },
    ],
  );
  if (!response.ok) {
    return {
      ok: false,
      reason: `OpenAI-compatible visual Grounder request failed: ${response.error}`,
      grounding: { status: 'failed', provider: visionSenseGroundingIds.openAiCompatibleVisionGrounder, targetDescription, screenshotRef: screenshot.path, error: response.error },
    };
  }
  const content = extractChatCompletionContent(response.body);
  const json = typeof content === 'string' ? extractJsonObject(content) : undefined;
  const coordinates = parseGrounderCoordinates(isRecord(json) ? json : response.body);
  if (!coordinates) {
    return {
      ok: false,
      reason: 'OpenAI-compatible visual Grounder response did not include usable coordinates.',
      grounding: { status: 'failed', provider: visionSenseGroundingIds.openAiCompatibleVisionGrounder, targetDescription, screenshotRef: screenshot.path, rawResponse: response.body },
    };
  }
  return {
    ok: true,
    x: coordinates.x,
    y: coordinates.y,
    grounding: {
      status: 'ok',
      provider: visionSenseGroundingIds.openAiCompatibleVisionGrounder,
      targetDescription,
      screenshotRef: screenshot.path,
      x: coordinates.x,
      y: coordinates.y,
      latencyMs: Date.now() - startedAt,
      rawResponse: response.body,
    },
  };
}

async function resolveGrounderImagePath(ref: ScreenshotRef, config: VisionSenseConfig): Promise<{ ok: true; path: string; uploaded?: boolean; imageBase64?: string; imageMimeType?: string } | { ok: false; reason: string }> {
  if (config.grounder.allowServiceLocalPaths) return { ok: true, path: ref.absPath };
  const localPrefix = config.grounder.localPathPrefix;
  const remotePrefix = config.grounder.remotePathPrefix;
  if (localPrefix && remotePrefix && ref.absPath.startsWith(localPrefix)) {
    return { ok: true, path: `${remotePrefix.replace(/\/+$/, '')}/${ref.absPath.slice(localPrefix.length).replace(/^\/+/, '')}` };
  }
  const uploadStrategy = config.grounder.upload?.strategy ?? 'inline';
  if (uploadStrategy === 'inline') {
    return {
      ok: true,
      path: `inline:image/png;sha256=${ref.sha256}`,
      uploaded: true,
      imageBase64: (await readFile(ref.absPath)).toString('base64'),
      imageMimeType: 'image/png',
    };
  }
  const uploaded = await uploadGrounderImage(ref, config);
  if (uploaded.ok) return uploaded;
  if (uploaded.reason !== 'not-configured') return { ok: false, reason: uploaded.reason };
  return {
    ok: false,
    reason: [
      'Grounder image path is local-only and no service-readable mapping is configured.',
      'Set SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS=1 when the service shares the same filesystem,',
      'configure SCIFORGE_VISION_KV_GROUND_LOCAL_PATH_PREFIX and SCIFORGE_VISION_KV_GROUND_REMOTE_PATH_PREFIX,',
      'or configure SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY=scp with upload host/remote dir.',
    ].join(' '),
  };
}

async function uploadGrounderImage(ref: ScreenshotRef, config: VisionSenseConfig): Promise<{ ok: true; path: string; uploaded: true } | { ok: false; reason: string }> {
  const upload = config.grounder.upload;
  if (upload?.strategy !== 'scp') return { ok: false, reason: 'not-configured' };
  if (!upload.host || !upload.remoteDir) {
    return {
      ok: false,
      reason: 'KV-Ground SCP upload is configured but missing host or remoteDir. Set SCIFORGE_VISION_KV_GROUND_UPLOAD_HOST and SCIFORGE_VISION_KV_GROUND_UPLOAD_REMOTE_DIR.',
    };
  }
  const remoteName = `${sanitizeId(config.runId || 'vision-run')}-${sanitizeId(ref.id || basename(ref.absPath)) || 'screenshot'}.png`;
  const remotePath = `${upload.remoteDir.replace(/\/+$/, '')}/${remoteName}`;
  const args = [
    '-P',
    String(upload.port ?? 22),
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
  if (upload.identityFile) args.push('-i', upload.identityFile);
  args.push(ref.absPath, `${upload.user || 'root'}@${upload.host}:${remotePath}`);
  const result = await runCommand('scp', args, { timeoutMs: config.grounder.timeoutMs });
  if (result.exitCode !== 0) {
    return {
      ok: false,
      reason: `KV-Ground SCP upload failed before grounding: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
    };
  }
  return {
    ok: true,
    path: upload.remoteUrlPrefix ? `${upload.remoteUrlPrefix.replace(/\/+$/, '')}/${remoteName}` : remotePath,
    uploaded: true,
  };
}

async function postJsonWithTimeout(url: string, body: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController();
  try {
    const response = await withHardTimeout(fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }), timeoutMs, `JSON request timed out after ${timeoutMs}ms`, () => controller.abort());
    const text = await withHardTimeout(
      response.text(),
      timeoutMs,
      `JSON response body timed out after ${timeoutMs}ms`,
      () => controller.abort(),
    );
    const parsed = text ? parseJson(text) : {};
    if (!response.ok) {
      return { ok: false as const, error: `HTTP ${response.status}: ${text.slice(0, 500)}` };
    }
    return { ok: true as const, body: isRecord(parsed) ? parsed : { value: parsed } };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseGrounderCoordinates(value: unknown): { x: number; y: number } | undefined {
  const source = isRecord(value) ? value.coordinates : value;
  if (Array.isArray(source) && source.length >= 2) {
    const x = numberConfig(source[0]);
    const y = numberConfig(source[1]);
    return x === undefined || y === undefined ? undefined : { x, y };
  }
  if (isRecord(source)) {
    const x = numberConfig(source.x);
    const y = numberConfig(source.y);
    return x === undefined || y === undefined ? undefined : { x, y };
  }
  return undefined;
}
