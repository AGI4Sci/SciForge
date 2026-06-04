import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile as readNodeFile, rm, unlink as unlinkNodeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  createWindowActionSession,
  type WindowActionAppInfo,
  type WindowActionProcessInfo,
  type WindowActionSession,
} from '../runtime/window-action-session.js';

export const DESKTOP_WINDOW_CAPTURE_SCHEMA = 'sciforge.desktop.window-capture.v1' as const;
export const MACOS_SCREENCAPTUREKIT_PROVIDER_ID = 'macos-screencapturekit-window-region' as const;
export const MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID = 'macos-screencapture-window-region-fallback' as const;

const execFileAsync = promisify(execFile);
const MAX_MACOS_SCREENCAPTURE_COORDINATE = 1_000_000;
const MAX_MACOS_WINDOW_ID = 0xffffffff;

export type DesktopWindowCaptureBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopWindowCaptureSelection =
  | {
    kind: 'window';
    selectionSource: 'user';
    windowRef: string;
    process?: WindowActionProcessInfo;
    app?: WindowActionAppInfo;
    screenId: string;
    bounds: DesktopWindowCaptureBounds;
    scale: number;
  }
  | {
    kind: 'region';
    selectionSource: 'user';
    regionRef: string;
    screenId: string;
    bounds: DesktopWindowCaptureBounds;
    scale: number;
  };

export type DesktopWindowCaptureRequest = {
  workspaceId: string;
  sessionId: string;
  selection?: DesktopWindowCaptureSelection;
};

export type DesktopWindowCaptureDiagnostic = {
  code: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  refs?: string[];
  providerId?: string;
};

export type DesktopWindowCaptureProviderRequest = {
  workspaceId: string;
  sessionId: string;
  selection: DesktopWindowCaptureSelection;
  requestedAt: string;
};

export type DesktopWindowCaptureProviderResult = {
  captureRef?: string;
  imageRef?: string;
  capturedAt?: string;
  hash?: string;
  bytes?: ArrayBuffer | ArrayBufferView;
  diagnostics?: DesktopWindowCaptureDiagnostic[];
};

export type DesktopWindowCaptureProviderAvailabilityContext = {
  platform: string;
};

export type DesktopWindowCaptureProvider = {
  providerId: string;
  priority: number;
  supportedPlatforms?: string[];
  isAvailable(context: DesktopWindowCaptureProviderAvailabilityContext): boolean | Promise<boolean>;
  captureSelectedTarget(input: DesktopWindowCaptureProviderRequest): Promise<DesktopWindowCaptureProviderResult>;
};

export type DesktopWindowCaptureProviderAdapter = {
  isAvailable?(context: DesktopWindowCaptureProviderAvailabilityContext): boolean | Promise<boolean>;
  captureSelectedTarget?(input: DesktopWindowCaptureProviderRequest): Promise<DesktopWindowCaptureProviderResult>;
};

export type MacOSScreencaptureFallbackCommandRunner = {
  execFile(
    command: string,
    args: string[],
    options?: { timeout?: number },
  ): Promise<{ stdout?: string | Buffer; stderr?: string | Buffer }>;
};

export type MacOSScreencaptureFallbackTempFile = {
  path: string;
  cleanup?: () => void | Promise<void>;
};

export type MacOSScreencaptureFallbackDesktopWindowCaptureProviderOptions = {
  adapter?: DesktopWindowCaptureProviderAdapter;
  commandExists?: (command: string) => boolean | Promise<boolean>;
  runner?: MacOSScreencaptureFallbackCommandRunner;
  createTempFile?: () => MacOSScreencaptureFallbackTempFile | Promise<MacOSScreencaptureFallbackTempFile>;
  readFile?: (path: string) => ArrayBuffer | ArrayBufferView | Promise<ArrayBuffer | ArrayBufferView>;
  unlink?: (path: string) => void | Promise<void>;
  timeoutMs?: number;
};

export type DesktopWindowCapturePrivacy = {
  refsOnly: true;
  explicitSelectionRequired: true;
  explicitSelection: boolean;
  defaultAmbientCaptureBlocked: true;
  unrelatedRegionsIncluded: false;
  rawPayloadReturned: false;
  includedRefScope: 'selected-window-only' | 'selected-region-only' | 'none';
};

export type DesktopWindowCaptureResult = {
  schemaVersion: typeof DESKTOP_WINDOW_CAPTURE_SCHEMA;
  status: 'captured' | 'blocked';
  captureRef: string | null;
  imageRef: string | null;
  targetRef: string | null;
  windowRef: string | null;
  regionRef: string | null;
  screenId: string | null;
  bounds: DesktopWindowCaptureBounds | null;
  scale: number | null;
  capturedAt: string | null;
  captureTime: string | null;
  hash: string | null;
  providerId: string | null;
  windowActionSessionRef: string | null;
  windowActionSession: WindowActionSession | null;
  privacy: DesktopWindowCapturePrivacy;
  diagnostics: DesktopWindowCaptureDiagnostic[];
};

export type SelectDesktopWindowCaptureProviderOptions = {
  platform?: string;
  providers: DesktopWindowCaptureProvider[];
};

export type CaptureSelectedDesktopWindowTargetOptions = {
  platform?: string;
  providers?: DesktopWindowCaptureProvider[];
  now?: () => string;
  createWindowActionSession?: boolean;
};

export async function selectDesktopWindowCaptureProvider(
  options: SelectDesktopWindowCaptureProviderOptions,
): Promise<DesktopWindowCaptureProvider | null> {
  const platform = options.platform ?? process.platform;
  const candidates = [...options.providers]
    .filter((provider) => providerSupportsPlatform(provider, platform))
    .sort((left, right) => (
      right.priority - left.priority
      || left.providerId.localeCompare(right.providerId)
    ));

  for (const provider of candidates) {
    try {
      if (await provider.isAvailable({ platform })) return provider;
    } catch {
      // Provider availability errors are treated as unavailable so selection remains fail-closed.
    }
  }

  return null;
}

export async function captureSelectedDesktopWindowTarget(
  request: DesktopWindowCaptureRequest,
  options: CaptureSelectedDesktopWindowTargetOptions = {},
): Promise<DesktopWindowCaptureResult> {
  const requestedAt = options.now?.() ?? new Date().toISOString();
  const normalized = normalizeDesktopWindowCaptureRequest(request);
  if ('diagnostics' in normalized) {
    return blockedDesktopWindowCaptureResult({
      request,
      diagnostics: normalized.diagnostics,
    });
  }

  const platform = options.platform ?? process.platform;
  const providers = options.providers ?? createDefaultDesktopWindowCaptureProviders({ platform });
  const provider = await selectDesktopWindowCaptureProvider({ platform, providers });
  if (!provider) {
    return blockedDesktopWindowCaptureResult({
      request,
      selection: normalized.selection,
      diagnostics: [{
        code: 'desktop.window-capture.provider-unavailable',
        level: 'error',
        message: 'No available desktop window capture provider for the selected target.',
      }],
    });
  }

  let providerResult: DesktopWindowCaptureProviderResult;
  try {
    providerResult = await provider.captureSelectedTarget({
      workspaceId: normalized.workspaceId,
      sessionId: normalized.sessionId,
      selection: normalized.selection,
      requestedAt,
    });
  } catch (error) {
    const diagnostic = providerCaptureFailureDiagnostic(error, provider.providerId);
    return blockedDesktopWindowCaptureResult({
      request,
      selection: normalized.selection,
      providerId: provider.providerId,
      diagnostics: [diagnostic],
    });
  }

  const hash = normalizeHash(providerResult.hash) ?? hashProviderBytes(providerResult.bytes);
  if (!hash) {
    return blockedDesktopWindowCaptureResult({
      request,
      selection: normalized.selection,
      providerId: provider.providerId,
      diagnostics: [{
        code: 'desktop.window-capture.hash-required',
        level: 'error',
        message: 'Desktop window capture provider did not return a hash or bytes to hash.',
        providerId: provider.providerId,
      }],
    });
  }

  const capturedAt = textOrNull(providerResult.capturedAt) ?? requestedAt;
  const target = targetRefsForSelection(normalized.selection);
  const captureRef = boundedProviderResultRef(providerResult.captureRef, provider.providerId, normalized.selection.kind, 'capture')
    ?? defaultCaptureRef(normalized.workspaceId, normalized.sessionId, target.targetRef, hash);
  const imageRef = boundedProviderResultRef(providerResult.imageRef, provider.providerId, normalized.selection.kind, 'image') ?? `${captureRef}:image`;
  const windowActionSession = options.createWindowActionSession === false
    ? null
    : windowActionSessionForCapturedSelection(normalized.selection, {
      captureRef,
      imageRef,
      capturedAt,
    });

  return {
    schemaVersion: DESKTOP_WINDOW_CAPTURE_SCHEMA,
    status: 'captured',
    captureRef,
    imageRef,
    targetRef: target.targetRef,
    windowRef: target.windowRef,
    regionRef: target.regionRef,
    screenId: normalized.selection.screenId,
    bounds: { ...normalized.selection.bounds },
    scale: normalized.selection.scale,
    capturedAt,
    captureTime: capturedAt,
    hash,
    providerId: provider.providerId,
    windowActionSessionRef: windowActionSession ? `window-action-session:${windowActionSession.id}` : null,
    windowActionSession,
    privacy: privacyForSelection(normalized.selection),
    diagnostics: [
      {
        code: 'desktop.window-capture.captured',
        level: 'info',
        message: 'Captured selected desktop target as refs and metadata.',
        providerId: provider.providerId,
      },
      ...boundedDiagnostics(providerResult.diagnostics ?? [], provider.providerId),
    ],
  };
}

export function createDefaultDesktopWindowCaptureProviders(
  options: { platform?: string } = {},
): DesktopWindowCaptureProvider[] {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') return [];
  return [
    createMacOSScreenCaptureKitDesktopWindowCaptureProvider(),
    createMacOSScreencaptureFallbackDesktopWindowCaptureProvider(),
  ];
}

export function createMacOSScreenCaptureKitDesktopWindowCaptureProvider(
  adapter: DesktopWindowCaptureProviderAdapter = {},
): DesktopWindowCaptureProvider {
  return createAdapterBackedDesktopWindowCaptureProvider({
    providerId: MACOS_SCREENCAPTUREKIT_PROVIDER_ID,
    priority: 100,
    supportedPlatforms: ['darwin'],
    adapter,
  });
}

export function createMacOSScreencaptureFallbackDesktopWindowCaptureProvider(
  options: DesktopWindowCaptureProviderAdapter | MacOSScreencaptureFallbackDesktopWindowCaptureProviderOptions = {},
): DesktopWindowCaptureProvider {
  if (isDesktopWindowCaptureProviderAdapter(options)) {
    return createAdapterBackedDesktopWindowCaptureProvider({
      providerId: MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID,
      priority: 10,
      supportedPlatforms: ['darwin'],
      adapter: options,
    });
  }

  if (options.adapter) {
    return createAdapterBackedDesktopWindowCaptureProvider({
      providerId: MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID,
      priority: 10,
      supportedPlatforms: ['darwin'],
      adapter: options.adapter,
    });
  }

  return createMacOSScreencaptureFallbackProvider(options);
}

function createMacOSScreencaptureFallbackProvider(
  options: MacOSScreencaptureFallbackDesktopWindowCaptureProviderOptions,
): DesktopWindowCaptureProvider {
  const runner = options.runner ?? defaultMacOSScreencaptureFallbackCommandRunner;
  const commandExists = options.commandExists ?? ((command: string) => defaultCommandExists(command, runner));
  const createTempFile = options.createTempFile ?? createDefaultMacOSScreencaptureTempFile;
  const readFile = options.readFile ?? ((path: string) => readNodeFile(path));
  const unlink = options.unlink ?? ((path: string) => unlinkNodeFile(path));
  const timeoutMs = options.timeoutMs ?? 15000;

  return createAdapterBackedDesktopWindowCaptureProvider({
    providerId: MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID,
    priority: 10,
    supportedPlatforms: ['darwin'],
    adapter: {
      async isAvailable(context) {
        if (context.platform !== 'darwin') return false;
        try {
          return await commandExists('screencapture');
        } catch {
          return false;
        }
      },
      async captureSelectedTarget(input) {
        const args = macOSScreencaptureArgsForSelection(input.selection);
        const tempFile = await createTempFile();
        try {
          await runner.execFile('screencapture', [...args, tempFile.path], { timeout: timeoutMs });
          const bytes = await readFile(tempFile.path);
          if (byteLengthForHashableBytes(bytes) <= 0) {
            throw new DesktopWindowCaptureProviderDiagnosticError({
              code: 'desktop.window-capture.output-empty',
              message: 'macOS screencapture fallback produced an empty output file.',
            });
          }
          const hash = hashProviderBytes(bytes);
          if (!hash) {
            throw new DesktopWindowCaptureProviderDiagnosticError({
              code: 'desktop.window-capture.output-hash-failed',
              message: 'macOS screencapture fallback could not hash the output file.',
            });
          }
          return {
            captureRef: defaultProviderResultRef(MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID, input.selection.kind, 'capture'),
            imageRef: defaultProviderResultRef(MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID, input.selection.kind, 'image'),
            capturedAt: input.requestedAt,
            hash,
          };
        } finally {
          if (tempFile.cleanup) {
            await tempFile.cleanup();
          } else {
            await cleanupMacOSScreencaptureTempFile(tempFile.path, unlink);
          }
        }
      },
    },
  });
}

function createAdapterBackedDesktopWindowCaptureProvider(options: {
  providerId: string;
  priority: number;
  supportedPlatforms: string[];
  adapter: DesktopWindowCaptureProviderAdapter;
}): DesktopWindowCaptureProvider {
  return {
    providerId: options.providerId,
    priority: options.priority,
    supportedPlatforms: options.supportedPlatforms,
    async isAvailable(context) {
      return options.adapter.isAvailable?.(context) ?? false;
    },
    async captureSelectedTarget(input) {
      if (!options.adapter.captureSelectedTarget) {
        throw new Error(`${options.providerId} capture adapter is not configured`);
      }
      return await options.adapter.captureSelectedTarget(input);
    },
  };
}

function isDesktopWindowCaptureProviderAdapter(
  options: DesktopWindowCaptureProviderAdapter | MacOSScreencaptureFallbackDesktopWindowCaptureProviderOptions,
): options is DesktopWindowCaptureProviderAdapter {
  const adapter = options as DesktopWindowCaptureProviderAdapter;
  return typeof adapter.isAvailable === 'function' || typeof adapter.captureSelectedTarget === 'function';
}

const defaultMacOSScreencaptureFallbackCommandRunner: MacOSScreencaptureFallbackCommandRunner = {
  async execFile(command, args, options) {
    const result = await execFileAsync(command, args, options);
    return { stdout: result.stdout, stderr: result.stderr };
  },
};

async function defaultCommandExists(
  command: string,
  runner: MacOSScreencaptureFallbackCommandRunner,
): Promise<boolean> {
  try {
    await runner.execFile('which', [command], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function createDefaultMacOSScreencaptureTempFile(): Promise<MacOSScreencaptureFallbackTempFile> {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-window-capture-'));
  return {
    path: join(directory, 'capture.png'),
    cleanup: () => rm(directory, { force: true, recursive: true }),
  };
}

async function cleanupMacOSScreencaptureTempFile(
  path: string,
  unlink: (path: string) => void | Promise<void>,
) {
  try {
    await unlink(path);
  } catch {
    // Best-effort temp-file cleanup must not mask the capture result.
  }
}

function macOSScreencaptureArgsForSelection(selection: DesktopWindowCaptureSelection): string[] {
  if (selection.kind === 'region') {
    return ['-x', '-R', macOSScreencaptureRegionArgument(selection.bounds)];
  }

  const windowId = explicitMacOSWindowIdForSelection(selection);
  if (!windowId.id) {
    throw new DesktopWindowCaptureProviderDiagnosticError({
      code: windowId.reason === 'invalid'
        ? 'desktop.window-capture.window-id-invalid'
        : 'desktop.window-capture.window-id-required',
      message: windowId.reason === 'invalid'
        ? 'macOS screencapture fallback requires a positive bounded numeric window id.'
        : 'macOS screencapture fallback requires an explicit bounded numeric window id in selection metadata.',
    });
  }
  return ['-x', '-l', windowId.id];
}

function macOSScreencaptureRegionArgument(bounds: DesktopWindowCaptureBounds): string {
  const x = boundedRoundedCoordinate(bounds.x, 'x');
  const y = boundedRoundedCoordinate(bounds.y, 'y');
  const width = boundedRoundedCoordinate(bounds.width, 'width');
  const height = boundedRoundedCoordinate(bounds.height, 'height');
  if (width <= 0 || height <= 0) {
    throw new DesktopWindowCaptureProviderDiagnosticError({
      code: 'desktop.window-capture.region-bounds-invalid',
      message: 'macOS screencapture fallback requires rounded positive region width and height.',
    });
  }
  return `${x},${y},${width},${height}`;
}

function boundedRoundedCoordinate(value: number, name: string): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded) || Math.abs(rounded) > MAX_MACOS_SCREENCAPTURE_COORDINATE) {
    throw new DesktopWindowCaptureProviderDiagnosticError({
      code: 'desktop.window-capture.region-bounds-invalid',
      message: `macOS screencapture fallback received an out-of-range ${name} coordinate.`,
    });
  }
  return rounded;
}

function explicitMacOSWindowIdForSelection(selection: Extract<DesktopWindowCaptureSelection, { kind: 'window' }>): {
  id: string | null;
  reason?: 'missing' | 'invalid';
} {
  const rawSelection = selection as unknown as Record<string, unknown>;
  const candidates = [
    rawSelection.macosWindowId,
    rawSelection.cgWindowId,
    rawSelection.windowId,
    rawSelection.windowNumber,
    ...explicitMacOSWindowIdMetadataCandidates(rawSelection.metadata),
    ...explicitMacOSWindowIdMetadataCandidates(rawSelection.windowRefMetadata),
    ...explicitMacOSWindowIdMetadataCandidates(rawSelection.window),
    explicitMacOSWindowIdFromWindowRef(selection.windowRef),
  ];
  let sawExplicitCandidate = false;

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    sawExplicitCandidate = true;
    const id = safeMacOSWindowId(candidate);
    if (id) return { id };
  }

  return {
    id: null,
    reason: sawExplicitCandidate ? 'invalid' : 'missing',
  };
}

function explicitMacOSWindowIdMetadataCandidates(value: unknown): unknown[] {
  const metadata = recordOrNull(value);
  if (!metadata) return [];
  return [
    metadata.macosWindowId,
    metadata.cgWindowId,
    metadata.windowId,
    metadata.windowNumber,
  ];
}

function explicitMacOSWindowIdFromWindowRef(windowRef: string): string | undefined {
  const match = windowRef.match(/(?:^|:)(?:macos-window-id|macos-cg-window-id|cg-window-id|screencapture-window-id):([^:]+)(?:$|:)/iu);
  return match?.[1];
}

function safeMacOSWindowId(value: unknown): string | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/u.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > MAX_MACOS_WINDOW_ID) return null;
  return String(numeric);
}

function byteLengthForHashableBytes(bytes: ArrayBuffer | ArrayBufferView): number {
  return bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.byteLength;
}

class DesktopWindowCaptureProviderDiagnosticError extends Error {
  readonly code: string;

  readonly diagnostic: DesktopWindowCaptureDiagnostic;

  constructor(diagnostic: Pick<DesktopWindowCaptureDiagnostic, 'code' | 'message'>) {
    super(diagnostic.message);
    this.name = 'DesktopWindowCaptureProviderDiagnosticError';
    Object.setPrototypeOf(this, DesktopWindowCaptureProviderDiagnosticError.prototype);
    this.code = diagnostic.code;
    this.diagnostic = {
      code: diagnostic.code,
      level: 'error',
      message: diagnostic.message,
    };
  }
}

function normalizeDesktopWindowCaptureRequest(request: DesktopWindowCaptureRequest):
  | { workspaceId: string; sessionId: string; selection: DesktopWindowCaptureSelection }
  | { diagnostics: DesktopWindowCaptureDiagnostic[] } {
  const workspaceId = textOrNull(request.workspaceId);
  const sessionId = textOrNull(request.sessionId);
  if (!workspaceId || !sessionId) {
    return {
      diagnostics: [{
        code: 'desktop.window-capture.owner-required',
        level: 'error',
        message: 'Desktop window capture requires workspaceId and sessionId ownership.',
      }],
    };
  }

  if (!request.selection) {
    return {
      diagnostics: [{
        code: 'desktop.window-capture.selection-required',
        level: 'error',
        message: 'Desktop window capture requires an explicit user-selected window or region.',
      }],
    };
  }

  const selectionIssue = validateSelection(request.selection);
  if (selectionIssue) {
    return {
      diagnostics: [selectionIssue],
    };
  }

  return {
    workspaceId,
    sessionId,
    selection: {
      ...request.selection,
      bounds: { ...request.selection.bounds },
    },
  };
}

function validateSelection(selection: DesktopWindowCaptureSelection): DesktopWindowCaptureDiagnostic | undefined {
  const rawSelection = selection as DesktopWindowCaptureSelection & {
    kind?: unknown;
    selectionSource?: unknown;
    bounds?: unknown;
    scale?: unknown;
  };
  if (rawSelection.kind !== 'window' && rawSelection.kind !== 'region') {
    return {
      code: 'desktop.window-capture.selection-kind-invalid',
      level: 'error',
      message: 'Desktop window capture selection kind must be an explicit window or region; display fallback is ambient capture.',
    };
  }
  if (rawSelection.selectionSource !== 'user') {
    return {
      code: 'desktop.window-capture.user-selection-required',
      level: 'error',
      message: 'Desktop window capture selection must come from an explicit user-selected window or region.',
    };
  }
  if (selection.kind === 'window' && !textOrNull(selection.windowRef)) {
    return {
      code: 'desktop.window-capture.window-ref-required',
      level: 'error',
      message: 'Window capture requires a selected windowRef.',
    };
  }
  if (selection.kind === 'region' && !textOrNull(selection.regionRef)) {
    return {
      code: 'desktop.window-capture.region-ref-required',
      level: 'error',
      message: 'Region capture requires a selected regionRef.',
    };
  }
  if (!textOrNull(selection.screenId)) {
    return {
      code: 'desktop.window-capture.screen-id-required',
      level: 'error',
      message: 'Desktop window capture selection requires screenId.',
    };
  }
  if (!validBounds(rawSelection.bounds)) {
    return {
      code: 'desktop.window-capture.bounds-invalid',
      level: 'error',
      message: 'Desktop window capture selection requires finite positive bounds.',
    };
  }
  if (!Number.isFinite(rawSelection.scale) || rawSelection.scale <= 0) {
    return {
      code: 'desktop.window-capture.scale-invalid',
      level: 'error',
      message: 'Desktop window capture selection requires a positive scale.',
    };
  }
  return undefined;
}

function blockedDesktopWindowCaptureResult(options: {
  request: DesktopWindowCaptureRequest;
  selection?: DesktopWindowCaptureSelection;
  providerId?: string;
  diagnostics: DesktopWindowCaptureDiagnostic[];
}): DesktopWindowCaptureResult {
  const selection = options.selection ?? options.request.selection;
  const includeSelectionScope = Boolean(selection && blockedSelectionHasExplicitScope(selection, options.diagnostics));
  const target = includeSelectionScope ? targetRefsForSelection(selection as DesktopWindowCaptureSelection) : {
    targetRef: null,
    windowRef: null,
    regionRef: null,
  };
  return {
    schemaVersion: DESKTOP_WINDOW_CAPTURE_SCHEMA,
    status: 'blocked',
    captureRef: null,
    imageRef: null,
    targetRef: target.targetRef,
    windowRef: target.windowRef,
    regionRef: target.regionRef,
    screenId: includeSelectionScope ? selection?.screenId ?? null : null,
    bounds: includeSelectionScope && selection?.bounds ? { ...selection.bounds } : null,
    scale: includeSelectionScope ? selection?.scale ?? null : null,
    capturedAt: null,
    captureTime: null,
    hash: null,
    providerId: options.providerId ?? null,
    windowActionSessionRef: null,
    windowActionSession: null,
    privacy: includeSelectionScope ? privacyForSelection(selection as DesktopWindowCaptureSelection) : privacyForNoSelection(),
    diagnostics: options.diagnostics,
  };
}

function providerSupportsPlatform(provider: DesktopWindowCaptureProvider, platform: string): boolean {
  return !provider.supportedPlatforms || provider.supportedPlatforms.includes(platform);
}

function validBounds(bounds: DesktopWindowCaptureBounds): boolean {
  return Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0;
}

function privacyForSelection(selection: DesktopWindowCaptureSelection): DesktopWindowCapturePrivacy {
  return {
    refsOnly: true,
    explicitSelectionRequired: true,
    explicitSelection: true,
    defaultAmbientCaptureBlocked: true,
    unrelatedRegionsIncluded: false,
    rawPayloadReturned: false,
    includedRefScope: selection.kind === 'window' ? 'selected-window-only' : 'selected-region-only',
  };
}

function privacyForNoSelection(): DesktopWindowCapturePrivacy {
  return {
    refsOnly: true,
    explicitSelectionRequired: true,
    explicitSelection: false,
    defaultAmbientCaptureBlocked: true,
    unrelatedRegionsIncluded: false,
    rawPayloadReturned: false,
    includedRefScope: 'none',
  };
}

function targetRefsForSelection(selection: DesktopWindowCaptureSelection): {
  targetRef: string;
  windowRef: string | null;
  regionRef: string | null;
} {
  return selection.kind === 'window'
    ? {
      targetRef: selection.windowRef,
      windowRef: selection.windowRef,
      regionRef: null,
    }
    : {
      targetRef: selection.regionRef,
      windowRef: null,
      regionRef: selection.regionRef,
    };
}

function windowActionSessionForCapturedSelection(
  selection: DesktopWindowCaptureSelection,
  options: { captureRef: string; imageRef: string; capturedAt: string },
) {
  if (selection.kind !== 'window') return null;
  return createWindowActionSession({
    windowRef: selection.windowRef,
    process: selection.process,
    app: selection.app,
    bounds: selection.bounds,
    scale: selection.scale,
    screenId: selection.screenId,
    evidenceRefs: [
      { kind: 'capture', ref: options.captureRef },
      { kind: 'image', ref: options.imageRef },
    ],
    timestamp: options.capturedAt,
  });
}

function hashProviderBytes(bytes: DesktopWindowCaptureProviderResult['bytes']): string | null {
  if (!bytes) return null;
  const data = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function normalizeHash(hash: string | undefined): string | null {
  const value = textOrNull(hash);
  if (!value) return null;
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

function providerCaptureFailureDiagnostic(
  error: unknown,
  providerId: string,
): DesktopWindowCaptureDiagnostic {
  const errorRecord = recordOrNull(error);
  const providerDiagnostic = error instanceof DesktopWindowCaptureProviderDiagnosticError
    ? error.diagnostic
    : errorRecord?.diagnostic;
  if (isDesktopWindowCaptureDiagnostic(providerDiagnostic)) {
    return boundedDiagnostics([providerDiagnostic], providerId)[0];
  }
  const providerCode = textOrNull(errorRecord?.code);
  const providerMessage = textOrNull(errorRecord?.message);
  if (providerCode && providerMessage) {
    return boundedDiagnostics([{
      code: providerCode,
      level: 'error',
      message: providerMessage,
      providerId,
    }], providerId)[0];
  }
  return boundedDiagnostics([{
    code: 'desktop.window-capture.provider-capture-failed',
    level: 'error',
    message: error instanceof Error ? error.message : 'Desktop window capture provider failed.',
    providerId,
  }], providerId)[0];
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isDesktopWindowCaptureDiagnostic(value: unknown): value is DesktopWindowCaptureDiagnostic {
  const diagnostic = recordOrNull(value);
  return Boolean(
    diagnostic
      && typeof diagnostic.code === 'string'
      && (diagnostic.level === 'info' || diagnostic.level === 'warning' || diagnostic.level === 'error')
      && typeof diagnostic.message === 'string',
  );
}

function defaultCaptureRef(workspaceId: string, sessionId: string, targetRef: string, hash: string): string {
  const hashSuffix = hash.replace(/^sha256:/, '').slice(0, 16);
  return [
    'desktop-window-capture',
    sanitizeRefSegment(workspaceId),
    sanitizeRefSegment(sessionId),
    sanitizeRefSegment(targetRef),
    hashSuffix,
  ].join(':');
}

function boundedProviderResultRef(
  value: unknown,
  providerId: string,
  selectionKind: DesktopWindowCaptureSelection['kind'],
  refKind: 'capture' | 'image',
): string | null {
  const ref = textOrNull(value);
  if (!ref) return null;
  if (/^data:|^https?:|^file:|;base64|api[-_]?key|token=|secret/i.test(ref)) return null;
  if (ref.includes(providerId)) return defaultProviderResultRef(providerId, selectionKind, refKind);
  if (new RegExp(`^${refKind}:[a-z0-9._:-]+:${selectionKind}$`, 'i').test(ref)) return ref.slice(0, 240);
  return null;
}

function defaultProviderResultRef(
  providerId: string,
  selectionKind: DesktopWindowCaptureSelection['kind'],
  refKind: 'capture' | 'image',
): string {
  return `${refKind}:${publicDesktopWindowCaptureProviderId(providerId)}:${selectionKind}`;
}

function publicDesktopWindowCaptureProviderId(providerId: string): string {
  if (providerId === MACOS_SCREENCAPTUREKIT_PROVIDER_ID) return 'macos-screencapturekit';
  if (providerId === MACOS_SCREENCAPTURE_FALLBACK_PROVIDER_ID) return 'macos-screencapture';
  return sanitizeRefSegment(providerId);
}

function blockedSelectionHasExplicitScope(
  selection: unknown,
  diagnostics: DesktopWindowCaptureDiagnostic[],
): selection is DesktopWindowCaptureSelection {
  if (!selection || typeof selection !== 'object') return false;
  const invalidCodes = new Set([
    'desktop.window-capture.selection-required',
    'desktop.window-capture.selection-kind-invalid',
    'desktop.window-capture.user-selection-required',
  ]);
  return !diagnostics.some((diagnostic) => invalidCodes.has(diagnostic.code));
}

function sanitizeRefSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'ref';
}

function boundedDiagnostics(
  diagnostics: DesktopWindowCaptureDiagnostic[],
  providerId: string,
): DesktopWindowCaptureDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: textOrNull(diagnostic.code)?.slice(0, 160) ?? 'desktop.window-capture.provider-diagnostic',
    level: diagnostic.level,
    message: textOrNull(diagnostic.message)?.slice(0, 400) ?? 'Desktop window capture provider diagnostic.',
    ...(diagnostic.refs ? { refs: diagnostic.refs.filter((ref) => textOrNull(ref)).map((ref) => ref.slice(0, 240)) } : {}),
    providerId: diagnostic.providerId ?? providerId,
  }));
}
