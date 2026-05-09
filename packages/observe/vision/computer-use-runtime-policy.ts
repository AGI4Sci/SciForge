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

export const visionSensePlannerPromptPolicy = {
  domainTaskInstructions: [
    'For low-risk settings, preferences, and form-control coverage tasks, use the visible current window first. Cover distinct visible controls with conservative interactions such as text input, menu/dropdown expansion, toggle/checkbox checks, button/cancel/close clicks, and scrolling; once run history shows broad low-risk coverage, report done=true instead of continuing to explore unrelated controls.',
    'For text-entry tasks, clicking a visible text field, text box, or placeholder may have no visible pixel change. After one such click, if the requested text is known from the task and the screenshot still shows the target field, use type_text next instead of repeatedly clicking.',
    'If the current screenshot already contains an appropriate text placeholder for requested literal text, prefer activating that placeholder and type_text. Do not detour into toolbar/ribbon insertion controls just to create another text box unless no usable placeholder is visible.',
    'For slide or document layout tasks, visible title/subtitle/body placeholders are valid text boxes and can satisfy text-box requirements. Prefer filling existing placeholders with structured text before using toolbar/ribbon controls for new objects.',
    'For low-risk document or slide creation tasks, stop once the screenshot plus run history show an opened editor/canvas and visible typed content that matches the requested artifact. Do not keep polishing layout, font size, placeholder remnants, or visual alignment unless the task explicitly asks for those details.',
    'If requested title/body text is already visible in a selected placeholder or text box, report done=true instead of retyping the same text or creating another text box.',
    'If run history shows toolbar-or-ribbon actions with no-visible-effect=true, avoid toolbar/ribbon/menu controls in the next action. Work with the visible document/canvas content instead, or report done=true if the visible state already satisfies the task.',
  ],
} as const;

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
