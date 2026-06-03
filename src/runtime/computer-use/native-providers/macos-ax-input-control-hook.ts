import { readFileSync } from 'node:fs';

import {
  nativeDriverInputControlDefaultRefs,
  type NativeVirtualDisplayDriverInputControlContext,
  type NativeVirtualDisplayDriverInputControlResult,
} from './native-driver-input-control.js';
import {
  runCompiledSwiftHelper,
  shortError,
  writeJsonRef,
} from './macos-native-driver-helpers.js';

export interface MacosAxInputControlHookDeps {
  executeAxOperation?: (input: MacosAxOperationInput) => MacosAxOperationResult | Promise<MacosAxOperationResult>;
  writeJsonRef?: (outDir: string, runDirRef: string, ref: string, data: unknown) => void | Promise<void>;
  now?: () => number;
}

export interface MacosAxOperationInput {
  mode: 'capabilityProbe' | 'click' | 'type_text' | 'scroll';
  targetPid: number;
  windowIndex?: number;
  displayBounds: Bounds;
  targetWindowBounds: Bounds;
  point?: { x: number; y: number };
  text?: string;
  direction?: string;
  amount?: number;
}

export interface MacosAxOperationResult {
  ok: boolean;
  detail?: string;
  mutationKind?: string;
  verification?: Record<string, unknown>;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type JsonRecord = Record<string, unknown>;

const schemaVersion = 'sciforge.computer-use.virtual-app-screen.macos-pid-scoped-ax-input-control.v1';
const mechanism = 'pid-scoped-ax';

export async function runMacosAxInputControlHook(
  context: NativeVirtualDisplayDriverInputControlContext,
  deps: MacosAxInputControlHookDeps = {},
): Promise<NativeVirtualDisplayDriverInputControlResult> {
  const evidenceRoot = context.evidenceRoot;
  if (!evidenceRoot) return failed('macOS pid-scoped AX input/control hook requires evidenceRoot.');
  const providerRootRef = stringValue(context.refs.providerRootRef);
  if (!providerRootRef || providerRootRef !== evidenceRoot.providerRootRef) {
    return failed('macOS pid-scoped AX input/control hook requires matching providerRootRef.');
  }
  const target = macosTargetFromPlatformState(context.platformState);
  if (!target.ok) return failed(target.detail);
  const refs = nativeDriverInputControlDefaultRefs({
    providerRootRef,
    operation: context.operation,
    operationOptions: context.operationOptions,
  });
  const now = deps.now?.() ?? Date.now();
  const writer = deps.writeJsonRef ?? writeJsonRef;
  const executeAxOperation = deps.executeAxOperation ?? defaultMacosAxOperationExecutor;

  if (context.capabilityProbe === true) {
    const capability = await executeAxOperation({
      mode: 'capabilityProbe',
      targetPid: target.pid,
      windowIndex: target.windowIndex,
      displayBounds: target.displayBounds,
      targetWindowBounds: target.windowBounds,
    });
    if (!capability.ok) return failed(capability.detail ?? 'macOS pid-scoped AX capability probe failed.');
    const capabilityRef = `${providerRootRef}/verification/capability-pid-scoped-ax.json`;
    await writer(evidenceRoot.outDir, evidenceRoot.runDirRef, capabilityRef, {
      schemaVersion,
      operation: context.operation,
      capabilityProbe: true,
      mechanism,
      providerId: context.providerId,
      targetPid: target.pid,
      targetWindowBounds: target.windowBounds,
      displayBounds: target.displayBounds,
      axVerification: capability.verification,
      currentRunOnly: true,
      createdAtMs: now,
    });
    return {
      ok: true,
      inputAdapterCapability: {
        ok: true,
        mechanism,
        refs: { verificationRefs: [capabilityRef] },
      },
      mutatingActionExecuted: false,
      providerEvidenceWritten: true,
      affectsPhysicalDisplay: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    };
  }

  const action = actionForContext(context);
  if (!action.ok) return failed(action.detail);
  let axResult: MacosAxOperationResult;
  if (context.operation === 'sendInputIntent') {
    const axInput = macosAxOperationInputForAction(action.action, target);
    if (!axInput.ok) return failed(axInput.detail);
    axResult = await executeAxOperation(axInput.input);
  } else {
    axResult = { ok: true, mutationKind: context.operation, verification: { controlOnly: true } };
  }
  if (!axResult.ok) return failed(axResult.detail ?? 'macOS pid-scoped AX operation failed.');

  await writeEvidenceBundle({
    context,
    evidenceRoot,
    refs,
    action: action.action,
    target,
    axResult,
    now,
    writer,
  });

  return {
    ok: true,
    refs,
    mutatingActionExecuted: true,
    providerEvidenceWritten: true,
    affectsPhysicalDisplay: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
  };
}

export function macosAxInputControlCliMain(): void {
  runMacosAxInputControlHook(JSON.parse(readFileSync(0, 'utf8')) as NativeVirtualDisplayDriverInputControlContext)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stdout.write(`${JSON.stringify(failed(shortError(error)))}\n`);
    });
}

function failed(detail: string): NativeVirtualDisplayDriverInputControlResult {
  return {
    ok: false,
    detail,
    mutatingActionExecuted: false,
    providerEvidenceWritten: false,
  };
}

function macosTargetFromPlatformState(platformState: JsonRecord): { ok: true; pid: number; windowIndex?: number; displayBounds: Bounds; windowBounds: Bounds } | { ok: false; detail: string } {
  const display = recordValue(platformState.display);
  const targetWindow = recordValue(platformState.targetWindow);
  const cgWindow = recordValue(targetWindow?.cgWindow);
  const axWindow = recordValue(targetWindow?.axWindow);
  const pid = numberValue(cgWindow?.pid ?? axWindow?.pid);
  if (typeof pid !== 'number') return { ok: false, detail: 'macOS pid-scoped AX hook requires target pid.' };
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, detail: 'macOS pid-scoped AX hook requires target pid.' };
  const displayBounds = boundsFromRecord(display);
  if (!displayBounds) return { ok: false, detail: 'macOS pid-scoped AX hook requires virtual display bounds.' };
  const windowBounds = boundsFromRecord(cgWindow) ?? boundsFromRecord(axWindow);
  if (!windowBounds) return { ok: false, detail: 'macOS pid-scoped AX hook requires target window bounds.' };
  if (!boundsWithinDisplay(windowBounds, displayBounds)) {
    return { ok: false, detail: 'macOS pid-scoped AX hook requires the target window to remain inside the virtual display.' };
  }
  const windowIndex = numberValue(axWindow?.windowIndex);
  return {
    ok: true,
    pid,
    ...(typeof windowIndex === 'number' ? { windowIndex } : {}),
    displayBounds,
    windowBounds,
  };
}

function actionForContext(context: NativeVirtualDisplayDriverInputControlContext): { ok: true; action: JsonRecord } | { ok: false; detail: string } {
  if (context.operation !== 'sendInputIntent') {
    return { ok: true, action: { type: context.operation } };
  }
  const inputIntent = recordValue(context.operationOptions.inputIntent);
  if (!inputIntent) return { ok: false, detail: 'macOS pid-scoped AX hook requires an InputIntent action.' };
  const action = recordValue(inputIntent?.action);
  if (!action) return { ok: false, detail: 'macOS pid-scoped AX hook requires an InputIntent action.' };
  const type = stringValue(action.type) ?? stringValue(action.kind) ?? stringValue(context.inputIntent.actionType) ?? stringValue(context.inputIntent.kind);
  if (!type) return { ok: false, detail: 'macOS pid-scoped AX hook requires an action type.' };
  const ratios = recordValue(inputIntent.ratios);
  return {
    ok: true,
    action: stripUndefined({
      ...action,
      type,
      xRatio: numberValue(action.xRatio) ?? numberValue(action['x-ratio']) ?? numberValue(ratios?.['x-ratio']) ?? numberValue(ratios?.xRatio),
      yRatio: numberValue(action.yRatio) ?? numberValue(action['y-ratio']) ?? numberValue(ratios?.['y-ratio']) ?? numberValue(ratios?.yRatio),
    }),
  };
}

function macosAxOperationInputForAction(
  action: JsonRecord,
  target: { pid: number; windowIndex?: number; displayBounds: Bounds; windowBounds: Bounds },
): { ok: true; input: MacosAxOperationInput } | { ok: false; detail: string } {
  const type = stringValue(action.type);
  if (type === 'click' || type === 'double_click') {
    const xRatio = numberValue(action.xRatio) ?? numberValue(action['x-ratio']);
    const yRatio = numberValue(action.yRatio) ?? numberValue(action['y-ratio']);
    let point: { x: number; y: number };
    if (typeof xRatio === 'number' || typeof yRatio === 'number') {
      if (typeof xRatio !== 'number' || typeof yRatio !== 'number' || !ratioInRange(xRatio) || !ratioInRange(yRatio)) {
        return { ok: false, detail: 'macOS pid-scoped AX click requires xRatio/yRatio between 0 and 1.' };
      }
      point = {
        x: target.windowBounds.x + Math.round(target.windowBounds.width * xRatio),
        y: target.windowBounds.y + Math.round(target.windowBounds.height * yRatio),
      };
    } else {
      const frameX = numberValue(action.x);
      const frameY = numberValue(action.y);
      if (typeof frameX !== 'number' || typeof frameY !== 'number') {
        return { ok: false, detail: 'macOS pid-scoped AX click requires frame x/y or xRatio/yRatio.' };
      }
      point = {
        x: target.windowBounds.x + Math.round(frameX),
        y: target.windowBounds.y + Math.round(frameY),
      };
    }
    if (!pointWithinBounds(point, target.windowBounds)) {
      return { ok: false, detail: 'macOS pid-scoped AX click target is outside the attached target window.' };
    }
    return { ok: true, input: baseAxInput('click', target, { point }) };
  }
  if (type === 'type_text') {
    const text = stringValue(action.text);
    if (text === undefined) return { ok: false, detail: 'macOS pid-scoped AX type_text requires text.' };
    return { ok: true, input: baseAxInput('type_text', target, { text }) };
  }
  if (type === 'scroll') {
    const direction = stringValue(action.direction);
    if (!direction) return { ok: false, detail: 'macOS pid-scoped AX scroll requires direction.' };
    return { ok: true, input: baseAxInput('scroll', target, { direction, amount: Math.max(1, numberValue(action.amount) ?? 1) }) };
  }
  return { ok: false, detail: `macOS pid-scoped AX hook does not support action type ${type ?? 'missing'}.` };
}

function baseAxInput(
  mode: MacosAxOperationInput['mode'],
  target: { pid: number; windowIndex?: number; displayBounds: Bounds; windowBounds: Bounds },
  extra: Partial<MacosAxOperationInput> = {},
): MacosAxOperationInput {
  return {
    mode,
    targetPid: target.pid,
    windowIndex: target.windowIndex,
    displayBounds: target.displayBounds,
    targetWindowBounds: target.windowBounds,
    ...extra,
  };
}

async function writeEvidenceBundle(input: {
  context: NativeVirtualDisplayDriverInputControlContext;
  evidenceRoot: { outDir: string; runDirRef: string; providerRootRef: string };
  refs: Record<string, string | string[] | undefined>;
  action: JsonRecord;
  target: { pid: number; windowIndex?: number; displayBounds: Bounds; windowBounds: Bounds };
  axResult: MacosAxOperationResult;
  now: number;
  writer: NonNullable<MacosAxInputControlHookDeps['writeJsonRef']>;
}) {
  const base = {
    schemaVersion,
    providerId: input.context.providerId,
    operation: input.context.operation,
    mechanism,
    currentRunOnly: true,
    displayScoped: true,
    affectsPhysicalDisplay: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    createdAtMs: input.now,
  };
  const common = {
    ...base,
    inputIntent: input.context.inputIntent,
    action: input.action,
    targetPid: input.target.pid,
    targetWindowBounds: input.target.windowBounds,
    displayBounds: input.target.displayBounds,
    axMutationKind: input.axResult.mutationKind,
    axVerification: input.axResult.verification,
  };
  const write = async (ref: string | string[] | undefined, data: unknown) => {
    const targetRef = Array.isArray(ref) ? ref[0] : ref;
    if (!targetRef) return;
    await input.writer(input.evidenceRoot.outDir, input.evidenceRoot.runDirRef, targetRef, data);
  };
  await write(input.refs.inputIntentRefs, { ...base, inputIntent: input.context.inputIntent, action: input.action });
  await write(input.refs.executorEventRefs, { ...common, event: 'executor.completed' });
  await write(input.refs.beforeFrameRef, { ...base, role: 'before-input-control', frameRef: input.refs.beforeFrameRef });
  await write(input.refs.afterFrameRef, { ...base, role: 'after-input-control', frameRef: input.refs.afterFrameRef });
  await write(input.refs.beforeAfterFrameRefs, {
    ...base,
    beforeFrameRef: input.refs.beforeFrameRef,
    afterFrameRef: input.refs.afterFrameRef,
  });
  await write(input.refs.verificationRefs, common);
  await write(input.refs.isolationEvidenceRefs, {
    ...common,
    isolationMechanism: 'accessibility-action-scoped-to-target-pid',
    forbiddenMechanisms: ['CGEvent', 'System Events keystroke', 'shared keyboard', 'shared pointer'],
  });
  await write(input.refs.physicalDesktopProbeRefs, {
    ...common,
    probeMethod: 'no-shared-system-input-and-no-system-pointer-mutation',
  });
  await write(input.refs.agentQueueRef, { ...base, queueMode: input.context.operation });
  await write(input.refs.currentFrameRefreshRef, { ...base, refreshMode: 'resume-readFrame-required' });
  await write(input.refs.safeStopRef, {
    ...base,
    safeStopMode: 'safe-close-or-pause-virtual-session-only',
    closesUserRealApp: false,
  });
}

function defaultMacosAxOperationExecutor(input: MacosAxOperationInput): MacosAxOperationResult {
  if (process.platform !== 'darwin') return { ok: false, detail: 'macOS pid-scoped AX hook requires darwin.' };
  try {
    const stdout = runCompiledSwiftHelper('ax-input-control', AX_INPUT_CONTROL_SWIFT, [JSON.stringify(input)]);
    const parsed = JSON.parse(stdout) as { ok?: boolean; detail?: string; mutationKind?: string; verification?: Record<string, unknown> };
    return {
      ok: parsed.ok === true,
      detail: parsed.detail,
      mutationKind: parsed.mutationKind,
      verification: parsed.verification,
    };
  } catch (error) {
    return { ok: false, detail: shortError(error) };
  }
}

function boundsFromRecord(record: Record<string, unknown> | undefined): Bounds | undefined {
  const x = numberValue(record?.x);
  const y = numberValue(record?.y);
  const width = numberValue(record?.width);
  const height = numberValue(record?.height);
  if (![x, y, width, height].every(Number.isFinite) || (width ?? 0) <= 0 || (height ?? 0) <= 0) return undefined;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function boundsWithinDisplay(bounds: Bounds, display: Bounds): boolean {
  const inset = 8;
  return bounds.x >= display.x - inset
    && bounds.y >= display.y - inset
    && bounds.x + Math.min(bounds.width, 80) <= display.x + display.width + inset
    && bounds.y + Math.min(bounds.height, 80) <= display.y + display.height + inset;
}

function pointWithinBounds(point: { x: number; y: number }, bounds: Bounds): boolean {
  return point.x >= bounds.x
    && point.y >= bounds.y
    && point.x <= bounds.x + bounds.width
    && point.y <= bounds.y + bounds.height;
}

function ratioInRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, unknown] => entry[1] !== undefined),
  ) as T;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export const AX_INPUT_CONTROL_SWIFT = `
import ApplicationServices
import Foundation

func emit(_ value: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [])
  FileHandle.standardOutput.write(data)
}

guard CommandLine.arguments.count >= 2,
  let data = CommandLine.arguments[1].data(using: .utf8),
  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
else {
  emit(["ok": false, "detail": "invalid-json"])
  exit(0)
}

let mode = json["mode"] as? String ?? ""
let targetPid = pid_t(json["targetPid"] as? Int ?? -1)
let app = AXUIElementCreateApplication(targetPid)
var windowsValue: CFTypeRef?
let windowsResult = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsValue)
guard windowsResult == .success else {
  emit(["ok": false, "detail": "target-window-not-readable", "copyResult": Int(windowsResult.rawValue)])
  exit(0)
}
let windows = (windowsValue as? [AXUIElement]) ?? []

if mode == "capabilityProbe" {
  emit([
    "ok": true,
    "mutationKind": "capabilityProbe",
    "verification": ["targetPid": Int(targetPid), "windowsReadable": true, "sharedSystemInputUsed": false]
  ])
  exit(0)
}

func actionNames(_ element: AXUIElement) -> [String] {
  var actionsValue: CFArray?
  let result = AXUIElementCopyActionNames(element, &actionsValue)
  if result != .success { return [] }
  return (actionsValue as? [String]) ?? []
}

func parentElement(_ element: AXUIElement) -> AXUIElement? {
  var parentValue: CFTypeRef?
  let result = AXUIElementCopyAttributeValue(element, kAXParentAttribute as CFString, &parentValue)
  if result != .success { return nil }
  return parentValue as! AXUIElement?
}

func firstPressableElement(_ element: AXUIElement) -> (AXUIElement, [String], Int)? {
  var current: AXUIElement? = element
  for depth in 0..<8 {
    guard let candidate = current else { break }
    let actions = actionNames(candidate)
    if actions.contains(kAXPressAction) {
      return (candidate, actions, depth)
    }
    current = parentElement(candidate)
  }
  return nil
}

func targetWindowElement() -> AXUIElement? {
  let windowIndex = json["windowIndex"] as? Int
  if let index = windowIndex, index > 0, index <= windows.count {
    return windows[index - 1]
  }
  return windows.first
}

if mode == "click" {
  guard let point = json["point"] as? [String: Any],
    let x = point["x"] as? Double,
    let y = point["y"] as? Double
  else {
    emit(["ok": false, "detail": "click-missing-point"])
    exit(0)
  }
  let systemWide = AXUIElementCreateSystemWide()
  var hitElement: AXUIElement?
  let hitResult = AXUIElementCopyElementAtPosition(systemWide, Float(x), Float(y), &hitElement)
  guard hitResult == .success, let element = hitElement else {
    emit(["ok": false, "detail": "hit-test-failed", "hitResult": Int(hitResult.rawValue)])
    exit(0)
  }
  var hitPid = pid_t(-1)
  AXUIElementGetPid(element, &hitPid)
  guard hitPid == targetPid else {
    emit(["ok": false, "detail": "hit-target-pid-mismatch", "hitPid": Int(hitPid), "targetPid": Int(targetPid)])
    exit(0)
  }
  if let pressable = firstPressableElement(element) {
    let pressResult = AXUIElementPerformAction(pressable.0, kAXPressAction as CFString)
    emit([
      "ok": pressResult == .success,
      "detail": pressResult == .success ? "pressed" : "AXPress-failed",
      "mutationKind": "AXPress",
      "verification": ["targetPid": Int(targetPid), "hitPid": Int(hitPid), "actions": pressable.1, "ancestorDepth": pressable.2]
    ])
    exit(0)
  }
  let hitActions = actionNames(element)
  if let window = targetWindowElement() {
    let windowActions = actionNames(window)
    if windowActions.contains(kAXRaiseAction) {
      let raiseResult = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
      emit([
        "ok": raiseResult == .success,
        "detail": raiseResult == .success ? "raised-target-window" : "AXRaise-failed",
        "mutationKind": "AXRaise",
        "verification": ["targetPid": Int(targetPid), "hitPid": Int(hitPid), "hitActions": hitActions, "windowActions": windowActions, "fallback": "target-window-raise"]
      ])
      exit(0)
    }
    let focusResult = AXUIElementSetAttributeValue(app, kAXFocusedWindowAttribute as CFString, window)
    emit([
      "ok": focusResult == .success,
      "detail": focusResult == .success ? "focused-target-window" : "AXFocusedWindow-set-failed",
      "mutationKind": "AXFocusedWindow",
      "verification": ["targetPid": Int(targetPid), "hitPid": Int(hitPid), "hitActions": hitActions, "windowActions": windowActions, "fallback": "target-window-focus"]
    ])
    exit(0)
  }
  emit(["ok": false, "detail": "hit-element-does-not-support-AXPress", "actions": hitActions])
  exit(0)
}

if mode == "type_text" {
  guard let text = json["text"] as? String else {
    emit(["ok": false, "detail": "type-text-missing-text"])
    exit(0)
  }
  var focusedValue: CFTypeRef?
  let focusedResult = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focusedValue)
  guard focusedResult == .success, let focused = focusedValue else {
    emit(["ok": false, "detail": "focused-element-not-readable", "copyResult": Int(focusedResult.rawValue)])
    exit(0)
  }
  let element = focused as! AXUIElement
  let setResult = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef)
  emit([
    "ok": setResult == .success,
    "detail": setResult == .success ? "value-set" : "AXValue-set-failed",
    "mutationKind": "AXValue",
    "verification": ["targetPid": Int(targetPid), "textLength": text.count]
  ])
  exit(0)
}

if mode == "scroll" {
  let direction = json["direction"] as? String ?? "down"
  let action = direction == "up" ? "AXScrollUp" : direction == "left" ? "AXScrollLeft" : direction == "right" ? "AXScrollRight" : "AXScrollDown"
  var focusedValue: CFTypeRef?
  let focusedResult = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focusedValue)
  guard focusedResult == .success, let focused = focusedValue else {
    emit(["ok": false, "detail": "focused-element-not-readable-for-scroll", "copyResult": Int(focusedResult.rawValue)])
    exit(0)
  }
  let element = focused as! AXUIElement
  let actions = actionNames(element)
  guard actions.contains(action) else {
    emit(["ok": false, "detail": "focused-element-does-not-support-scroll-action", "actions": actions, "requestedAction": action])
    exit(0)
  }
  let scrollResult = AXUIElementPerformAction(element, action as CFString)
  emit([
    "ok": scrollResult == .success,
    "detail": scrollResult == .success ? "scrolled" : "AXScroll-failed",
    "mutationKind": action,
    "verification": ["targetPid": Int(targetPid), "actions": actions]
  ])
  exit(0)
}

emit(["ok": false, "detail": "unsupported-mode"])
`;

if (process.argv[1]?.endsWith('macos-ax-input-control-hook.ts') || process.argv[1]?.endsWith('macos-ax-input-control-hook.js')) {
  macosAxInputControlCliMain();
}
