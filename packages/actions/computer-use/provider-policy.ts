export type ComputerUseCaptureScope = 'display' | 'window' | 'focus-region';

export const computerUseCaptureProviderIds = {
  dryRunDisplayPng: 'dry-run-display-png',
  dryRunWindowPng: 'dry-run-window-png',
  dryRunFocusRegionCopy: 'dry-run-focus-region-copy',
  macosDisplayCapture: 'macos-screencapture-display',
  macosWindowCapture: 'macos-screencapture-window',
  sipsFocusRegionCrop: 'sips-focus-region-crop',
} as const;

export const computerUseCaptureDiagnostics = {
  displayProviderResult: {
    code: 'capture.display.provider-result',
  },
  focusRegionFallbackCopy: {
    code: 'capture.focus-region.fallback-copy',
    message: 'Focus crop provider failed; copied source screenshot so the trace still has a file ref for verifier memory.',
  },
  focusRegionProviderResult: {
    code: 'capture.focus-region.provider-result',
  },
  windowProviderResult: {
    code: 'capture.window.provider-result',
  },
  windowUnsupportedProvider: {
    code: 'capture.window.unsupported-provider',
    message: 'Target-window screenshot capture is not available for the configured desktop platform/provider.',
    stderr: 'Target-window capture requires a macOS screencapture-compatible windowId provider for the configured desktop platform.',
  },
} as const;

export function computerUseCaptureProviderName(options: {
  desktopPlatform: string;
  captureScope: Extract<ComputerUseCaptureScope, 'display' | 'window'>;
}) {
  if (isDarwinPlatform(options.desktopPlatform)) {
    return options.captureScope === 'window'
      ? computerUseCaptureProviderIds.macosWindowCapture
      : computerUseCaptureProviderIds.macosDisplayCapture;
  }
  return `${options.desktopPlatform}-${options.captureScope}-capture-provider`;
}

export function computerUseWindowCaptureProvider(options: {
  desktopPlatform: string;
  dryRun?: boolean;
  windowId?: number;
}) {
  if (options.dryRun) return computerUseCaptureProviderIds.dryRunWindowPng;
  if (isDarwinPlatform(options.desktopPlatform) && options.windowId !== undefined) {
    return computerUseCaptureProviderIds.macosWindowCapture;
  }
  return `${options.desktopPlatform || 'unknown'}-window-provider-unavailable`;
}

function isDarwinPlatform(value: string | undefined) {
  return (value || '').toLowerCase() === 'darwin' || (value || '').toLowerCase() === 'macos';
}
