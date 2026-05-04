import { isRecord, toStringList } from '../gateway-utils.js';
import type { ComputerUseConfig, GenericActionMetadata, GenericVisionAction } from './types.js';
import { isDarwinPlatform, isWindowsPlatform, numberConfig, parseJson, stringConfig } from './utils.js';

export function parseGenericActions(value: unknown): GenericVisionAction[] {
  const parsed = typeof value === 'string'
    ? parseJson(value)
    : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeGenericAction).filter((action): action is GenericVisionAction => Boolean(action));
}

export function platformActionIssue(action: GenericVisionAction, config: ComputerUseConfig) {
  if (!isDarwinPlatform(config.desktopPlatform)) return '';
  if (action.type === 'press_key' && isWindowsOnlyKey(action.key)) {
    return `VisionPlanner emitted Windows-only key "${action.key}" for desktopPlatform="${config.desktopPlatform}".`;
  }
  if (action.type === 'hotkey') {
    const badKey = action.keys.find(isWindowsOnlyKey);
    if (badKey) return `VisionPlanner emitted Windows-only hotkey modifier "${badKey}" for desktopPlatform="${config.desktopPlatform}".`;
  }
  return '';
}

export function platformLauncherGuidance(platform: string) {
  if (isDarwinPlatform(platform)) {
    return 'For app launch on this configured platform, prefer open_app with appName. If open_app is unavailable for the configured executor, use command+space, type_text for the app name, then press_key Enter, or click a visibly present low-risk target.';
  }
  if (isWindowsPlatform(platform)) {
    return 'For app launch on this configured platform, prefer open_app with appName when the executor supports it; otherwise use a visible launcher/search control or a platform-compatible hotkey, then type_text for the app name and press_key Enter.';
  }
  return 'For app launch on this configured platform, prefer open_app with appName when the executor supports it; otherwise use a visible launcher/search control or platform-compatible keyboard flow, then type_text for the app name and press_key Enter.';
}

export function trimLeadingWaitActions(actions: GenericVisionAction[], done: boolean) {
  if (done) return actions;
  const firstNonWait = actions.findIndex((action) => action.type !== 'wait');
  return firstNonWait > 0 ? actions.slice(firstNonWait) : actions;
}

export function highRiskBlockReason(action: GenericVisionAction, config: ComputerUseConfig) {
  if (config.allowHighRiskActions) return '';
  if (action.requiresConfirmation || action.riskLevel === 'high') {
    return [
      'High-risk Computer Use action blocked before execution.',
      `Action type=${action.type}${action.targetDescription ? ` target="${action.targetDescription}"` : ''}.`,
      'Set an explicit upstream confirmation and SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS=1 only for trusted runs.',
    ].join(' ');
  }
  return '';
}

export function groundingForAction(action: GenericVisionAction): Record<string, unknown> | undefined {
  const grounding = action.grounding && isRecord(action.grounding) ? action.grounding : {};
  if (action.type === 'click' || action.type === 'double_click') {
    return {
      status: 'provided',
      targetDescription: action.targetDescription,
      x: action.x,
      y: action.y,
      ...grounding,
    };
  }
  if (action.type === 'drag') {
    return {
      status: 'provided',
      targetDescription: action.targetDescription,
      fromX: action.fromX,
      fromY: action.fromY,
      toX: action.toX,
      toY: action.toY,
      ...grounding,
    };
  }
  if (action.targetDescription || Object.keys(grounding).length) {
    return {
      status: 'provided',
      targetDescription: action.targetDescription,
      ...grounding,
    };
  }
  return undefined;
}

function isWindowsOnlyKey(key: string) {
  return /^(win|windows|super|meta|start|search)$/i.test(key.trim());
}

function normalizeGenericAction(value: unknown): GenericVisionAction | undefined {
  if (!isRecord(value)) return undefined;
  const rawType = stringConfig(value.type, value.actionType, value.action, value.kind);
  if (!rawType) return undefined;
  const type = normalizeActionType(rawType);
  const metadata = genericActionMetadata(value);
  if (type === 'click' || type === 'double_click') {
    const x = numberConfig(value.x);
    const y = numberConfig(value.y);
    return x === undefined || y === undefined ? { type, ...metadata } : { type, x, y, ...metadata };
  }
  if (type === 'drag') {
    const fromX = numberConfig(value.fromX);
    const fromY = numberConfig(value.fromY);
    const toX = numberConfig(value.toX);
    const toY = numberConfig(value.toY);
    return [fromX, fromY, toX, toY].some((item) => item === undefined)
      ? {
          type,
          fromTargetDescription: stringConfig(value.fromTargetDescription, value.from_target_description, value.sourceDescription, value.source_description, value.fromTarget, value.source, value.targetDescription, value.target_description, value.target),
          toTargetDescription: stringConfig(value.toTargetDescription, value.to_target_description, value.destinationDescription, value.destination_description, value.targetDescription, value.target_description, value.toTarget, value.destination),
          ...metadata,
        }
      : { type, fromX: fromX as number, fromY: fromY as number, toX: toX as number, toY: toY as number, ...metadata };
  }
  if (type === 'type_text') return typeof value.text === 'string' ? { type, text: value.text, ...metadata } : undefined;
  if (type === 'press_key') {
    const key = stringConfig(value.key, value.keyName);
    return key ? { type, key, ...metadata } : undefined;
  }
  if (type === 'hotkey') {
    const keys = parseHotkeyKeys(value.keys, value.hotkey, value.shortcut, value.keyCombo, value.key_combo);
    return keys.length ? { type, keys, ...metadata } : undefined;
  }
  if (type === 'scroll') {
    const direction = normalizeScrollDirection(value);
    const amount = numberConfig(value.amount, value.scrollAmount, value.scroll_amount, value.delta, value.wheelDelta, value.wheel_delta);
    return direction ? { type, direction, amount, ...metadata } : undefined;
  }
  if (type === 'open_app') {
    const appName = stringConfig(value.appName, value.app_name, value.application, value.applicationName, value.name, value.target);
    return appName ? { type, appName, ...metadata } : undefined;
  }
  if (type === 'wait') return { type, ms: numberConfig(value.ms, value.durationMs, value.duration, value.amount), ...metadata };
  return undefined;
}

function genericActionMetadata(value: Record<string, unknown>): GenericActionMetadata {
  const riskLevel = value.riskLevel === 'low' || value.riskLevel === 'medium' || value.riskLevel === 'high'
    ? value.riskLevel
    : undefined;
  const requiresConfirmation = typeof value.requiresConfirmation === 'boolean' ? value.requiresConfirmation : undefined;
  return {
    targetDescription: stringConfig(value.targetDescription, value.target_description, value.target, value.description),
    grounding: isRecord(value.grounding) ? value.grounding : undefined,
    riskLevel,
    requiresConfirmation,
    confirmationText: stringConfig(value.confirmationText, value.confirmation_text),
  };
}

function normalizeActionType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'doubleclick') return 'double_click';
  if (normalized === 'type' || normalized === 'input_text') return 'type_text';
  if (normalized === 'keypress') return 'press_key';
  if (normalized === 'openapp' || normalized === 'launch_app' || normalized === 'launchapp' || normalized === 'open_application') return 'open_app';
  return normalized;
}

function parseHotkeyKeys(...values: unknown[]) {
  for (const value of values) {
    const listed = toStringList(value);
    if (listed.length) return listed;
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(/[+,\s]+/g)
        .map((key) => key.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function normalizeScrollDirection(value: Record<string, unknown>): 'up' | 'down' | 'left' | 'right' | undefined {
  if (value.direction === 'up' || value.direction === 'down' || value.direction === 'left' || value.direction === 'right') {
    return value.direction;
  }
  const amount = numberConfig(value.scrollAmount, value.scroll_amount, value.delta, value.wheelDelta, value.wheel_delta);
  if (amount === undefined || amount === 0) return undefined;
  return amount < 0 ? 'up' : 'down';
}
