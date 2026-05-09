export const visionSenseTraceIds = {
  tool: 'local.vision-sense',
  runtime: 'vision-sense-generic-computer-use-loop',
  workspaceRuntime: 'sciforge.workspace-runtime.vision-sense-generic-loop',
  trace: 'vision-sense-trace',
  traceKind: 'vision-trace',
  traceSchema: 'sciforge.vision-trace.v1',
  execution: 'vision-sense-generic-execution',
} as const;

export const visionSenseRuntimeEventTypes = {
  runtimeSelected: 'vision-sense-runtime-selected',
  genericAction: 'vision-sense-generic-action',
} as const;

export const visionSenseCompletionPolicyModes = {
  oneSuccessfulNonWaitAction: 'one-successful-non-wait-action',
} as const;

export const visionSenseGroundingIds = {
  windowCrossDisplayDrag: 'window-cross-display-drag',
  targetDescriptionWindowCenter: 'target-description-window-center',
  coarseToFine: 'coarse-to-fine',
  coarseToFineFocusRegion: 'coarse-to-fine-focus-region',
  kvGround: 'kv-ground',
  openAiCompatibleVisionGrounder: 'openai-compatible-vision-grounder',
} as const;

export function visionSenseFocusRegionGroundingId(base: unknown) {
  return `${String(base || 'grounder')}-focus-region`;
}

export const visionSenseSafetyVerifierContract = {
  senseBoundary: 'text-signal-only',
  actionOwner: 'packages/actions/computer-use',
  highRiskPolicy: 'reject-unless-explicitly-confirmed-upstream',
  verifierRefs: ['vision-trace', 'before-after-screenshot-refs', 'window-consistency', 'pixel-diff'],
} as const;

export const visionSenseTraceContractPolicy = {
  imageMemory: {
    policy: 'file-ref-only',
    reason: 'Multi-turn memory keeps screenshot paths, hashes, dimensions, and display ids; it never stores inline image payloads.',
  },
  genericActionSchema: ['open_app', 'click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait'],
  appSpecificShortcuts: [] as string[],
  coordinateContract(executorCoordinateSpace: string | undefined) {
    return {
      planner: 'target descriptions only',
      grounderOutput: 'target-window screenshot coordinates',
      executorInput: executorCoordinateSpace || 'window',
      localCoordinateFrame: 'window screenshot pixels before executor mapping',
      mappedCoordinateFrame: 'desktop executor coordinates after window-origin and scale mapping',
    };
  },
  verifierContract: {
    screenshotScope: 'target-window',
    beforeAfterWindowConsistency: 'required-or-structured-window-lifecycle-diagnostics',
    completionEvidence: 'window-local screenshots plus pixel diff, no DOM/accessibility',
  },
  requires: ['WindowTargetProvider', 'VisionPlanner', 'Grounder', 'GuiExecutor', 'Verifier'],
  visualFocus: {
    strategy: visionSenseGroundingIds.coarseToFineFocusRegion,
    algorithmProvider: 'sciforge_vision_sense.coarse_to_fine',
  },
} as const;

export const visionSensePlannerOnlyEvidencePolicy = {
  plannerId: 'vision-sense-policy-planner',
  verifierReason: 'vision-sense policy planner completed a file-ref-only evidence task without GUI actions',
  rawReason: 'Task asks for refs-only evidence, summary, handoff, or context audit; GUI execution is unnecessary.',
} as const;

export const visionSenseTraceOutputPolicy = {
  successClaim: 'SciForge executed generic Computer Use actions and wrote file-ref-only visual memory.',
  selectedRuntimeReason: 'local.vision-sense was selected and routed to the generic Computer Use loop.',
  genericActionSchemaReason: 'The runtime uses app-agnostic screenshot refs and generic mouse/keyboard action schema.',
  noAppSpecificShortcutReason: 'No app-specific shortcut or AgentServer repository scan was used.',
  requiredInputs: visionSenseTraceContractPolicy.requires,
  recoverActions: [
    'Provide a generic VisionPlanner that emits the action schema recorded in the trace.',
    'Configure KV-Ground or another Grounder so target descriptions become target-window coordinates.',
    'Keep app-specific APIs out of the primary path; only mouse/keyboard executor actions should be required.',
  ],
  bridgeRecoverActions: [
    'Enable the generic desktop bridge with SCIFORGE_VISION_DESKTOP_BRIDGE=1 or .sciforge/config.json visionSense.desktopBridgeEnabled=true.',
    'Configure capture displays with SCIFORGE_VISION_CAPTURE_DISPLAYS=1,2 or visionSense.captureDisplays.',
    'Provide a planner/grounder that emits app-agnostic mouse and keyboard actions.',
  ],
} as const;

export const visionSensePlannerPromptPolicy = {
  buildSystemPrompt(options: {
    environmentDescription: string;
    windowTargetDescription: string;
    capturedTargetDescription: string;
    plannerImageDescription: string;
    applicationGuidance: string;
    desktopPlatform: string;
    platformRecoveryGuidance: string;
    extraInstruction?: string;
  }) {
    return [
      'You are SciForge VisionPlanner for generic Computer Use.',
      'Return only JSON. Do not read DOM or accessibility. Do not output application-private APIs, scripts, selectors, files, or shortcuts that depend on one app.',
      `Execution environment: ${options.environmentDescription}.`,
      `Window target contract: ${options.windowTargetDescription}.`,
      `Current captured target: ${options.capturedTargetDescription}.`,
      options.plannerImageDescription,
      options.applicationGuidance,
      `Use only keys and modifiers supported by desktopPlatform="${options.desktopPlatform}". Do not use keys from another operating system family.`,
      options.platformRecoveryGuidance,
      'When an app must be opened, prefer open_app with appName. Only open or switch apps when the task explicitly asks to launch/open/switch applications; for current-screen/current-window tasks, operate within the supplied target window.',
      'For file manager tasks, prefer open_app for the platform file manager (Finder on macOS, File Explorer on Windows) before interacting with files. Do not cycle through applications with repeated app-switch hotkeys to find a file manager.',
      'For browser-hosted target windows, the target application content area excludes browser chrome: tab strip, address bar, bookmarks bar, toolbar buttons, extension buttons, and extension popups. Do not target browser chrome unless the task explicitly asks for browser chrome.',
      'For browser research tasks, if the screenshot already shows results or an article/content page related to the requested topic, do not restart the search or edit a search field. Continue with visible result links, page content, scrolling, back navigation, or tab/window switching as generic GUI actions.',
      'Do not describe body text or selected article text as a search input field unless a visible input box boundary, caret, placeholder, or search control is present at that location.',
      'If an unrelated browser extension, permission, save, login, or external-service dialog appears, use Escape or a visible Cancel/Close button once, then return to the target application content. Do not click Retry, Enable, Authorize, Save, Submit, Send, Delete, or Login in unrelated dialogs.',
      'If the supplied screenshot is a transient menu, popover, palette, gallery, or dropdown window, interact only with visible items inside that transient window. If the next needed target is in the underlying document/app window and is not visible in the captured target, use press_key Escape or a visible close/cancel control to dismiss the transient window first.',
      'If the screenshot shows a document/template/gallery chooser and a template or item is already visibly selected, do not click the selected thumbnail again. Use the visible Create/New/Open/OK button, or use Cancel/Escape only when the task needs to leave the chooser.',
      'For visual targets, output targetDescription text only; never output x/y/fromX/fromY/toX/toY coordinates. Coordinates are produced by the Grounder in the target-window screenshot coordinate system.',
      'Planner screenshots may be budget-scaled for model latency. Do not infer exact pixel coordinates from them; describe visual targets semantically and let the Grounder use the original window screenshot.',
      'For dense UI, small icons, table rows, menus, dialogs, or ambiguous regions, include targetRegionDescription to name the larger visual region to inspect first; the runtime will crop that region and run a second fine Grounder inside it before execution.',
      'You may output wait with targetRegionDescription when the next step should be local observation only; the runtime will record focusRegion evidence and replan from the updated run history.',
      'Do not put pixel boxes in focusRegion unless it was copied from prior run history; prefer targetRegionDescription text so vision-sense can choose and clip the focus region.',
      `Allowed action types: ${visionSenseTraceContractPolicy.genericActionSchema.join(', ')}.`,
      'Do not emit unsupported actions such as right_click, context_click, context_menu, menu_select, rename, move_file, copy_file, or app-private commands. For rename/move workflows, use only visible clicks, double_click, drag, type_text, press_key, open_app, scroll, or platform recovery hotkeys.',
      'Hotkeys are allowed only for platform-level recovery such as app/window switching or launcher activation. Do not use app-specific or browser-specific shortcuts such as new tab, address bar focus, refresh, save, close tab, copy, paste, bold, or menu commands; use visible controls and generic typing/clicking instead.',
      'Return {"done": boolean, "reason": string, "actions": [...]}. Set done=true only when the supplied screenshot shows the requested GUI task is complete; otherwise return exactly one next generic action. Include a short wait after that action only when the GUI needs time to settle.',
      'Use the run history to avoid repeating completed actions. If the task is a low-risk recovery/observation task and at least one requested non-wait action has already executed with verifier evidence, set done=true with actions=[] unless the screenshot clearly shows another required unfinished step.',
      'If run history marks a click or double_click target as no-visible-effect=true and the current screenshot is unchanged, do not repeat the same mouse action on the same target. Choose a different visible generic GUI route or a different generic input modality that the screenshot supports.',
      ...this.domainTaskInstructions,
      'The supplied screenshot is the observation state. Do not use wait as the only action to request another observation.',
      this.highRiskActionInstruction,
      options.extraInstruction,
    ].filter(Boolean).join(' ');
  },
  buildUserPrompt(task: string, runHistory?: string) {
    return `Task: ${task}\n${runHistory ? `Run history:\n${runHistory}\n` : ''}Return {"done":false,"reason":"...","actions":[one generic next action]} or {"done":true,"reason":"...","actions":[]} when the current screenshot plus run history show the task is complete. Stop before final high-risk actions unless explicitly confirmed by upstream.`;
  },
  buildEmptyActionRetryInstruction(platformRecoveryGuidance: string) {
    return [
      'The current screenshot has already been captured. Do not return an empty action list or wait as the only action unless done=true.',
      `For an underspecified GUI sub-task, choose a conservative non-destructive screen action from the current screenshot, such as scroll on the main visible content, press Escape to dismiss transient overlays, ${platformRecoveryGuidance}, or click a clearly described visible low-risk target.`,
      'Return at least one non-wait action: click, double_click, drag, type_text, press_key, hotkey, or scroll; or set done=true with actions=[] if the task is complete.',
    ].join(' ');
  },
  buildNoEffectRetryInstruction(repeatedRoute: string) {
    return [
      `Your previous action repeats a recent no-visible-effect route: ${repeatedRoute}.`,
      'The Verifier says that route did not visibly change the target window. Do not use the same action type, same targetDescription/targetRegionDescription, or same scroll direction again.',
      'Choose a different visible generic GUI route from the current screenshot, switch input modality, ask for a local observation using wait with a different targetRegionDescription, or set done=true with actions=[] only if the screenshot already satisfies the round goal.',
    ].join(' ');
  },
  noEffectRepeatFailureReason(repeatedRoute: string) {
    return `VisionPlanner repeated a no-visible-effect action route after retry (${repeatedRoute}). The generic planner must choose a different visible route or query a different region before more GUI execution.`;
  },
  highRiskFallbackAction() {
    return {
      type: 'click',
      targetDescription: 'the visible high-risk control requested by the task',
      riskLevel: 'high',
      requiresConfirmation: true,
    } as const;
  },
  buildPlannerRetryInstruction(options: {
    issue?: string;
    environmentDescription: string;
    platformLauncherGuidance: string;
  }) {
    if (options.issue === 'platform-incompatible-action') {
      return [
        'Your previous JSON used an action that cannot be executed in the current operating system.',
        `Rewrite for ${options.environmentDescription} using only supported keys/modifiers and generic visible GUI actions.`,
        options.platformLauncherGuidance,
      ].join(' ');
    }
    if (options.issue === 'empty-message-content') {
      return 'Your previous response had empty final message content. Return only the JSON object in final message content now; do not put the action plan only in reasoning_content, analysis, prose, markdown, or tool calls.';
    }
    if (options.issue === 'unsupported-action') {
      return [
        'Your previous JSON used an unsupported action type. Do not use right_click, context_click, context_menu, menu_select, rename, move_file, or app-private commands.',
        `Rewrite using exactly one supported generic action: ${visionSenseTraceContractPolicy.genericActionSchema.join(', ')}.`,
        'For file rename/move tasks, first select visible files with click/double_click, use visible fields/buttons or generic press_key/type_text when the focused UI supports text entry, and drag only between visible locations.',
      ].join(' ');
    }
    return 'Your previous JSON violated the planner contract by including screen coordinates. Rewrite the plan without x/y/fromX/fromY/toX/toY. Use targetDescription, fromTargetDescription, and toTargetDescription so the Grounder can produce coordinates.';
  },
  platformRecoveryGuidance(desktopPlatform: string) {
    if (/darwin/i.test(desktopPlatform)) {
      return 'use Command+Tab for app/window recovery on macOS; treat task text that says Alt+Tab as the cross-platform intent for Command+Tab on darwin';
    }
    return 'use the platform-native app/window switch hotkey only when the task explicitly asks to switch/recover windows';
  },
  knownGuiApplicationCandidates: [
    { name: 'Microsoft Word', paths: ['/Applications/Microsoft Word.app'] },
    { name: 'Microsoft PowerPoint', paths: ['/Applications/Microsoft PowerPoint.app'] },
    { name: 'Microsoft Excel', paths: ['/Applications/Microsoft Excel.app'] },
    { name: 'Keynote', paths: ['/Applications/Keynote.app', '/System/Applications/Keynote.app'] },
    { name: 'Pages', paths: ['/Applications/Pages.app', '/System/Applications/Pages.app'] },
    { name: 'TextEdit', paths: ['/System/Applications/TextEdit.app', '/Applications/TextEdit.app'] },
    { name: 'Finder', paths: ['/System/Library/CoreServices/Finder.app'] },
  ],
  detectedApplicationGuidance(installed: string[], missing: string[]) {
    return [
      `Detected installed GUI applications for this run: ${installed.length ? installed.join(', ') : 'unknown'}.`,
      missing.length ? `Do not choose these application names unless they are visibly present or explicitly opened by the user: ${missing.join(', ')}.` : '',
    ].filter(Boolean).join(' ');
  },
  domainTaskInstructions: [
    'For low-risk settings, preferences, and form-control coverage tasks, use the visible current window first. Cover distinct visible controls with conservative interactions such as text input, menu/dropdown expansion, toggle/checkbox checks, button/cancel/close clicks, and scrolling; once run history shows broad low-risk coverage, report done=true instead of continuing to explore unrelated controls.',
    'For text-entry tasks, clicking a visible text field, text box, or placeholder may have no visible pixel change. After one such click, if the requested text is known from the task and the screenshot still shows the target field, use type_text next instead of repeatedly clicking.',
    'If the current screenshot already contains an appropriate text placeholder for requested literal text, prefer activating that placeholder and type_text. Do not detour into toolbar/ribbon insertion controls just to create another text box unless no usable placeholder is visible.',
    'For slide or document layout tasks, visible title/subtitle/body placeholders are valid text boxes and can satisfy text-box requirements. Prefer filling existing placeholders with structured text before using toolbar/ribbon controls for new objects.',
    'For low-risk document or slide creation tasks, stop once the screenshot plus run history show an opened editor/canvas and visible typed content that matches the requested artifact. Do not keep polishing layout, font size, placeholder remnants, or visual alignment unless the task explicitly asks for those details.',
    'If requested title/body text is already visible in a selected placeholder or text box, report done=true instead of retyping the same text or creating another text box.',
    'If run history shows toolbar-or-ribbon actions with no-visible-effect=true, avoid toolbar/ribbon/menu controls in the next action. Work with the visible document/canvas content instead, or report done=true if the visible state already satisfies the task.',
  ],
  highRiskActionInstruction: 'High-risk send/delete/pay/authorize/publish/submit actions must be marked riskLevel="high" and requiresConfirmation=true.',
} as const;

export function visionSenseCrossDisplayWindowDragPolicy(params: {
  description: string;
  width: number;
  height: number;
}) {
  const description = params.description || '';
  const isWindowMove = /window|title bar|窗口|标题栏|window frame|traffic light|red, yellow, and green/i.test(description);
  const isCrossDisplay = /display|monitor|screen|另一个显示器|显示器|屏幕|adjacent|left edge|right edge|screen edge|current screen edge/i.test(description);
  if (!isWindowMove || !isCrossDisplay) return undefined;
  const width = Number.isFinite(params.width) && params.width > 0 ? params.width : 800;
  const height = Number.isFinite(params.height) && params.height > 0 ? params.height : 600;
  const fromX = Math.round(width / 2);
  const fromY = Math.max(20, Math.round(Math.min(height * 0.08, 64)));
  const wantsRight = /right|右/i.test(description) && !/left|左/i.test(description);
  return {
    provider: visionSenseGroundingIds.windowCrossDisplayDrag,
    reason: 'Target display is outside the current window screenshot; computed title-bar drag endpoints in window-local coordinates instead of asking the visual Grounder to hallucinate an off-window point.',
    fromX,
    fromY,
    toX: wantsRight ? Math.round(width * 1.35) : Math.round(width * -0.35),
    toY: fromY,
  };
}

const highRiskVisionSenseGuiRequestPattern = /delete|send|pay|authorize|publish|submit|删除|发送|支付|授权|发布|提交|登录授权|外部表单/i;

export function isHighRiskVisionSenseGuiRequest(prompt: string) {
  return highRiskVisionSenseGuiRequestPattern.test(primaryVisionSenseTaskLine(prompt));
}

export function looksLikeVisionSenseComputerUseRequest(prompt: string) {
  const text = prompt.trim();
  if (!text) return false;
  if (/\b(computer\s*use|gui|desktop|screen|screenshot|mouse|keyboard|click|type|scroll|drag)\b/i.test(text)) return true;
  if (/\b(browser|word|powerpoint|ppt)\b/i.test(text) && /\b(open|click|type|scroll|drag|operate|control|use)\b/i.test(text)) return true;
  if (/截图|屏幕|桌面|鼠标|键盘|点击|滚动|拖拽/.test(text)) return true;
  if (/(浏览器|网页|页面|窗口|应用|软件|文档|演示文稿).{0,24}(打开|点击|输入|滚动|拖拽|操作|控制|切换|保存|创建)/.test(text)) return true;
  if (/(打开|点击|输入|滚动|拖拽|操作|控制|切换|保存|创建).{0,24}(浏览器|网页|页面|窗口|应用|软件|文档|演示文稿)/.test(text)) return true;
  return false;
}

export function requestedVisionSenseAppNameForPrompt(prompt: string, aliases: Record<string, string>): string | undefined {
  const primaryTask = primaryVisionSenseTaskLine(prompt);
  const requested = Object.entries(aliases)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([alias]) => alias && visionSensePromptAliasMatches(primaryTask, alias));
  if (requested) return requested[1];
  return undefined;
}

export function parseVisionSenseAppAliases(raw: string | undefined): Record<string, string> {
  if (!raw) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isVisionSenseRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .map(([alias, appName]) => [alias.trim(), typeof appName === 'string' ? appName.trim() : ''])
      .filter(([alias, appName]) => alias && appName)) as Record<string, string>;
  } catch {
    return {};
  }
}

function primaryVisionSenseTaskLine(prompt: string) {
  return (prompt || '').split(/\r?\n/g).map((line) => line.trim()).find(Boolean) || '';
}

function visionSensePromptAliasMatches(task: string, alias: string) {
  if (containsCjk(alias)) return task.includes(alias);
  return new RegExp(`(^|[^A-Za-z0-9_-])${escapeVisionSenseRegExp(alias)}([^A-Za-z0-9_-]|$)`, 'iu').test(task);
}

function containsCjk(value: string) {
  return /[\u3400-\u9FFF]/u.test(value);
}

function escapeVisionSenseRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isVisionSenseRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
