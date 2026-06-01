import type { GenericVisionAction } from './computer-use/types.js';
import type {
  BrowserHostMouseButton,
  BrowserHostMousePoint,
  BrowserHostSessionActionInput,
  BrowserHostSessionCaptureMode,
  BrowserHostSessionManager,
  BrowserHostSessionState,
} from './browser-host-session.js';

export const BROWSER_HOST_COMPUTER_USE_SCHEMA = 'sciforge.browser-host-session.computer-use-action.v1' as const;
export const BROWSER_HOST_COMPUTER_USE_PROVIDER_ID = 'sciforge.browser-host-session.computer-use-adapter' as const;

export type BrowserHostLowLevelComputerUseAction =
  | { type: 'mouse_down'; x?: number; y?: number; button?: BrowserHostMouseButton; targetDescription?: string }
  | { type: 'mouse_move'; x?: number; y?: number; targetDescription?: string }
  | { type: 'mouse_up'; x?: number; y?: number; button?: BrowserHostMouseButton; targetDescription?: string }
  | { type: 'wheel'; deltaX?: number; deltaY?: number; targetDescription?: string }
  | { type: 'cursor'; x?: number; y?: number; targetDescription?: string };

export type BrowserHostComputerUseAction = GenericVisionAction | BrowserHostLowLevelComputerUseAction;

export interface BrowserHostComputerUseActionResult {
  schemaVersion: typeof BROWSER_HOST_COMPUTER_USE_SCHEMA;
  providerId: typeof BROWSER_HOST_COMPUTER_USE_PROVIDER_ID;
  inputChannel: 'browser-host-session';
  userDeviceImpact: 'none';
  sharedSystemInputUsed: false;
  systemMouseEvents: 'not-sent';
  systemKeyboardEvents: 'not-sent';
  liveBrowserOwner: 'BrowserHostSession';
  singleInteractiveTruth: true;
  hostAction: BrowserHostSessionActionInput;
  session: BrowserHostSessionState;
}

export function browserHostActionFromComputerUse(
  action: BrowserHostComputerUseAction,
  options: {
    capture?: BrowserHostSessionCaptureMode;
    timeoutMs?: number;
    actionId?: string;
    uiEventReceivedAt?: string;
    adapterSentAt?: string;
  } = {},
): BrowserHostSessionActionInput {
  if (action.type === 'click') {
    return {
      action: 'click',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'double_click') {
    return {
      action: 'double-click',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'drag') {
    const fromX = requiredBrowserHostCoordinate(action.fromX, 'fromX');
    const fromY = requiredBrowserHostCoordinate(action.fromY, 'fromY');
    const toX = requiredBrowserHostCoordinate(action.toX, 'toX');
    const toY = requiredBrowserHostCoordinate(action.toY, 'toY');
    return {
      action: 'drag',
      path: browserHostComputerUseDragPath({ x: fromX, y: fromY }, { x: toX, y: toY }),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'mouse_down') {
    return {
      action: 'mouse-down',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      button: browserHostComputerUseMouseButton(action.button),
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'mouse_move') {
    return {
      action: 'mouse-move',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'mouse_up') {
    return {
      action: 'mouse-up',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      button: browserHostComputerUseMouseButton(action.button),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'type_text') {
    return {
      action: 'type',
      text: action.text,
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'press_key') {
    return {
      action: 'press',
      key: browserHostComputerUseKey(action.key),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'hotkey') {
    return {
      action: 'press',
      key: action.keys.map(browserHostComputerUseKey).join('+'),
      capture: options.capture ?? 'frame',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'scroll') {
    const amount = Math.max(1, Math.round(action.amount ?? 720));
    return {
      action: 'scroll',
      deltaX: action.direction === 'left' ? -amount : action.direction === 'right' ? amount : 0,
      deltaY: action.direction === 'up' ? -amount : action.direction === 'down' ? amount : 0,
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'wheel') {
    return {
      action: 'scroll',
      deltaX: Math.round(action.deltaX ?? 0),
      deltaY: Math.round(action.deltaY ?? 0),
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'cursor') {
    return {
      action: 'cursor',
      x: requiredBrowserHostCoordinate(action.x, 'x'),
      y: requiredBrowserHostCoordinate(action.y, 'y'),
      capture: options.capture ?? 'none',
      timeoutMs: options.timeoutMs,
      ...browserHostActionTimingInput(options),
    };
  }
  if (action.type === 'wait') {
    return {
      action: 'state',
      capture: options.capture ?? 'frame',
      timeoutMs: Math.max(0, Math.round(action.ms ?? options.timeoutMs ?? 500)),
      ...browserHostActionTimingInput(options),
    };
  }
  throw new Error(`BrowserHostSession Computer Use action is unsupported: ${action.type}`);
}

export async function executeBrowserHostComputerUseAction(
  manager: BrowserHostSessionManager,
  workspacePath: string,
  sessionId: string,
  action: BrowserHostComputerUseAction,
  options: {
    capture?: BrowserHostSessionCaptureMode;
    timeoutMs?: number;
    actionId?: string;
    uiEventReceivedAt?: string;
    adapterSentAt?: string;
  } = {},
): Promise<BrowserHostComputerUseActionResult> {
  const hostAction = browserHostActionFromComputerUse(action, options);
  const session = await manager.act(workspacePath, sessionId, hostAction);
  return {
    schemaVersion: BROWSER_HOST_COMPUTER_USE_SCHEMA,
    providerId: BROWSER_HOST_COMPUTER_USE_PROVIDER_ID,
    inputChannel: 'browser-host-session',
    userDeviceImpact: 'none',
    sharedSystemInputUsed: false,
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
    liveBrowserOwner: 'BrowserHostSession',
    singleInteractiveTruth: true,
    hostAction,
    session,
  };
}

function browserHostActionTimingInput(options: {
  actionId?: string;
  uiEventReceivedAt?: string;
  adapterSentAt?: string;
}): Partial<Pick<BrowserHostSessionActionInput, 'actionId' | 'uiEventReceivedAt' | 'adapterSentAt'>> {
  const timing: Partial<Pick<BrowserHostSessionActionInput, 'actionId' | 'uiEventReceivedAt' | 'adapterSentAt'>> = {};
  if (options.actionId) timing.actionId = options.actionId;
  if (options.uiEventReceivedAt) timing.uiEventReceivedAt = options.uiEventReceivedAt;
  if (options.adapterSentAt) timing.adapterSentAt = options.adapterSentAt;
  return timing;
}

function browserHostComputerUseDragPath(from: BrowserHostMousePoint, to: BrowserHostMousePoint): BrowserHostMousePoint[] {
  const steps = 8;
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: Math.round(from.x + ((to.x - from.x) * index) / steps),
    y: Math.round(from.y + ((to.y - from.y) * index) / steps),
  }));
}

function requiredBrowserHostCoordinate(value: number | undefined, name: string) {
  if (!Number.isFinite(value)) throw new Error(`BrowserHostSession Computer Use action is missing ${name}.`);
  return Math.round(value as number);
}

function browserHostComputerUseKey(key: string) {
  const normalized = key.trim();
  if (/^(cmd|command|meta|super)$/i.test(normalized)) return 'Meta';
  if (/^(ctrl|control)$/i.test(normalized)) return 'Control';
  if (/^option$/i.test(normalized)) return 'Alt';
  if (/^return$/i.test(normalized)) return 'Enter';
  if (normalized === ' ') return 'Space';
  return normalized;
}

function browserHostComputerUseMouseButton(value: BrowserHostMouseButton | undefined): BrowserHostMouseButton {
  return value === 'right' || value === 'middle' ? value : 'left';
}
