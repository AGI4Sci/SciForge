export type ScreenRegionBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenRegionBindingPermissionStatus =
  | 'granted'
  | 'prompt'
  | 'unknown'
  | 'denied'
  | 'restricted'
  | 'unavailable';

export type ScreenRegionBindingWindowCandidate = {
  [key: string]: unknown;
  windowRef?: string;
  id?: string | number;
  ownerId?: string | number;
  appId?: string;
  processId?: string | number;
  role?: string;
  bounds?: ScreenRegionBounds;
  screenId?: string;
  scale?: number;
  visible?: boolean;
  isVisible?: boolean;
  minimized?: boolean;
  isMinimized?: boolean;
  excludeFromAutoBinding?: boolean;
};

export type ScreenRegionAutoBindingDiagnostic = {
  code: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  refs?: string[];
};

export type ScreenRegionAutoBindingCandidateSummary = {
  windowRef: string;
  ownerRef?: string;
  bounds: ScreenRegionBounds;
  screenId?: string;
  scale?: number;
  centerInside: boolean;
  overlapRatio: number;
  score: number;
};

export type ScreenRegionAutoBindingResult = {
  status: 'bound' | 'unbound';
  bindingStatus:
    | 'high-confidence'
    | 'invalid-selection'
    | 'permission-failure'
    | 'desktop-region'
    | 'low-confidence'
    | 'multi-window-conflict';
  windowRef?: string;
  windowBounds?: ScreenRegionBounds;
  bounds: ScreenRegionBounds;
  screenId?: string;
  scale?: number;
  diagnostics: ScreenRegionAutoBindingDiagnostic[];
  candidates: ScreenRegionAutoBindingCandidateSummary[];
};

export type BindScreenRegionToWindowInput = {
  screenBounds: ScreenRegionBounds;
  screenId?: string;
  scale?: number;
  windows?: readonly ScreenRegionBindingWindowCandidate[];
  excludedOwnerIds?: readonly string[];
  permissionStatus?: ScreenRegionBindingPermissionStatus;
  minOverlapRatio?: number;
  minScoreLeadRatio?: number;
  minWindowWidth?: number;
  minWindowHeight?: number;
  minWindowArea?: number;
  maxCandidates?: number;
  maxDiagnostics?: number;
};

type ScoredCandidate = ScreenRegionAutoBindingCandidateSummary & {
  overlapArea: number;
};

const DEFAULT_MIN_OVERLAP_RATIO = 0.7;
const DEFAULT_MIN_SCORE_LEAD_RATIO = 0.2;
const DEFAULT_MIN_WINDOW_WIDTH = 32;
const DEFAULT_MIN_WINDOW_HEIGHT = 32;
const DEFAULT_MIN_WINDOW_AREA = 1600;
const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_MAX_DIAGNOSTICS = 6;
const DIAGNOSTIC_MESSAGE_LIMIT = 240;

const EXCLUDED_ROLES = new Set([
  'annotation-overlay',
  'desktop',
  'dock',
  'menu-bar',
  'menubar',
  'overlay',
  'sciforge-main',
  'sciforge-overlay',
  'system-dock',
  'system-menu-bar',
  'system-ui',
]);

export function bindScreenRegionToWindow(
  input: BindScreenRegionToWindowInput,
): ScreenRegionAutoBindingResult {
  const maxDiagnostics = positiveIntegerOrDefault(input.maxDiagnostics, DEFAULT_MAX_DIAGNOSTICS);
  const screenBounds = normalizeBounds(input.screenBounds);
  const base = {
    bounds: screenBounds ?? fallbackBounds(input.screenBounds),
    screenId: textOrUndefined(input.screenId),
    scale: positiveNumberOrUndefined(input.scale),
  };

  if (!screenBounds) {
    return unboundResult({
      ...base,
      bindingStatus: 'invalid-selection',
      candidates: [],
      diagnostics: boundedDiagnostics([diagnostic(
        'desktop.screen-region-binding.invalid-selection',
        'error',
        'Screen region binding requires finite positive screen bounds.',
      )], maxDiagnostics),
    });
  }

  if (isPermissionFailure(input.permissionStatus)) {
    return unboundResult({
      ...base,
      bounds: screenBounds,
      bindingStatus: 'permission-failure',
      candidates: [],
      diagnostics: boundedDiagnostics([diagnostic(
        'desktop.screen-region-binding.permission-failure',
        'error',
        'Window enumeration permission is unavailable, so the selected region remains unbound.',
      )], maxDiagnostics),
    });
  }

  const excludedOwnerIds = new Set((input.excludedOwnerIds ?? []).map((ownerId) => String(ownerId)));
  const filterThresholds = {
    minWindowWidth: positiveNumberOrDefault(input.minWindowWidth, DEFAULT_MIN_WINDOW_WIDTH),
    minWindowHeight: positiveNumberOrDefault(input.minWindowHeight, DEFAULT_MIN_WINDOW_HEIGHT),
    minWindowArea: positiveNumberOrDefault(input.minWindowArea, DEFAULT_MIN_WINDOW_AREA),
  };
  let filteredCount = 0;
  const candidates = (input.windows ?? []).flatMap((window, index): ScoredCandidate[] => {
    const filteredReason = filterWindowCandidate(window, {
      excludedOwnerIds,
      screenId: base.screenId,
      ...filterThresholds,
    });
    if (filteredReason) {
      filteredCount += 1;
      return [];
    }
    const bounds = normalizeBounds(window.bounds);
    if (!bounds) {
      filteredCount += 1;
      return [];
    }
    return [scoreCandidate({
      window,
      index,
      region: screenBounds,
      bounds,
    })];
  }).sort(compareCandidates);

  const limitedCandidates = candidates
    .slice(0, positiveIntegerOrDefault(input.maxCandidates, DEFAULT_MAX_CANDIDATES))
    .map(publicCandidateSummary);
  const diagnostics: ScreenRegionAutoBindingDiagnostic[] = [];
  if (filteredCount > 0) {
    diagnostics.push(diagnostic(
      'desktop.screen-region-binding.filtered-candidates',
      'info',
      `${filteredCount} window enumeration candidate(s) were excluded before scoring.`,
    ));
  }

  const first = candidates[0];
  if (!first || first.overlapArea <= 0) {
    diagnostics.push(diagnostic(
      'desktop.screen-region-binding.desktop-region',
      'warning',
      'The selected region did not confidently intersect a bindable window.',
    ));
    return unboundResult({
      ...base,
      bounds: screenBounds,
      bindingStatus: 'desktop-region',
      candidates: limitedCandidates,
      diagnostics: boundedDiagnostics(diagnostics, maxDiagnostics),
    });
  }

  const minOverlapRatio = positiveNumberOrDefault(input.minOverlapRatio, DEFAULT_MIN_OVERLAP_RATIO);
  if (!first.centerInside || first.overlapRatio < minOverlapRatio) {
    diagnostics.push(diagnostic(
      'desktop.screen-region-binding.low-confidence',
      'warning',
      'The best window candidate did not meet the center-point and overlap confidence rules.',
    ));
    return unboundResult({
      ...base,
      bounds: screenBounds,
      bindingStatus: 'low-confidence',
      candidates: limitedCandidates,
      diagnostics: boundedDiagnostics(diagnostics, maxDiagnostics),
    });
  }

  const second = candidates[1];
  const minScoreLeadRatio = positiveNumberOrDefault(input.minScoreLeadRatio, DEFAULT_MIN_SCORE_LEAD_RATIO);
  if (second && second.score > 0 && first.score < second.score * (1 + minScoreLeadRatio)) {
    diagnostics.push(diagnostic(
      'desktop.screen-region-binding.multi-window-conflict',
      'warning',
      'Two window candidates were too close to bind the selected region automatically.',
    ));
    return unboundResult({
      ...base,
      bounds: screenBounds,
      bindingStatus: 'multi-window-conflict',
      candidates: limitedCandidates,
      diagnostics: boundedDiagnostics(diagnostics, maxDiagnostics),
    });
  }

  diagnostics.push(diagnostic(
    'desktop.screen-region-binding.bound',
    'info',
    'The selected screen region was bound to one high-confidence window ref.',
    [first.windowRef],
  ));

  return {
    status: 'bound',
    bindingStatus: 'high-confidence',
    windowRef: first.windowRef,
    windowBounds: { ...first.bounds },
    bounds: screenBounds,
    screenId: base.screenId,
    scale: base.scale,
    diagnostics: boundedDiagnostics(diagnostics, maxDiagnostics),
    candidates: limitedCandidates,
  };
}

function filterWindowCandidate(
  window: ScreenRegionBindingWindowCandidate,
  options: {
    excludedOwnerIds: Set<string>;
    screenId?: string;
    minWindowWidth: number;
    minWindowHeight: number;
    minWindowArea: number;
  },
): string | undefined {
  if (window.excludeFromAutoBinding === true) return 'explicitly-excluded';
  if (ownerIsExcluded(window, options.excludedOwnerIds)) return 'owner-excluded';
  if (roleIsExcluded(window)) return 'role-excluded';
  if (window.visible === false || window.isVisible === false) return 'invisible';
  if (window.minimized === true || window.isMinimized === true) return 'minimized';
  if (options.screenId && textOrUndefined(window.screenId) && textOrUndefined(window.screenId) !== options.screenId) {
    return 'screen-mismatch';
  }
  const bounds = normalizeBounds(window.bounds);
  if (!bounds) return 'invalid-bounds';
  if (
    bounds.width < options.minWindowWidth
    || bounds.height < options.minWindowHeight
    || bounds.width * bounds.height < options.minWindowArea
  ) {
    return 'tiny-window';
  }
  return undefined;
}

function ownerIsExcluded(
  window: ScreenRegionBindingWindowCandidate,
  excludedOwnerIds: Set<string>,
): boolean {
  if (excludedOwnerIds.size === 0) return false;
  const candidateOwnerIds = [
    window.ownerId,
    window.appId,
    window.processId,
  ].map((value) => value === undefined ? undefined : String(value));
  return candidateOwnerIds.some((ownerId) => ownerId !== undefined && excludedOwnerIds.has(ownerId));
}

function roleIsExcluded(window: ScreenRegionBindingWindowCandidate): boolean {
  const role = textOrUndefined(window.role)?.toLowerCase();
  if (role && EXCLUDED_ROLES.has(role)) return true;
  const ownerName = textOrUndefined(window.ownerName)?.toLowerCase();
  const appName = textOrUndefined(window.appName)?.toLowerCase();
  return ownerName === 'dock' || appName === 'dock';
}

function scoreCandidate(options: {
  window: ScreenRegionBindingWindowCandidate;
  index: number;
  region: ScreenRegionBounds;
  bounds: ScreenRegionBounds;
}): ScoredCandidate {
  const center = {
    x: options.region.x + options.region.width / 2,
    y: options.region.y + options.region.height / 2,
  };
  const overlapArea = intersectionArea(options.region, options.bounds);
  const overlapRatio = roundMetric(overlapArea / area(options.region));
  const centerInside = pointInsideBounds(center, options.bounds);
  const score = centerInside ? overlapRatio : 0;
  return {
    windowRef: safeRef(options.window.windowRef ?? options.window.id, `desktop-window:candidate-${options.index + 1}`),
    ownerRef: safeRef(options.window.ownerId ?? options.window.appId ?? options.window.processId, ''),
    bounds: { ...options.bounds },
    screenId: textOrUndefined(options.window.screenId),
    scale: positiveNumberOrUndefined(options.window.scale),
    centerInside,
    overlapArea,
    overlapRatio,
    score,
  };
}

function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  return right.score - left.score
    || right.overlapRatio - left.overlapRatio
    || area(right.bounds) - area(left.bounds)
    || left.windowRef.localeCompare(right.windowRef);
}

function publicCandidateSummary(candidate: ScoredCandidate): ScreenRegionAutoBindingCandidateSummary {
  return {
    windowRef: candidate.windowRef,
    ...(candidate.ownerRef ? { ownerRef: candidate.ownerRef } : {}),
    bounds: { ...candidate.bounds },
    ...(candidate.screenId ? { screenId: candidate.screenId } : {}),
    ...(candidate.scale ? { scale: candidate.scale } : {}),
    centerInside: candidate.centerInside,
    overlapRatio: candidate.overlapRatio,
    score: candidate.score,
  };
}

function unboundResult(options: {
  bindingStatus: Exclude<ScreenRegionAutoBindingResult['bindingStatus'], 'high-confidence'>;
  bounds: ScreenRegionBounds;
  screenId?: string;
  scale?: number;
  diagnostics: ScreenRegionAutoBindingDiagnostic[];
  candidates: ScreenRegionAutoBindingCandidateSummary[];
}): ScreenRegionAutoBindingResult {
  return {
    status: 'unbound',
    bindingStatus: options.bindingStatus,
    bounds: options.bounds,
    screenId: options.screenId,
    scale: options.scale,
    diagnostics: options.diagnostics,
    candidates: options.candidates,
  };
}

function normalizeBounds(bounds: unknown): ScreenRegionBounds | null {
  if (!bounds || typeof bounds !== 'object') return null;
  const candidate = bounds as ScreenRegionBounds;
  if (
    !Number.isFinite(candidate.x)
    || !Number.isFinite(candidate.y)
    || !Number.isFinite(candidate.width)
    || !Number.isFinite(candidate.height)
    || candidate.width <= 0
    || candidate.height <= 0
  ) {
    return null;
  }
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
}

function fallbackBounds(bounds: unknown): ScreenRegionBounds {
  if (!bounds || typeof bounds !== 'object') return { x: 0, y: 0, width: 0, height: 0 };
  const candidate = bounds as Partial<ScreenRegionBounds>;
  return {
    x: finiteOrZero(candidate.x),
    y: finiteOrZero(candidate.y),
    width: finiteOrZero(candidate.width),
    height: finiteOrZero(candidate.height),
  };
}

function intersectionArea(left: ScreenRegionBounds, right: ScreenRegionBounds): number {
  const xOverlap = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const yOverlap = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return xOverlap * yOverlap;
}

function pointInsideBounds(point: { x: number; y: number }, bounds: ScreenRegionBounds): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function area(bounds: ScreenRegionBounds): number {
  return bounds.width * bounds.height;
}

function diagnostic(
  code: string,
  level: ScreenRegionAutoBindingDiagnostic['level'],
  message: string,
  refs?: string[],
): ScreenRegionAutoBindingDiagnostic {
  return {
    code,
    level,
    message,
    ...(refs && refs.length > 0 ? { refs } : {}),
  };
}

function boundedDiagnostics(
  diagnostics: ScreenRegionAutoBindingDiagnostic[],
  maxDiagnostics: number,
): ScreenRegionAutoBindingDiagnostic[] {
  return diagnostics.slice(0, maxDiagnostics).map((item) => ({
    code: item.code.slice(0, 160),
    level: item.level,
    message: item.message.slice(0, DIAGNOSTIC_MESSAGE_LIMIT),
    ...(item.refs ? { refs: item.refs.map((ref) => safeRef(ref, '')).filter(Boolean).slice(0, 4) } : {}),
  }));
}

function isPermissionFailure(status: ScreenRegionBindingPermissionStatus | undefined): boolean {
  return status === 'denied' || status === 'restricted' || status === 'unavailable';
}

function safeRef(value: unknown, fallback: string): string {
  const text = typeof value === 'number' ? String(value) : textOrUndefined(value);
  if (!text) return fallback;
  const trimmed = text.trim();
  if (/data:|base64|<|>|api[-_]?key|secret|token/i.test(trimmed)) return fallback;
  return trimmed.replace(/[^A-Za-z0-9._:/-]+/g, '-').slice(0, 240) || fallback;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function positiveNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveNumberOrDefault(value: unknown, fallback: number): number {
  return positiveNumberOrUndefined(value) ?? fallback;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
