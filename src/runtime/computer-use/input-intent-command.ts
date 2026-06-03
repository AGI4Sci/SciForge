import type { ComputerUseConfig, GenericActionMetadata, GenericVisionAction } from './types.js';

export const VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE = 'virtual-app-screen-canvas';
export const VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE = 'virtual-app-screen-control';
export const VIRTUAL_APP_SCREEN_INPUT_INTENT_SOURCE = VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE;
export const VIRTUAL_APP_SCREEN_INPUT_INTENT_COMPLETION_REASON = 'VirtualAppScreen InputIntent terminal-equivalent command';

export type VirtualScreenInputIntentSource =
  | typeof VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE
  | typeof VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE;

export type VirtualScreenInputIntentControlKind =
  | 'takeover'
  | 'pause-agent'
  | 'resume-agent'
  | 'stop-session';

export type VirtualScreenInputIntentCommandParseResult =
  | { kind: 'not-input-intent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'parsed'; command: VirtualScreenInputIntentCommand };

export type VirtualScreenInputIntentCommand =
  | VirtualScreenCanvasInputIntentCommand
  | VirtualScreenLeaseControlInputIntentCommand;

export interface VirtualScreenInputIntentCommandBase {
  source: VirtualScreenInputIntentSource;
  intentKind: string;
  refs: VirtualScreenInputIntentRefs;
  frame?: {
    width?: number;
    height?: number;
  };
  ratios: Record<string, number>;
}

export interface VirtualScreenCanvasInputIntentCommand extends VirtualScreenInputIntentCommandBase {
  source: typeof VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE;
  action: GenericVisionAction;
}

export interface VirtualScreenLeaseControlInputIntentCommand extends VirtualScreenInputIntentCommandBase {
  source: typeof VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE;
  controlKind: VirtualScreenInputIntentControlKind;
  action?: undefined;
}

export interface VirtualScreenInputIntentRefs {
  sessionRef: string;
  currentRunPointerRef?: string;
  frameRef?: string;
  inputLeaseRef: string;
  actionAdapterRef?: string;
  adapterReadinessRef?: string;
  screenRef?: string;
  targetAppRef?: string;
  targetWindowRef?: string;
  evidenceLedgerRef?: string;
  userLeaseRef?: string;
  agentLeaseRef?: string;
  activeLeaseOwnerRef?: string;
  activeLeaseOwnerRole?: string;
  leaseControlRef?: string;
}

type ParsedFlags = Map<string, string>;

const inputIntentPrefixPattern = /^\/(?:computer-use|computer\s+use)\s+input-intent\b/i;
const canvasRequiredRefFlags = [
  'session-ref',
  'frame-ref',
  'input-lease-ref',
  'action-adapter-ref',
  'adapter-readiness-ref',
] as const;

const controlRequiredRefFlags = [
  'session-ref',
  'input-lease-ref',
  'lease-control-ref',
] as const;

const canvasOptionalRefFlags = [
  'screen-ref',
  'target-app-ref',
  'target-window-ref',
  'evidence-ledger-ref',
  'current-run-pointer-ref',
] as const;

const controlOptionalRefFlags = [
  'screen-ref',
  'target-app-ref',
  'target-window-ref',
  'user-lease-ref',
  'agent-lease-ref',
  'active-lease-owner-ref',
  'action-adapter-ref',
  'adapter-readiness-ref',
  'evidence-ledger-ref',
  'current-run-pointer-ref',
] as const;

export function parseVirtualScreenInputIntentCommand(commandText: string): VirtualScreenInputIntentCommandParseResult {
  if (!inputIntentPrefixPattern.test(commandText.trim())) return { kind: 'not-input-intent' };

  const split = splitCommandLine(commandText);
  if ('reason' in split) return { kind: 'invalid', reason: split.reason };
  const tokens = split.tokens;
  const commandToken = tokens[0]?.toLowerCase();
  const subcommandToken = tokens[1]?.toLowerCase();
  const spacedUseToken = tokens[2]?.toLowerCase();
  const flagStartIndex = commandToken === '/computer-use' && subcommandToken === 'input-intent'
    ? 2
    : commandToken === '/computer' && subcommandToken === 'use' && spacedUseToken === 'input-intent'
      ? 3
      : -1;
  if (flagStartIndex < 0) {
    return { kind: 'invalid', reason: 'Malformed Computer Use InputIntent command.' };
  }

  const flags = parseFlags(tokens.slice(flagStartIndex));
  if ('reason' in flags) return { kind: 'invalid', reason: flags.reason };

  const source = flagValue(flags.flags, 'source');
  if (!isInputIntentSource(source)) {
    return { kind: 'invalid', reason: 'InputIntent source must be virtual-app-screen-canvas or virtual-app-screen-control.' };
  }

  const refsResult = parseRefs(flags.flags, source);
  if ('reason' in refsResult) return { kind: 'invalid', reason: refsResult.reason };

  const intentKind = flagValue(flags.flags, 'kind')?.trim();
  if (!intentKind) return { kind: 'invalid', reason: 'InputIntent kind is required.' };

  const frame = {
    width: positiveNumberFlag(flags.flags, 'frame-width'),
    height: positiveNumberFlag(flags.flags, 'frame-height'),
  };
  const ratios = ratioFlags(flags.flags);
  if (source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE) {
    const controlKind = normalizeControlKind(intentKind);
    if (!controlKind) {
      return { kind: 'invalid', reason: `Unsupported VirtualAppScreen lease control kind: ${intentKind}.` };
    }
    return {
      kind: 'parsed',
      command: {
        source,
        intentKind: controlKind,
        controlKind,
        refs: refsResult.refs,
        frame,
        ratios,
      },
    };
  }

  const actionResult = actionFromInputIntent({
    source,
    intentKind,
    flags: flags.flags,
    refs: refsResult.refs,
    frame,
    ratios,
  });
  if ('reason' in actionResult) return { kind: 'invalid', reason: actionResult.reason };

  return {
    kind: 'parsed',
    command: {
      source,
      intentKind,
      action: actionResult.action,
      refs: refsResult.refs,
      frame,
      ratios,
    },
  };
}

export function applyVirtualScreenInputIntentCommandToConfig(
  config: ComputerUseConfig,
  parsed: VirtualScreenInputIntentCommand,
): ComputerUseConfig {
  if (parsed.source !== VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE || !parsed.action) {
    throw new Error('VirtualAppScreen lease control InputIntent cannot be converted into a generic GUI action fixture.');
  }
  config.testActionFixtureMode = true;
  config.testOnlyPlannedActions = [parsed.action];
  config.maxSteps = 1;
  config.completionPolicy = {
    mode: 'one-successful-non-wait-action',
    reason: VIRTUAL_APP_SCREEN_INPUT_INTENT_COMPLETION_REASON,
  };
  return config;
}

export function virtualScreenInputIntentTraceDetail(parsed: VirtualScreenInputIntentCommand) {
  return {
    source: parsed.source,
    kind: parsed.intentKind,
    refs: parsed.refs,
    frame: parsed.frame,
    actionType: parsed.action?.type,
    controlKind: parsed.source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE ? parsed.controlKind : undefined,
    testActionFixtureMode: true,
    testOnlyPlannedActions: parsed.action ? 1 : 0,
    completionPolicy: parsed.action ? 'one-successful-non-wait-action' : undefined,
  };
}

function actionFromInputIntent(params: {
  source: typeof VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE;
  intentKind: string;
  flags: ParsedFlags;
  refs: VirtualScreenInputIntentRefs;
  frame: { width?: number; height?: number };
  ratios: Record<string, number>;
}): { action: GenericVisionAction } | { reason: string } {
  const kind = params.intentKind.trim().toLowerCase().replace(/[-\s]+/g, '_');
  const metadata = actionMetadata(params);

  if (kind === 'click' || kind === 'double_click') {
    const point = pointFromRatios(params, 'x-ratio', 'y-ratio');
    if ('reason' in point) return point;
    const clickCount = integerFlag(params.flags, 'click-count');
    const type = kind === 'double_click' || (clickCount !== undefined && clickCount > 1) ? 'double_click' : 'click';
    return { action: { type, x: point.x, y: point.y, ...metadata } };
  }

  if (kind === 'drag') {
    const from = pointFromRatios(params, 'start-x-ratio', 'start-y-ratio');
    if ('reason' in from) return from;
    const to = pointFromRatios(params, 'end-x-ratio', 'end-y-ratio');
    if ('reason' in to) return to;
    return { action: { type: 'drag', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, ...metadata } };
  }

  if (kind === 'scroll') {
    const deltaX = numberFlag(params.flags, 'delta-x') ?? 0;
    const deltaY = numberFlag(params.flags, 'delta-y') ?? 0;
    const direction = Math.abs(deltaX) > Math.abs(deltaY)
      ? (deltaX > 0 ? 'right' : 'left')
      : (deltaY > 0 ? 'down' : 'up');
    const magnitude = Math.max(1, Math.round(Math.max(Math.abs(deltaX), Math.abs(deltaY)) / 120));
    return { action: { type: 'scroll', direction, amount: magnitude, ...metadata } };
  }

  if (kind === 'type' || kind === 'type_text') {
    const text = flagValue(params.flags, 'text');
    if (!text) return { reason: 'Text InputIntent requires --text.' };
    return { action: { type: 'type_text', text, ...metadata } };
  }

  if (kind === 'hotkey') {
    const key = flagValue(params.flags, 'key');
    if (!key) return { reason: 'Hotkey InputIntent requires --key.' };
    const keys = key.split('+').map((part) => part.trim()).filter(Boolean);
    if (!keys.length) return { reason: 'Hotkey InputIntent requires at least one key.' };
    return keys.length === 1
      ? { action: { type: 'press_key', key: keys[0] as string, ...metadata } }
      : { action: { type: 'hotkey', keys, ...metadata } };
  }

  if (kind === 'press_key' || kind === 'key') {
    const key = flagValue(params.flags, 'key');
    if (!key) return { reason: 'Press key InputIntent requires --key.' };
    return { action: { type: 'press_key', key, ...metadata } };
  }

  if (kind === 'menu_command' || kind === 'open_menu') {
    const menuCommand = flagValue(params.flags, 'menu-command');
    if (!menuCommand) return { reason: 'Menu InputIntent requires --menu-command.' };
    return { action: { type: 'open_menu', menuName: menuCommand, ...metadata } };
  }

  return { reason: `Unsupported VirtualAppScreen InputIntent kind: ${params.intentKind}.` };
}

function actionMetadata(params: {
  source: VirtualScreenInputIntentSource;
  intentKind: string;
  refs: VirtualScreenInputIntentRefs;
  frame: { width?: number; height?: number };
  ratios: Record<string, number>;
}): GenericActionMetadata {
  return {
    targetDescription: 'VirtualAppScreen input intent',
    riskLevel: 'low',
    screenId: params.refs.screenRef,
    windowId: params.refs.targetWindowRef,
    grounding: {
      source: params.source,
      intentKind: params.intentKind,
      refs: params.refs,
      frame: params.frame,
      ratios: params.ratios,
      coordinateSpace: 'virtual-screen-frame',
    },
  };
}

function pointFromRatios(
  params: {
    frame: { width?: number; height?: number };
    ratios: Record<string, number>;
  },
  xFlag: string,
  yFlag: string,
): { x: number; y: number } | { reason: string } {
  const xRatio = params.ratios[xFlag];
  const yRatio = params.ratios[yFlag];
  if (xRatio === undefined || yRatio === undefined) return { reason: `Pointer InputIntent requires --${xFlag} and --${yFlag}.` };
  if (params.frame.width === undefined || params.frame.height === undefined) {
    return { reason: 'Pointer InputIntent requires --frame-width and --frame-height so ratios can be projected safely.' };
  }
  return {
    x: Math.round(xRatio * params.frame.width),
    y: Math.round(yRatio * params.frame.height),
  };
}

function parseRefs(
  flags: ParsedFlags,
  source: VirtualScreenInputIntentSource,
): { refs: VirtualScreenInputIntentRefs } | { reason: string } {
  const refs: Partial<VirtualScreenInputIntentRefs> = {};
  const requiredRefFlags = source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE
    ? canvasRequiredRefFlags
    : controlRequiredRefFlags;
  const optionalRefFlags = source === VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE
    ? canvasOptionalRefFlags
    : controlOptionalRefFlags;
  for (const flag of requiredRefFlags) {
    const value = flagValue(flags, flag);
    if (!value) return { reason: `InputIntent requires --${flag}.` };
    const safe = safeTerminalRef(value);
    if (!safe) return { reason: `InputIntent ref --${flag} is unsafe.` };
    refs[refProperty(flag)] = safe;
  }
  for (const flag of optionalRefFlags) {
    const value = flagValue(flags, flag);
    if (!value) continue;
    const safe = safeTerminalRef(value);
    if (!safe) return { reason: `InputIntent ref --${flag} is unsafe.` };
    refs[refProperty(flag)] = safe;
  }
  const activeLeaseOwnerRole = flagValue(flags, 'active-lease-owner-role');
  if (activeLeaseOwnerRole) {
    const safe = safeTerminalRef(activeLeaseOwnerRole);
    if (!safe) return { reason: 'InputIntent ref --active-lease-owner-role is unsafe.' };
    refs.activeLeaseOwnerRole = safe;
  }
  return { refs: refs as VirtualScreenInputIntentRefs };
}

function refProperty(flag: string) {
  return flag.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()) as keyof VirtualScreenInputIntentRefs;
}

function safeTerminalRef(value: string) {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const lower = normalized.toLowerCase();
  if (
    lower.startsWith('data:')
    || lower.startsWith('javascript:')
    || lower.startsWith('file:')
    || lower.startsWith('blob:')
    || lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('//')
    || lower.startsWith('/')
    || lower.includes(';base64,')
    || /authorization|bearer|api[_-]?key|password|secret|token/i.test(normalized)
  ) {
    return undefined;
  }
  if (/[\r\n]/.test(normalized)) return undefined;
  return normalized;
}

function isInputIntentSource(value: string | undefined): value is VirtualScreenInputIntentSource {
  return value === VIRTUAL_APP_SCREEN_INPUT_INTENT_CANVAS_SOURCE
    || value === VIRTUAL_APP_SCREEN_INPUT_INTENT_CONTROL_SOURCE;
}

function normalizeControlKind(value: string): VirtualScreenInputIntentControlKind | undefined {
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (
    normalized === 'takeover'
    || normalized === 'pause-agent'
    || normalized === 'resume-agent'
    || normalized === 'stop-session'
  ) return normalized;
  return undefined;
}

function ratioFlags(flags: ParsedFlags) {
  const ratios: Record<string, number> = {};
  for (const key of ['x-ratio', 'y-ratio', 'start-x-ratio', 'start-y-ratio', 'end-x-ratio', 'end-y-ratio']) {
    const value = numberFlag(flags, key);
    if (value === undefined) continue;
    ratios[key] = Math.max(0, Math.min(1, value));
  }
  return ratios;
}

function flagValue(flags: ParsedFlags, key: string) {
  const value = flags.get(key);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberFlag(flags: ParsedFlags, key: string) {
  const value = flagValue(flags, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveNumberFlag(flags: ParsedFlags, key: string) {
  const parsed = numberFlag(flags, key);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function integerFlag(flags: ParsedFlags, key: string) {
  const parsed = numberFlag(flags, key);
  return parsed !== undefined ? Math.round(parsed) : undefined;
}

function parseFlags(tokens: string[]): { flags: ParsedFlags } | { reason: string } {
  const flags: ParsedFlags = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith('--')) return { reason: `Unexpected InputIntent token: ${token ?? ''}.` };
    const body = token.slice(2);
    if (!body) return { reason: 'Empty InputIntent flag.' };
    const equalsIndex = body.indexOf('=');
    if (equalsIndex >= 0) {
      flags.set(body.slice(0, equalsIndex), body.slice(equalsIndex + 1));
      continue;
    }
    const next = tokens[index + 1];
    if (next === undefined || next.startsWith('--')) return { reason: `InputIntent flag --${body} requires a value.` };
    flags.set(body, next);
    index += 1;
  }
  return { flags };
}

function splitCommandLine(input: string): { tokens: string[] } | { reason: string } {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += '\\';
  if (quote) return { reason: 'Unterminated quote in InputIntent command.' };
  if (current) tokens.push(current);
  return { tokens };
}
