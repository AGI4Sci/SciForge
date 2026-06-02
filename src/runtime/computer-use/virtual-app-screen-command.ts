import { sanitizeId } from './utils.js';

export const VIRTUAL_APP_SCREEN_RUNTIME_COMMAND_SOURCE = 'right-pane-screen';

export type VirtualAppScreenRuntimeCommandParseResult =
  | { kind: 'not-virtual-app-screen-command' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'parsed'; command: VirtualAppScreenRuntimeCommand };

export type VirtualAppScreenRuntimeCommandAction =
  | 'screen-attach'
  | 'screen-reconnect'
  | 'permission-handoff'
  | 'permission-recheck';

export type VirtualAppScreenReconnectReason =
  | 'resize'
  | 'tab-switch'
  | 'workspace-restore'
  | 'provider-reconnect';

export interface VirtualAppScreenRuntimeCommand {
  source: string;
  action: VirtualAppScreenRuntimeCommandAction;
  refs: VirtualAppScreenRuntimeCommandRefs;
  profile?: string;
  reconnectReason?: VirtualAppScreenReconnectReason;
  currentFrameSequence?: number;
}

export interface VirtualAppScreenRuntimeCommandRefs {
  readinessRef: string;
  screenRef?: string;
  targetAppRef?: string;
  targetWindowRef?: string;
  sessionRef?: string;
  displayGroupRef?: string;
  surfaceRef?: string;
  liveSurfaceRef?: string;
  surfaceTransportRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  providerSessionOwnerRef?: string;
  providerSessionReconnectRef?: string;
  liveBindingAttachGrantRef?: string;
  activationRef?: string;
  permissionHandoffRef?: string;
  permissionRef?: string;
  permissionRecheckRef?: string;
  platformDriverRef?: string;
  blockedRef?: string;
  evidenceLedgerRef?: string;
  guiPresentRef?: string;
}

type ParsedFlags = Map<string, string>;

const runtimeCommandPrefixPattern = /^\/(?:computer-use|computer\s+use)\s+(?:screen\s+(?:attach|reconnect)|permission-handoff|permission-recheck)\b/i;
const allowedSources = new Set([
  VIRTUAL_APP_SCREEN_RUNTIME_COMMAND_SOURCE,
  'right-pane-virtual-screen',
  'right-pane-virtual-app-screen',
]);
const allowedReconnectReasons = new Set<VirtualAppScreenReconnectReason>([
  'resize',
  'tab-switch',
  'workspace-restore',
  'provider-reconnect',
]);

export function parseVirtualAppScreenRuntimeCommand(commandText: string): VirtualAppScreenRuntimeCommandParseResult {
  if (!runtimeCommandPrefixPattern.test(commandText.trim())) return { kind: 'not-virtual-app-screen-command' };

  const split = splitCommandLine(commandText);
  if ('reason' in split) return { kind: 'invalid', reason: split.reason };
  const tokens = split.tokens;
  const shape = parseCommandShape(tokens);
  if ('reason' in shape) return { kind: 'invalid', reason: shape.reason };

  const flags = parseFlags(tokens.slice(shape.flagStartIndex));
  if ('reason' in flags) return { kind: 'invalid', reason: flags.reason };

  const source = flagValue(flags.flags, 'source');
  if (!source || !allowedSources.has(source)) {
    return { kind: 'invalid', reason: 'VirtualAppScreen runtime command source must be right-pane-screen.' };
  }

  const refs = parseCommandRefs(shape.action, flags.flags);
  if ('reason' in refs) return { kind: 'invalid', reason: refs.reason };

  const profile = optionalProfile(flags.flags);
  if ('reason' in profile) return { kind: 'invalid', reason: profile.reason };

  const reconnect = optionalReconnectMetadata(shape.action, flags.flags);
  if ('reason' in reconnect) return { kind: 'invalid', reason: reconnect.reason };

  return {
    kind: 'parsed',
    command: {
      source,
      action: shape.action,
      refs: refs.refs,
      profile: profile.profile,
      reconnectReason: reconnect.reconnectReason,
      currentFrameSequence: reconnect.currentFrameSequence,
    },
  };
}

export function virtualAppScreenRuntimeCommandTraceDetail(command: VirtualAppScreenRuntimeCommand) {
  return {
    source: command.source,
    route: virtualAppScreenRuntimeCommandRoute(command),
    action: command.action,
    refs: command.refs,
    profile: command.profile,
    ...(command.reconnectReason ? { reconnectReason: command.reconnectReason } : {}),
    ...(command.currentFrameSequence === undefined ? {} : { currentFrameSequence: command.currentFrameSequence }),
    terminalEquivalent: true,
    providerExecuted: false,
    failClosed: true,
    singleInteractiveTruth: true,
  };
}

export function virtualAppScreenRuntimeCommandRoute(command: VirtualAppScreenRuntimeCommand) {
  return `virtual-app-screen-${command.action}`;
}

export function virtualAppScreenRuntimeCommandRunId(command: VirtualAppScreenRuntimeCommand) {
  return sanitizeId([
    'virtual-app-screen',
    command.action,
    command.refs.screenRef,
    command.refs.activationRef,
    command.refs.permissionHandoffRef,
    command.refs.permissionRecheckRef,
    command.refs.providerSessionReconnectRef,
    command.refs.liveBindingAttachGrantRef,
    command.refs.sessionRef,
    command.refs.currentFrameRef,
    command.refs.targetAppRef,
    command.reconnectReason,
  ].filter(Boolean).join('-'));
}

export function virtualAppScreenRuntimeCommandBlockedReason(command: VirtualAppScreenRuntimeCommand) {
  if (command.action === 'screen-attach') {
    return 'VirtualAppScreen attach was accepted by the product runtime, but no native provider session is currently bound. The request is kept as refs-first evidence and blocked without launching, focusing, or fabricating a desktop session.';
  }
  if (command.action === 'permission-handoff') {
    return 'VirtualAppScreen permission handoff was accepted by the product runtime. Platform authorization must be completed through the referenced handoff before a native provider session can attach.';
  }
  if (command.action === 'screen-reconnect') {
    return 'VirtualAppScreen reconnect was accepted by the product runtime, but reconnect requires an existing provider session checkpoint. The request is kept refs-first and blocked without creating, launching, or attaching a native session.';
  }
  return 'VirtualAppScreen permission recheck was accepted by the product runtime, but provider readiness still requires explicit verified evidence before a live session can attach.';
}

export function virtualAppScreenRuntimeCommandVirtualScreen(command: VirtualAppScreenRuntimeCommand) {
  const runId = virtualAppScreenRuntimeCommandRunId(command);
  return {
    artifactId: `computer-use-virtual-screen-${runId}`,
    title: 'Computer Use screen',
    data: virtualAppScreenRuntimeCommandVirtualScreenData(command),
  };
}

export function virtualAppScreenRuntimeCommandVirtualScreenData(command: VirtualAppScreenRuntimeCommand) {
  const refs = command.refs;
  const blockedReason = virtualAppScreenRuntimeCommandBlockedReason(command);
  const permissionCommand = command.action === 'permission-handoff' || command.action === 'permission-recheck';
  const status = command.action === 'permission-handoff' ? 'requires-handoff' : 'blocked';
  const attachState = command.action === 'permission-handoff' ? 'requires-handoff' : 'blocked';
  const permissionStatus = command.action === 'permission-recheck' ? 'pending-recheck' : permissionCommand ? 'missing' : undefined;
  const primaryRef = primaryCommandRef(command);
  const liveSurfaceRef = refs.liveSurfaceRef ?? refs.surfaceRef;
  const reconnectCommand = command.action === 'screen-reconnect';

  return {
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    title: 'Computer Use Virtual Screen',
    status,
    attachState,
    surfaceMode: 'empty',
    displayGroupRef: refs.displayGroupRef,
    screenRef: refs.screenRef,
    visibleScreenRefs: refs.screenRef ? [refs.screenRef] : [],
    targetAppRef: refs.targetAppRef,
    requestedTargetWindowRef: refs.targetWindowRef,
    requestedSessionRef: refs.sessionRef,
    requestedSurfaceRef: refs.surfaceRef,
    ...(reconnectCommand ? {
      sessionRef: refs.sessionRef,
      liveSurfaceRef,
      providerSessionOwnerRef: refs.providerSessionOwnerRef,
      providerSessionReconnectRef: refs.providerSessionReconnectRef,
      liveBindingAttachGrantRef: refs.liveBindingAttachGrantRef,
      surfaceTransportRef: refs.surfaceTransportRef,
      frameStreamRef: refs.frameStreamRef,
      currentFrameRef: refs.currentFrameRef,
      currentFrameSequence: command.currentFrameSequence === undefined
        ? undefined
        : {
          ref: refs.currentFrameRef,
          sequence: command.currentFrameSequence,
        },
      reconnectReason: command.reconnectReason,
    } : {}),
    adapterReadinessRef: refs.readinessRef,
    providerReadinessRef: refs.readinessRef,
    platformDriverRef: refs.platformDriverRef,
    platformDriverStatus: permissionCommand ? 'missing' : 'unknown',
    blockedRef: refs.blockedRef ?? primaryRef,
    handoffRef: command.action === 'screen-attach' ? refs.activationRef : refs.permissionHandoffRef,
    permissionRef: refs.permissionRef,
    permissionStatus,
    permissionRequired: permissionCommand || undefined,
    permissionGranted: permissionCommand ? false : undefined,
    permissionHandoffRef: refs.permissionHandoffRef,
    permissionRecheckRef: refs.permissionRecheckRef,
    recheckRef: refs.permissionRecheckRef,
    evidenceLedgerRef: refs.evidenceLedgerRef,
    guiPresentRefs: refs.guiPresentRef ? [refs.guiPresentRef] : [],
    artifactRefs: uniqueStrings([
      refs.activationRef,
      refs.permissionHandoffRef,
      refs.permissionRef,
      refs.permissionRecheckRef,
      refs.platformDriverRef,
      refs.blockedRef,
      refs.evidenceLedgerRef,
      refs.guiPresentRef,
      refs.surfaceRef,
      liveSurfaceRef,
      refs.surfaceTransportRef,
      refs.frameStreamRef,
      refs.currentFrameRef,
      refs.providerSessionOwnerRef,
      refs.providerSessionReconnectRef,
      refs.liveBindingAttachGrantRef,
      refs.displayGroupRef,
    ]),
    verificationRefs: uniqueStrings([
      refs.readinessRef,
      refs.platformDriverRef,
      refs.permissionRef,
      refs.permissionRecheckRef,
      refs.blockedRef,
      refs.evidenceLedgerRef,
      reconnectCommand ? refs.providerSessionOwnerRef : undefined,
      reconnectCommand ? refs.providerSessionReconnectRef : undefined,
      reconnectCommand ? refs.liveBindingAttachGrantRef : undefined,
      reconnectCommand ? refs.surfaceTransportRef : undefined,
    ]),
    blockedReason,
    isolationFlags: {
      diagnosticOnly: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      singleInteractiveTruth: true,
      secondInteractiveSurfacePresent: false,
      providerExecuted: false,
      failClosedByDefault: true,
    },
    runSummary: {
      status,
      blockedReason,
      frameCount: 0,
      screenCount: refs.screenRef ? 1 : 0,
      realNativeSidecarExecuted: false,
      completionEligible: false,
      runtimeCommandRoute: virtualAppScreenRuntimeCommandRoute(command),
      productRuntimeAccepted: true,
      ...(command.reconnectReason ? { reconnectReason: command.reconnectReason } : {}),
    },
    events: virtualAppScreenRuntimeCommandEvents(command),
  };
}

function parseCommandShape(tokens: string[]): { action: VirtualAppScreenRuntimeCommandAction; flagStartIndex: number } | { reason: string } {
  const commandToken = tokens[0]?.toLowerCase();
  const first = tokens[1]?.toLowerCase();
  const second = tokens[2]?.toLowerCase();
  const third = tokens[3]?.toLowerCase();

  if (commandToken === '/computer-use' && first === 'screen' && second === 'attach') {
    return { action: 'screen-attach', flagStartIndex: 3 };
  }
  if (commandToken === '/computer-use' && first === 'screen' && second === 'reconnect') {
    return { action: 'screen-reconnect', flagStartIndex: 3 };
  }
  if (commandToken === '/computer' && first === 'use' && second === 'screen' && third === 'attach') {
    return { action: 'screen-attach', flagStartIndex: 4 };
  }
  if (commandToken === '/computer' && first === 'use' && second === 'screen' && third === 'reconnect') {
    return { action: 'screen-reconnect', flagStartIndex: 4 };
  }
  if (commandToken === '/computer-use' && first === 'permission-handoff') {
    return { action: 'permission-handoff', flagStartIndex: 2 };
  }
  if (commandToken === '/computer' && first === 'use' && second === 'permission-handoff') {
    return { action: 'permission-handoff', flagStartIndex: 3 };
  }
  if (commandToken === '/computer-use' && first === 'permission-recheck') {
    return { action: 'permission-recheck', flagStartIndex: 2 };
  }
  if (commandToken === '/computer' && first === 'use' && second === 'permission-recheck') {
    return { action: 'permission-recheck', flagStartIndex: 3 };
  }
  return { reason: 'Malformed VirtualAppScreen runtime command.' };
}

function parseCommandRefs(action: VirtualAppScreenRuntimeCommandAction, flags: ParsedFlags): { refs: VirtualAppScreenRuntimeCommandRefs } | { reason: string } {
  const unsafe = unsafeRefFlags(flags);
  if (unsafe.length) return { reason: `VirtualAppScreen runtime command ref --${unsafe[0]} is unsafe.` };

  const providerSessionReconnectRef = firstSafeRef(flags, ['provider-session-reconnect-ref', 'reconnect-ref']);
  const liveSurfaceRef = firstSafeRef(flags, ['live-surface-ref', 'surface-ref']);
  const readinessRef = firstSafeRef(flags, ['adapter-readiness-ref', 'provider-readiness-ref'])
    ?? (action === 'screen-reconnect' ? providerSessionReconnectRef : undefined);
  if (!readinessRef) {
    return {
      reason: action === 'screen-reconnect'
        ? 'VirtualAppScreen screen reconnect requires --provider-session-reconnect-ref or --reconnect-ref.'
        : 'VirtualAppScreen runtime command requires --adapter-readiness-ref or --provider-readiness-ref.',
    };
  }

  const refs: VirtualAppScreenRuntimeCommandRefs = {
    readinessRef,
    screenRef: optionalSafeRef(flags, 'screen-ref'),
    targetAppRef: optionalSafeRef(flags, 'target-app-ref'),
    targetWindowRef: optionalSafeRef(flags, 'target-window-ref'),
    sessionRef: optionalSafeRef(flags, 'session-ref'),
    displayGroupRef: optionalSafeRef(flags, 'display-group-ref'),
    surfaceRef: liveSurfaceRef,
    ...(liveSurfaceRef ? { liveSurfaceRef } : {}),
    ...(optionalSafeRef(flags, 'surface-transport-ref') ? { surfaceTransportRef: optionalSafeRef(flags, 'surface-transport-ref') } : {}),
    ...(optionalSafeRef(flags, 'frame-stream-ref') ? { frameStreamRef: optionalSafeRef(flags, 'frame-stream-ref') } : {}),
    ...(optionalSafeRef(flags, 'current-frame-ref') ? { currentFrameRef: optionalSafeRef(flags, 'current-frame-ref') } : {}),
    ...(optionalSafeRef(flags, 'provider-session-owner-ref') ? { providerSessionOwnerRef: optionalSafeRef(flags, 'provider-session-owner-ref') } : {}),
    ...(providerSessionReconnectRef ? { providerSessionReconnectRef } : {}),
    ...(optionalSafeRef(flags, 'live-binding-attach-grant-ref') ? { liveBindingAttachGrantRef: optionalSafeRef(flags, 'live-binding-attach-grant-ref') } : {}),
    activationRef: firstSafeRef(flags, ['activation-ref', 'attach-ref']),
    permissionHandoffRef: firstSafeRef(flags, ['handoff-ref', 'permission-handoff-ref']),
    permissionRef: optionalSafeRef(flags, 'permission-ref'),
    permissionRecheckRef: firstSafeRef(flags, ['recheck-ref', 'permission-recheck-ref']),
    platformDriverRef: optionalSafeRef(flags, 'platform-driver-ref'),
    blockedRef: optionalSafeRef(flags, 'blocked-ref'),
    evidenceLedgerRef: optionalSafeRef(flags, 'evidence-ledger-ref'),
    guiPresentRef: optionalSafeRef(flags, 'gui-present-ref'),
  };

  if (action === 'screen-attach') {
    refs.activationRef = refs.activationRef ?? firstSafeRef(flags, ['target-ref', 'handoff-ref']);
    if (!refs.activationRef && !refs.surfaceRef && !refs.sessionRef) {
      return { reason: 'VirtualAppScreen screen attach requires --activation-ref, --surface-ref, or --session-ref.' };
    }
    if (!refs.targetAppRef) return { reason: 'VirtualAppScreen screen attach requires --target-app-ref.' };
  } else if (action === 'screen-reconnect') {
    const missing = [
      refs.screenRef ? undefined : '--screen-ref',
      refs.sessionRef ? undefined : '--session-ref',
      liveSurfaceRef ? undefined : '--live-surface-ref or --surface-ref',
      refs.frameStreamRef ? undefined : '--frame-stream-ref',
      refs.currentFrameRef ? undefined : '--current-frame-ref',
      refs.providerSessionOwnerRef ? undefined : '--provider-session-owner-ref',
      refs.providerSessionReconnectRef ? undefined : '--provider-session-reconnect-ref or --reconnect-ref',
      refs.liveBindingAttachGrantRef ? undefined : '--live-binding-attach-grant-ref',
      refs.surfaceTransportRef ? undefined : '--surface-transport-ref',
    ].filter((item): item is string => Boolean(item));
    if (missing.length) return { reason: `VirtualAppScreen screen reconnect requires ${missing[0]}.` };
  } else {
    refs.permissionHandoffRef = refs.permissionHandoffRef ?? optionalSafeRef(flags, 'target-ref');
    refs.permissionRecheckRef = refs.permissionRecheckRef ?? optionalSafeRef(flags, 'target-ref');
    if (action === 'permission-handoff' && !refs.permissionHandoffRef) {
      return { reason: 'VirtualAppScreen permission handoff requires --target-ref or --handoff-ref.' };
    }
    if (action === 'permission-recheck' && !refs.permissionRecheckRef) {
      return { reason: 'VirtualAppScreen permission recheck requires --target-ref or --recheck-ref.' };
    }
  }

  return { refs };
}

function virtualAppScreenRuntimeCommandEvents(command: VirtualAppScreenRuntimeCommand) {
  const refs = command.refs;
  return [
    {
      label: 'runtime-command',
      ref: primaryCommandRef(command),
      status: command.action,
    },
    {
      label: 'provider-readiness',
      ref: refs.readinessRef,
      status: 'blocked-until-provider-evidence',
    },
    refs.activationRef ? {
      label: 'screen-attach',
      ref: refs.activationRef,
      status: 'accepted-fail-closed',
    } : undefined,
    refs.permissionHandoffRef ? {
      label: 'permission-handoff',
      ref: refs.permissionHandoffRef,
      status: command.action === 'permission-handoff' ? 'requires-handoff' : 'referenced',
    } : undefined,
    refs.permissionRecheckRef ? {
      label: 'permission-recheck',
      ref: refs.permissionRecheckRef,
      status: command.action === 'permission-recheck' ? 'pending-recheck' : 'blocked-until-recheck',
    } : undefined,
    refs.providerSessionReconnectRef ? {
      label: 'screen-reconnect',
      ref: refs.providerSessionReconnectRef,
      status: command.action === 'screen-reconnect' ? 'accepted-fail-closed' : 'referenced',
    } : undefined,
    refs.liveBindingAttachGrantRef ? {
      label: 'live-binding-attach-grant',
      ref: refs.liveBindingAttachGrantRef,
      status: command.action === 'screen-reconnect' ? 'requires-runtime-revalidation' : 'referenced',
    } : undefined,
  ].filter((event): event is { label: string; ref: string; status: string } => Boolean(event));
}

function primaryCommandRef(command: VirtualAppScreenRuntimeCommand) {
  return command.refs.activationRef
    ?? command.refs.permissionHandoffRef
    ?? command.refs.permissionRecheckRef
    ?? command.refs.providerSessionReconnectRef
    ?? command.refs.blockedRef
    ?? command.refs.readinessRef;
}

function optionalReconnectMetadata(
  action: VirtualAppScreenRuntimeCommandAction,
  flags: ParsedFlags,
): { reconnectReason?: VirtualAppScreenReconnectReason; currentFrameSequence?: number } | { reason: string } {
  if (action !== 'screen-reconnect') return {};
  const reason = flagValue(flags, 'reason');
  if (!reason || !allowedReconnectReasons.has(reason as VirtualAppScreenReconnectReason)) {
    return { reason: 'VirtualAppScreen screen reconnect requires --reason resize|tab-switch|workspace-restore|provider-reconnect.' };
  }
  const sequence = flagValue(flags, 'current-frame-sequence');
  if (!sequence) return { reason: 'VirtualAppScreen screen reconnect requires --current-frame-sequence.' };
  if (!/^\d+$/.test(sequence)) return { reason: 'VirtualAppScreen screen reconnect --current-frame-sequence must be a non-negative integer.' };
  const currentFrameSequence = Number(sequence);
  if (!Number.isSafeInteger(currentFrameSequence)) {
    return { reason: 'VirtualAppScreen screen reconnect --current-frame-sequence must be a safe non-negative integer.' };
  }
  return {
    reconnectReason: reason as VirtualAppScreenReconnectReason,
    currentFrameSequence,
  };
}

function optionalProfile(flags: ParsedFlags): { profile?: string } | { reason: string } {
  const profile = flagValue(flags, 'profile');
  if (!profile) return {};
  if (!/^[a-zA-Z0-9._/-]+$/.test(profile) || /authorization|bearer|api[_-]?key|password|secret|token/i.test(profile)) {
    return { reason: 'VirtualAppScreen profile is unsafe.' };
  }
  return { profile };
}

function firstSafeRef(flags: ParsedFlags, keys: string[]) {
  for (const key of keys) {
    const ref = optionalSafeRef(flags, key);
    if (ref) return ref;
  }
  return undefined;
}

function optionalSafeRef(flags: ParsedFlags, key: string) {
  const value = flagValue(flags, key);
  if (!value) return undefined;
  return safeTerminalRef(value);
}

function unsafeRefFlags(flags: ParsedFlags) {
  return [...flags.entries()]
    .filter(([key]) => key.endsWith('-ref'))
    .filter(([key, value]) => Boolean(value?.trim()) && !safeTerminalRef(value) && key !== 'source')
    .map(([key]) => key);
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

function flagValue(flags: ParsedFlags, key: string) {
  const value = flags.get(key);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseFlags(tokens: string[]): { flags: ParsedFlags } | { reason: string } {
  const flags: ParsedFlags = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token?.startsWith('--')) return { reason: `Unexpected VirtualAppScreen runtime command token: ${token ?? ''}.` };
    const body = token.slice(2);
    if (!body) return { reason: 'Empty VirtualAppScreen runtime command flag.' };
    const equalsIndex = body.indexOf('=');
    if (equalsIndex >= 0) {
      flags.set(body.slice(0, equalsIndex), body.slice(equalsIndex + 1));
      continue;
    }
    const next = tokens[index + 1];
    if (next === undefined || next.startsWith('--')) return { reason: `VirtualAppScreen runtime command flag --${body} requires a value.` };
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
  if (quote) return { reason: 'Unterminated quote in VirtualAppScreen runtime command.' };
  if (current) tokens.push(current);
  return { tokens };
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}
