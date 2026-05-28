export type ComputerUseIndependentInputAdapter = 'virtual-hid' | 'remote-desktop';
export type ComputerUseCaptureKind = 'display' | 'window';
export type ComputerUseCoordinateSpace = 'screen' | 'window' | 'window-local';
export type ComputerUseInputIsolation = 'best-effort' | 'require-focused-target';
export type ComputerUseWindowTargetMode = 'display' | 'active-window' | 'window-id' | 'app-window';
export type ComputerUsePlannerContractIssue = 'coordinate-output' | 'platform-incompatible-action' | 'unsupported-action' | 'empty-message-content' | 'completion-evidence-missing' | 'ambiguous-target-description' | 'quota-unmet' | 'current-round-action-missing' | 'visible-artifact-missing';

export const computerUseInputPolicyIds = {
  actionType: 'generic-mouse-keyboard',
  dryRunExecutor: 'dry-run-generic-gui-executor',
  dryRunBoundary: 'dry-run',
  dryRunInputChannel: 'dry-run-input-channel',
  darwinExecutorBoundary: 'darwin-system-events-generic-gui-executor',
  darwinInputProvider: 'macos-cgevent-system-events',
  unresolvedWindowLockId: 'unresolved-window-target',
  sharedSystemInputLockId: 'shared-system-input',
  visualPointerShape: 'cyan-diamond-magenta-outline-white-crosshair',
} as const;

export const computerUsePointerKeyboardOwnershipIds = {
  dryRun: 'virtual-dry-run-channel',
  independentAdapter: 'sciforge-independent-input-adapter',
  sharedSystem: 'shared-system-pointer-keyboard',
  unavailable: 'unavailable',
} as const;

export const computerUsePointerModeIds = {
  dryRun: 'virtual-no-user-pointer-movement',
  independentAdapter: 'adapter-window-bound-pointer',
  sharedSystem: 'system-cursor-events',
  none: 'none',
} as const;

export const computerUseKeyboardModeIds = {
  dryRun: 'virtual-no-user-keyboard-events',
  independentAdapter: 'adapter-window-bound-keyboard',
  sharedSystem: 'system-key-events',
  none: 'none',
} as const;

export const computerUseExecutorLockScopeIds = {
  independentAdapter: 'independent-adapter-session',
  sharedSystem: 'global-shared-system-input',
  targetWindow: 'target-window',
  displayFallback: 'display-fallback',
} as const;

export const computerUseIndependentInputAdapters = [
  'remote-desktop-session',
  'virtual-hid-device',
] as const;

export function computerUseExecutorBoundary(desktopPlatform: string) {
  if (isComputerUseDarwinPlatform(desktopPlatform)) return computerUseInputPolicyIds.darwinExecutorBoundary;
  return `${sanitizeComputerUsePolicyId(desktopPlatform).toLowerCase()}-generic-gui-executor`;
}

export function computerUseInputExecutor(options: { desktopPlatform: string; dryRun?: boolean }) {
  return options.dryRun ? computerUseInputPolicyIds.dryRunExecutor : computerUseExecutorBoundary(options.desktopPlatform);
}

export function computerUseInputProvider(options: {
  desktopPlatform: string;
  dryRun?: boolean;
  independentAdapter?: ComputerUseIndependentInputAdapter;
  independentAdapterReady?: boolean;
}) {
  if (options.dryRun) return computerUseInputPolicyIds.dryRunInputChannel;
  if (options.independentAdapter && options.independentAdapterReady) return `${options.independentAdapter}-input-adapter`;
  if (options.independentAdapter) return `${options.independentAdapter}-input-adapter-unimplemented`;
  if (isComputerUseDarwinPlatform(options.desktopPlatform)) return computerUseInputPolicyIds.darwinInputProvider;
  return `${options.desktopPlatform}-input-provider-unavailable`;
}

export function computerUseRealInputBlockReason(options: {
  actionType: string;
  desktopPlatform: string;
  dryRun?: boolean;
  inputAdapter?: string;
  allowSharedSystemInput?: boolean;
}) {
  if (options.dryRun || !computerUseActionRequiresPointerKeyboardInput(options.actionType)) return '';
  const independentAdapter = normalizeComputerUseIndependentInputAdapter(options.inputAdapter);
  if (independentAdapter) {
    return [
      `Independent input adapter "${independentAdapter}" is configured, but no executable adapter provider is registered in this runtime.`,
      'Failing closed before sending macOS CGEvent/System Events input so SciForge does not move the user pointer or type on the user keyboard while claiming independent input.',
    ].join(' ');
  }
  if (!options.allowSharedSystemInput) {
    return [
      'Real Computer Use action blocked before execution because no independent input adapter is available and shared system mouse/keyboard input was not explicitly allowed.',
      'Configure a real independent input adapter provider, or set SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT=1 only for an acknowledged focused-window smoke.',
    ].join(' ');
  }
  return '';
}

export function computerUseActionRequiresPointerKeyboardInput(actionType: string) {
  return actionType !== 'wait' && actionType !== 'open_app';
}

export function computerUseUsesSharedSystemInput(options: {
  desktopPlatform: string;
  dryRun?: boolean;
  inputAdapter?: string;
  allowSharedSystemInput?: boolean;
}) {
  return !options.dryRun
    && isComputerUseDarwinPlatform(options.desktopPlatform)
    && !normalizeComputerUseIndependentInputAdapter(options.inputAdapter)
    && Boolean(options.allowSharedSystemInput);
}

export function computerUseInputChannelContract(options: {
  desktopPlatform: string;
  dryRun?: boolean;
  inputAdapter?: string;
  independentAdapterReady?: boolean;
  allowSharedSystemInput?: boolean;
  showVisualCursor?: boolean;
  targetResolved: boolean;
  targetBound: boolean;
  isolation: ComputerUseInputIsolation;
  executorLockId: string;
}) {
  const dryRun = Boolean(options.dryRun);
  const configuredIndependentAdapter = normalizeComputerUseIndependentInputAdapter(options.inputAdapter);
  const independentAdapterReady = Boolean(options.independentAdapterReady);
  const independentInput = !dryRun && Boolean(configuredIndependentAdapter) && independentAdapterReady;
  const sharedSystemAllowed = Boolean(options.allowSharedSystemInput);
  const sharedSystemInput = computerUseUsesSharedSystemInput(options);
  const strictTarget = options.targetBound && options.isolation === 'require-focused-target';
  const provider = computerUseInputProvider({
    desktopPlatform: options.desktopPlatform,
    dryRun,
    independentAdapter: configuredIndependentAdapter,
    independentAdapterReady,
  });
  const userDeviceImpact = dryRun || independentInput
    ? 'none'
    : configuredIndependentAdapter
      ? 'fail-closed-unimplemented-independent-adapter'
      : strictTarget
        ? 'may-use-system-input-after-focused-target-verification'
        : 'may-affect-frontmost-window';
  return {
    type: computerUseInputPolicyIds.actionType,
    executor: independentInput ? provider : computerUseInputExecutor({ desktopPlatform: options.desktopPlatform, dryRun }),
    executorBoundary: independentInput ? provider : dryRun ? computerUseInputPolicyIds.dryRunBoundary : computerUseExecutorBoundary(options.desktopPlatform),
    provider,
    isolation: options.isolation,
    targetBound: options.targetBound,
    pointerKeyboardOwnership: dryRun
      ? computerUsePointerKeyboardOwnershipIds.dryRun
      : independentInput
        ? computerUsePointerKeyboardOwnershipIds.independentAdapter
        : sharedSystemInput
          ? computerUsePointerKeyboardOwnershipIds.sharedSystem
          : computerUsePointerKeyboardOwnershipIds.unavailable,
    pointerMode: dryRun
      ? computerUsePointerModeIds.dryRun
      : independentInput
        ? computerUsePointerModeIds.independentAdapter
        : sharedSystemInput
          ? computerUsePointerModeIds.sharedSystem
          : computerUsePointerModeIds.none,
    keyboardMode: dryRun
      ? computerUseKeyboardModeIds.dryRun
      : independentInput
        ? computerUseKeyboardModeIds.independentAdapter
        : sharedSystemInput
          ? computerUseKeyboardModeIds.sharedSystem
          : computerUseKeyboardModeIds.none,
    visualPointer: dryRun ? 'virtual-trace-only' : options.showVisualCursor ? 'sciforge-distinct-overlay-cursor' : 'off',
    visualPointerShape: options.showVisualCursor ? computerUseInputPolicyIds.visualPointerShape : undefined,
    executorLockScope: independentInput
      ? computerUseExecutorLockScopeIds.independentAdapter
      : sharedSystemInput
        ? computerUseExecutorLockScopeIds.sharedSystem
        : options.targetBound
          ? computerUseExecutorLockScopeIds.targetWindow
          : computerUseExecutorLockScopeIds.displayFallback,
    executorLockId: options.executorLockId,
    userDeviceImpact,
    independentAdapterRequiredForNoUserImpact: !dryRun && !independentInput,
    availableIndependentAdapters: [...computerUseIndependentInputAdapters],
    currentIndependentAdapter: dryRun ? 'dry-run' : configuredIndependentAdapter ?? 'not-configured',
    independentAdapterStatus: dryRun ? 'dry-run' : independentInput ? 'ready' : configuredIndependentAdapter ? 'configured-unimplemented' : 'not-configured',
    sharedSystemInputExplicitlyAllowed: !dryRun && !independentInput ? sharedSystemAllowed : undefined,
    failClosed: !options.targetResolved
      || (options.isolation === 'require-focused-target' && !options.targetBound)
      || (!dryRun && Boolean(configuredIndependentAdapter) && !independentAdapterReady)
      || (!dryRun && !configuredIndependentAdapter && !sharedSystemAllowed),
    highRiskConfirmationRequired: true,
    policy: [
      'Planner and Grounder may run in parallel from screenshots.',
      'Real GUI input must acquire the scheduler lock first.',
      'If an independent adapter is unavailable, strict target focus and explicit shared-system-input acknowledgement are required before shared system input.',
      'High-risk send/delete/pay/authorize/publish/submit actions require upstream confirmation before executor.',
    ],
  };
}

export function computerUseInputChannelDescription(options: {
  contract: Record<string, unknown>;
  targetResolved: boolean;
  captureKind?: ComputerUseCaptureKind;
  coordinateSpace?: ComputerUseCoordinateSpace;
  inputIsolation: ComputerUseInputIsolation;
}) {
  const executor = String(options.contract.executorBoundary ?? options.contract.executor ?? 'unknown-executor');
  if (!options.targetResolved) return `${computerUseInputPolicyIds.actionType}:${executor}:blocked-unresolved-window-target`;
  return [
    String(options.contract.type ?? computerUseInputPolicyIds.actionType),
    executor,
    options.captureKind === 'window' ? 'target-window' : 'display',
    isComputerUseWindowLocalCoordinateSpace(options.coordinateSpace) ? 'window-relative-grounding' : 'screen-relative-grounding',
    options.inputIsolation,
  ].join(':');
}

export function computerUseSchedulerStepMetadata(options: {
  targetResolved: boolean;
  stepId: string;
  lockId: string;
  lockScope: 'shared-system-input' | 'target-window' | 'display-fallback';
  captureKind?: ComputerUseCaptureKind;
  inputIsolation?: ComputerUseInputIsolation;
  focused?: boolean;
  minimized?: boolean;
  occluded?: boolean;
  captureTimestamp?: string;
  sharedSystemInput?: boolean;
  targetBound?: boolean;
  strictFocus?: boolean;
  reason?: string;
  diagnostics?: string[];
}) {
  if (!options.targetResolved) {
    return {
      mode: 'blocked',
      stepId: options.stepId,
      lockId: computerUseInputPolicyIds.unresolvedWindowLockId,
      lockScope: 'none',
      actionConcurrency: 'blocked-unresolved-window-target',
      analysisConcurrency: 'parallel-allowed',
      focusPolicy: 'fail-closed-before-action',
      interferenceRisk: 'blocked',
      reason: options.reason,
      diagnostics: options.diagnostics ?? [],
    };
  }
  return {
    mode: 'serialized-window-actions',
    stepId: options.stepId,
    lockId: options.lockId,
    lockScope: options.lockScope,
    actionConcurrency: computerUseActionConcurrency(options),
    analysisConcurrency: 'planner-grounder-verifier-may-run-in-parallel-before-executor-lock',
    captureKind: options.captureKind,
    inputIsolation: options.inputIsolation,
    focusPolicy: options.strictFocus ? 'require-focused-target-before-action' : 'best-effort-focus',
    failClosedIsolation: Boolean(options.strictFocus),
    interferenceRisk: computerUseInterferenceRisk(options),
    windowLifecycle: {
      focused: options.focused,
      minimized: options.minimized,
      occluded: options.occluded,
      captureTimestamp: options.captureTimestamp,
    },
  };
}

export function computerUseSchedulerRunMetadata(options: {
  targetResolved: boolean;
  lockId: string;
  lockScope: 'shared-system-input' | 'target-window' | 'display-fallback';
  sharedSystemInput?: boolean;
  targetBound?: boolean;
  strictFocus?: boolean;
  diagnostics?: string[];
}) {
  if (!options.targetResolved) {
    return {
      mode: 'blocked',
      lockId: computerUseInputPolicyIds.unresolvedWindowLockId,
      lockScope: 'none',
      policy: 'do not execute real GUI actions until WindowTarget resolves to an isolated target window',
      actionConcurrency: 'blocked-unresolved-window-target',
      analysisConcurrency: 'parallel-allowed',
      focusPolicy: 'fail-closed-before-action',
      interferenceRisk: 'blocked',
      diagnostics: options.diagnostics ?? [],
    };
  }
  return {
    mode: 'serialized-window-actions',
    lockId: options.lockId,
    lockScope: options.lockScope,
    policy: options.sharedSystemInput
      ? 'one real GUI action stream globally while using shared system mouse/keyboard; planner/grounder/verifier analysis may run in parallel before the executor lock'
      : 'one real GUI action stream per target window; planner/grounder/verifier analysis may run in parallel before the executor lock',
    actionConcurrency: computerUseActionConcurrency(options),
    analysisConcurrency: 'parallel-allowed',
    focusPolicy: options.strictFocus ? 'require-focused-target-before-action' : 'best-effort-focus',
    failClosedIsolation: Boolean(options.strictFocus),
    interferenceRisk: computerUseInterferenceRisk(options),
  };
}

export function normalizeComputerUseIndependentInputAdapter(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!normalized) return undefined;
  if (normalized === 'virtual-hid' || normalized === 'virtual-hid-device') return 'virtual-hid';
  if (normalized === 'remote-desktop' || normalized === 'remote-desktop-session') return 'remote-desktop';
  return undefined;
}

export function normalizeComputerUseWindowTargetMode(value: string | undefined, target: { windowId?: number; appName?: string; title?: string }): ComputerUseWindowTargetMode {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'display' || normalized === 'screen') return 'display';
  if (normalized === 'active' || normalized === 'active_window' || normalized === 'frontmost') return 'active-window';
  if (normalized === 'window' || normalized === 'window_id' || normalized === 'id') return 'window-id';
  if (normalized === 'app' || normalized === 'app_window' || normalized === 'application') return 'app-window';
  if (target.windowId !== undefined) return 'window-id';
  if (target.appName || target.title) return 'app-window';
  return 'display';
}

export function normalizeComputerUseCoordinateSpace(value: string | undefined, mode: ComputerUseWindowTargetMode): ComputerUseCoordinateSpace {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'screen' || normalized === 'global') return 'screen';
  if (normalized === 'window-local' || normalized === 'window_local' || normalized === 'local') return 'window-local';
  if (normalized === 'window' || normalized === 'target-window' || normalized === 'target') return 'window';
  return mode === 'display' ? 'screen' : 'window';
}

export function normalizeComputerUseInputIsolation(value: string | undefined, required: boolean): ComputerUseInputIsolation {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'require_focused_target' || normalized === 'strict' || normalized === 'required') return 'require-focused-target';
  if (normalized === 'best_effort' || normalized === 'off' || normalized === 'none') return 'best-effort';
  return required ? 'require-focused-target' : 'best-effort';
}

export function isComputerUseWindowLocalCoordinateSpace(value: string | undefined) {
  return value === 'window' || value === 'window-local';
}

export function computerUseSchedulerLockIdForTarget(target: { mode: string; appName?: string; title?: string }, resolvedId: string | number) {
  return sanitizeComputerUsePolicyId([
    'vision-window',
    target.mode,
    resolvedId,
    target.appName,
    target.title,
  ].filter((part) => part !== undefined && part !== '').join('-')).toLowerCase();
}

export function computerUseSystemEventsResultLine(actionType: string, showVisualCursor?: boolean) {
  return `system-events ${actionType} visualCursor=${showVisualCursor ? 'not-shown-system-events-primary' : 'off'}`;
}

export function computerUseVisibleArtifactGapReason(
  task: string,
  executedActions: Array<{ type: string; text?: string }>,
  options: { finalAttempt?: boolean } = {},
) {
  if (!computerUseRequiresVisibleArtifact(task)) return '';
  const hasOnlyBootstrapActions = executedActions.every((action) => action.type === 'open_app' || action.type === 'wait');
  if (hasOnlyBootstrapActions) {
    return options.finalAttempt
      ? 'Visible artifact task did not satisfy completion acceptance: app/window bootstrap finished without visible content entry or structure-edit actions.'
      : '';
  }
  if (options.finalAttempt && requiresRichComputerUseArtifactContent(task)) {
    const typedTexts = executedActions
      .filter((action) => action.type === 'type_text')
      .map((action) => String(action.text ?? '').trim())
      .filter((text) => text && !looksLikeComputerUseNavigationText(text));
    const totalTypedChars = typedTexts.join('\n').length;
    const hasChunkedContent = typedTexts.length >= 2 || typedTexts.some((text) => /[\n\r]|(?:^|\n)\s*[-*•]/.test(text));
    if (totalTypedChars < 60 || !hasChunkedContent) {
      return 'Visible artifact task did not satisfy completion acceptance: rich slide/facts tasks require visible non-navigation body text entry before completion.';
    }
  }
  const hasContentEntry = executedActions.some((action) => action.type === 'type_text' || action.type === 'click' || action.type === 'press_key' || action.type === 'hotkey');
  if (!hasContentEntry) {
    return 'Visible artifact task did not satisfy completion acceptance: no visible content entry or structure-edit action was executed after app/window bootstrap.';
  }
  return options.finalAttempt
    ? 'Visible artifact task did not satisfy completion acceptance: no current visible final artifact/report ref was produced or displayed.'
    : '';
}

export function computerUseRequiresVisibleArtifact(task: string) {
  const text = String(task || '');
  if (!text.trim()) return false;
  if (looksLikeInlineTextEntryArtifactTask(text) && !explicitFinalArtifactIntent(text)) return false;
  return /(?:create|make|produce|generate|write|draft|build|export|生成|制作|创建|写出|草拟|导出).{0,60}(?:slide|ppt|presentation|deck|artifact|document|docx?|report|summary|index|file|brief|文稿|幻灯片|演示|产物|文档|报告|总结|汇总|索引|文件|简报)/i.test(text)
    || /(?:save|保存).{0,60}(?:artifact|report|summary|index|brief|ppt|presentation|deck|产物|报告|总结|汇总|索引|简报|幻灯片|演示)/i.test(text)
    || explicitFinalArtifactIntent(text)
    || /(?:trace summary|evidence summary|action mapping|field evidence|control evidence|visual evidence (?:summary|refs?|report)|refs-first report|字段证据|控件证据|视觉证据(?:总结|汇总|引用|报告)|动作映射|证据总结|证据汇总|引用报告)/i.test(text);
}

function explicitFinalArtifactIntent(text: string) {
  return /(?:final[-\s]?artifact|l2-artifact-refs|l3-workflow-refs|visible[-\s]?artifact|gui\.present.{0,40}artifact|report artifact|final report|artifact evidence|最终文件|最终产物|可见产物|报告产物)/i.test(text);
}

function looksLikeInlineTextEntryArtifactTask(text: string) {
  return /(?:write|draft|type|enter|输入|填写|写入|草拟).{0,80}(?:summary|report|brief|总结|报告|简报).{0,80}(?:(?:in|into|inside|to)\s+(?:the\s+)?(?:comment box|comment field|comment|field|input|textbox|text box|form field|message box|chat box)|(?:在|到|进).{0,8}(?:评论框|评论区|字段|输入框|文本框|表单|消息框|聊天框))/i.test(text);
}

export function computerUseTextEntryContextBlockReason(options: {
  actionType: string;
  text?: string;
  targetAppName?: string;
  targetTitle?: string;
  observationSummary?: string;
  visibleTexts?: string[];
}) {
  if (options.actionType !== 'type_text') return '';
  const text = String(options.text ?? '').trim();
  if (!looksLikeComputerUseFilePathText(text)) return '';
  const context = [
    options.targetAppName,
    options.targetTitle,
    options.observationSummary,
    ...(options.visibleTexts ?? []),
  ].filter(Boolean).join(' ');
  if (looksLikeComputerUseFileDialogContext(context)) return '';
  return [
    'Filesystem path text entry blocked because the current target window does not look like a save/open/file dialog.',
    'Use visible Save As or file-dialog controls first; do not type file paths into document or slide editor canvases.',
  ].join(' ');
}

export function computerUseActionObservationContextBlockReason(options: {
  actionType: string;
  text?: string;
  targetDescription?: string;
  targetRegionDescription?: string;
  targetAppName?: string;
  targetTitle?: string;
  observationRef?: string;
  observationSummary?: string;
  visibleTexts?: string[];
  visibleTextExtractionEnabled?: boolean;
}) {
  const textEntryBlock = computerUseTextEntryContextBlockReason(options);
  if (textEntryBlock) return textEntryBlock;
  return computerUseTargetEvidenceBlockReason(options);
}

export function computerUseTargetEvidenceBlockReason(options: {
  actionType: string;
  targetDescription?: string;
  targetRegionDescription?: string;
  targetAppName?: string;
  targetTitle?: string;
  observationSummary?: string;
  visibleTexts?: string[];
  visibleTextExtractionEnabled?: boolean;
}) {
  if (!['click', 'double_click', 'drag'].includes(options.actionType)) return '';
  if (options.visibleTextExtractionEnabled === false) return '';
  const target = [
    options.targetDescription,
    options.targetRegionDescription,
  ].filter(Boolean).join(' ');
  if (!target || !looksLikeComputerUseVisibleTextRequiredFileTarget(target)) return '';
  const evidence = [
    options.targetAppName,
    options.targetTitle,
    options.observationSummary,
    ...(options.visibleTexts ?? []),
  ].filter(Boolean).join(' ');
  if (looksLikeComputerUseFileDialogContext(evidence) || targetVisibleInComputerUseEvidence(target, evidence)) return '';
  return [
    'File/save target blocked because the current compact observation does not show that target or a save/open/file dialog.',
    'Do not infer File, Save As, Browse, filename/path, or location controls from prior clicks; use only controls visible in the current target observation.',
  ].join(' ');
}

function requiresRichComputerUseArtifactContent(task: string) {
  return /\b(?:three|3)\b|facts?|points?|bullets?|body text|要点|事实|正文/i.test(task);
}

function looksLikeComputerUseNavigationText(text: string) {
  return /^(?:https?:\/\/|file:\/\/|www\.)/i.test(text)
    || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|$)/.test(text);
}

function looksLikeComputerUseFilePathText(text: string) {
  return /^(?:\/|~\/|[A-Za-z]:[\\/])/.test(text)
    || /\.(?:pptx?|key|pdf|docx?|xlsx?|txt|md|csv|png|jpe?g|json)$/i.test(text);
}

function looksLikeComputerUseFileDialogContext(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  const withoutAutosave = compact.replace(/\bauto\s*save\b/gi, '').replace(/自动保存/g, '');
  return /save as|open|choose|file dialog|filename|file name|where|location|folder|finder|访达|另存|打开|选取|选择|文件名|位置|文件夹/i.test(withoutAutosave)
    || /\bsave\b/i.test(withoutAutosave);
}

function looksLikeComputerUseVisibleTextRequiredFileTarget(text: string) {
  return /(?:\bfile\b.{0,16}\b(?:tab|menu|ribbon|option|pane)\b)|(?:\b(?:save as|browse|filename|file name|path field|location field|where field)\b)|(?:\b(?:file dialog|save dialog|open dialog|choose dialog)\b)|(?:文件.{0,8}(?:选项|标签|菜单|功能区))|(?:另存为|浏览|文件名|路径栏|路径字段|位置栏|位置字段)/i.test(text);
}

function targetVisibleInComputerUseEvidence(target: string, evidence: string) {
  const targetLower = target.toLowerCase();
  const evidenceLower = evidence.toLowerCase();
  const candidates = [
    'file',
    'save as',
    'browse',
    'filename',
    'file name',
    'path',
    'location',
    'where',
    '文件',
    '另存为',
    '浏览',
    '文件名',
    '路径',
    '位置',
  ].filter((candidate) => targetLower.includes(candidate.toLowerCase()));
  return candidates.some((candidate) => evidenceLower.includes(candidate.toLowerCase()));
}

export function isComputerUseDarwinPlatform(value: string | undefined) {
  return /^(darwin|mac|macos|osx)$/i.test((value ?? '').trim());
}

function computerUseActionConcurrency(options: { sharedSystemInput?: boolean; targetBound?: boolean }) {
  return options.sharedSystemInput
    ? 'one-real-gui-action-at-a-time-globally-for-shared-system-input'
    : options.targetBound
      ? 'one-real-gui-action-at-a-time-per-window'
      : 'one-real-gui-action-at-a-time-per-display';
}

function computerUseInterferenceRisk(options: { sharedSystemInput?: boolean; targetBound?: boolean; strictFocus?: boolean }) {
  return options.sharedSystemInput
    ? 'serialized-global-shared-system-input-may-still-affect-user-devices'
    : options.targetBound && options.strictFocus
      ? 'low-when-focused-target-verified'
      : 'elevated-display-or-best-effort-isolation';
}

function sanitizeComputerUsePolicyId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'vision-run';
}
