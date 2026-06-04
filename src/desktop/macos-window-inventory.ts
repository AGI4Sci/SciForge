import {
  inventoryMacosCgWindows as defaultInventoryMacosCgWindows,
  probeMacosScreenRecording as defaultProbeMacosScreenRecording,
  type MacosCgWindowInventoryEntry,
} from '../runtime/computer-use/native-providers/macos-native-driver-helpers.js';
import type {
  ScreenRegionBindingPermissionStatus,
  ScreenRegionBindingWindowCandidate,
} from './screen-region-auto-binding.js';

export type DesktopAnnotationMacosWindowInventoryProbeResult = {
  ok: boolean;
  detail?: string;
};

export type DesktopAnnotationMacosWindowInventoryProviderOptions = {
  platform?: string;
  pids?: readonly number[];
  maxCandidates?: number;
  minWindowWidth?: number;
  minWindowHeight?: number;
  minWindowArea?: number;
  inventoryMacosCgWindows?: (pids: readonly number[]) => readonly MacosCgWindowInventoryEntry[];
  probeScreenRecording?: () => DesktopAnnotationMacosWindowInventoryProbeResult;
};

export type DesktopAnnotationMacosWindowInventoryProvider = {
  screenRegionBindingPermissionStatus(): ScreenRegionBindingPermissionStatus;
  screenRegionBindingWindows(): ScreenRegionBindingWindowCandidate[];
};

const DEFAULT_MAX_CANDIDATES = 80;
const DEFAULT_MIN_WINDOW_WIDTH = 32;
const DEFAULT_MIN_WINDOW_HEIGHT = 32;
const DEFAULT_MIN_WINDOW_AREA = 1600;
const TEXT_LIMIT = 160;

const EXCLUDED_OWNER_NAMES = new Set([
  'control center',
  'dock',
  'loginwindow',
  'notification center',
  'systemuiserver',
  'window server',
]);

export function createDesktopAnnotationMacosWindowInventoryProvider(
  options: DesktopAnnotationMacosWindowInventoryProviderOptions = {},
): DesktopAnnotationMacosWindowInventoryProvider {
  const platform = options.platform ?? process.platform;
  const inventory = options.inventoryMacosCgWindows
    ?? ((pids: readonly number[]) => defaultInventoryMacosCgWindows([...pids]));
  const probeScreenRecording = options.probeScreenRecording ?? defaultProbeMacosScreenRecording;

  function screenRegionBindingPermissionStatus(): ScreenRegionBindingPermissionStatus {
    if (platform !== 'darwin') return 'unavailable';
    try {
      return probeScreenRecording().ok ? 'granted' : 'denied';
    } catch {
      return 'unavailable';
    }
  }

  function screenRegionBindingWindows(): ScreenRegionBindingWindowCandidate[] {
    if (screenRegionBindingPermissionStatus() !== 'granted') return [];
    let windows: readonly MacosCgWindowInventoryEntry[];
    try {
      windows = inventory(options.pids ?? []);
    } catch {
      return [];
    }
    const minWindowWidth = positiveNumberOrDefault(options.minWindowWidth, DEFAULT_MIN_WINDOW_WIDTH);
    const minWindowHeight = positiveNumberOrDefault(options.minWindowHeight, DEFAULT_MIN_WINDOW_HEIGHT);
    const minWindowArea = positiveNumberOrDefault(options.minWindowArea, DEFAULT_MIN_WINDOW_AREA);
    return windows
      .flatMap((window) => macosCgWindowToBindingCandidate(window, {
        minWindowWidth,
        minWindowHeight,
        minWindowArea,
      }))
      .slice(0, positiveIntegerOrDefault(options.maxCandidates, DEFAULT_MAX_CANDIDATES));
  }

  return {
    screenRegionBindingPermissionStatus,
    screenRegionBindingWindows,
  };
}

function macosCgWindowToBindingCandidate(
  window: MacosCgWindowInventoryEntry,
  options: {
    minWindowWidth: number;
    minWindowHeight: number;
    minWindowArea: number;
  },
): ScreenRegionBindingWindowCandidate[] {
  if (!Number.isInteger(window.windowNumber) || window.windowNumber <= 0) return [];
  if (!Number.isInteger(window.pid) || window.pid <= 0) return [];
  if (window.layer !== 0) return [];
  const bounds = {
    x: finiteOrZero(window.x),
    y: finiteOrZero(window.y),
    width: finiteOrZero(window.width),
    height: finiteOrZero(window.height),
  };
  if (
    bounds.width < options.minWindowWidth
    || bounds.height < options.minWindowHeight
    || bounds.width * bounds.height < options.minWindowArea
  ) {
    return [];
  }
  if (ownerNameIsExcluded(window.ownerName)) return [];
  const appName = safeAppText(window.ownerName);
  const title = safeTitleText(window.title);
  return [{
    windowRef: `desktop-window:macos-cg-window-id:${window.windowNumber}:pid:${window.pid}`,
    id: window.windowNumber,
    ownerId: window.pid,
    processId: window.pid,
    pid: window.pid,
    windowNumber: window.windowNumber,
    cgWindowId: window.windowNumber,
    macosWindowId: window.windowNumber,
    appName,
    ownerName: appName,
    ...(title ? { title } : {}),
    role: 'app-window',
    visible: true,
    isVisible: true,
    minimized: false,
    isMinimized: false,
    bounds,
  }];
}

function ownerNameIsExcluded(value: unknown): boolean {
  const ownerName = safeAppText(value)?.toLowerCase();
  if (!ownerName) return true;
  return EXCLUDED_OWNER_NAMES.has(ownerName)
    || ownerName.includes('sciforge');
}

function safeAppText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || containsRawPayloadText(trimmed)) return undefined;
  return trimmed.slice(0, TEXT_LIMIT);
}

function safeTitleText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || containsSensitiveText(trimmed)) return undefined;
  return trimmed.slice(0, TEXT_LIMIT);
}

function containsSensitiveText(value: string): boolean {
  return /data:|base64|secret|token|api[-_\s]?key|password|passwd|bearer|<[^>]*>/i.test(value);
}

function containsRawPayloadText(value: string): boolean {
  return /data:|base64|<[^>]*>/i.test(value);
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function positiveNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
