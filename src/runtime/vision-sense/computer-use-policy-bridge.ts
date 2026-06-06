import { isRecord } from '../gateway-utils.js';
import type { LoopStep } from '../computer-use/types.js';

type ComputerUsePolicyRequest =
  | { mode: 'planner-only-evidence-task'; text: string }
  | { mode: 'action-ledger-completion'; task: string; steps: unknown[] };

export type ActionLedgerCompletionPolicy = {
  complete: boolean;
  kind?: string;
  reason?: string;
  semanticSignal?: {
    schemaVersion: 'sciforge.vision-sense.completion-semantic-signal.v1';
    signal: 'action-ledger-completion' | 'action-ledger-incomplete';
    final: true;
    finalComplete: boolean;
    detectorKind?: string;
    evidenceStepCount: number;
  };
};

const PLANNER_ONLY_EVIDENCE_PATTERN = /trace refs?|trace paths?|image memory|artifact|action ledger|failure diagnostics|sha256|displayId|尺寸|文件引用|截图引用|复盘|总结|汇总|回答|报告|handoff|refs?|summary|report/i;
const GUI_ACTION_INTENT_PATTERN = /执行一次|点击|click|scroll|滚动|press_key|hotkey|type_text|输入|drag|拖拽|打开|open_app|切换窗口|切换.*窗口|移动到|恢复|回到|启动|创建|保存|重命名|移动|定位|文件管理器|文字处理|演示应用|幻灯片|文档|Alt\+Tab|Command\+Tab/i;
const HIGH_RISK_GUI_PATTERN = /delete|send|pay|authorize|publish|submit|删除|发送|支付|授权|发布|提交|登录授权|外部表单/i;
const NEGATED_HIGH_RISK_BOUNDARY_PATTERN = /do not\s+(?:click\s+)?(?:submit|save|send|delete|remove|overwrite|authorize|pay|publish|upload)|don't\s+(?:click\s+)?(?:submit|save|send|delete|remove|overwrite|authorize|pay|publish|upload)|without\s+(?:submit|save|send|delete|remove|overwrite|authorize|pay|publish|upload)|不要[^。；;,.，]*?(?:提交|保存|发送|删除|覆盖|授权|支付|发布|上传|外发)|不能[^。；;,.，]*?(?:提交|保存|发送|删除|覆盖|授权|支付|发布|上传|外发)|不(?:提交|保存|发送|删除|覆盖|授权|支付|发布|上传|外发)/i;
const SETTINGS_FORM_INTENT_PATTERN = /settings|preferences|preference|form|controls?|field|input|search|dropdown|menu|checkbox|toggle|button|设置|偏好|表单|控件|字段|输入框|搜索框|下拉|菜单|复选|开关|按钮/i;
const LOW_RISK_BOUNDARY_PATTERN = /low[- ]?risk|cancel|close|do not submit|do not save|不要提交|不要保存|低风险|取消|关闭/i;
const FILE_MANAGER_INTENT_PATTERN = /file manager|finder|file explorer|files?|folders?|directory|rename|move|locate|文件管理器|访达|文件|文件夹|目录|重命名|移动|定位/i;
const DESTRUCTIVE_FILE_PATTERN = /delete|trash|remove|erase|删除|废纸篓|移除|清空/i;
const CREATION_INTENT_PATTERN = /create|write|draft|compose|make|insert|add|document|slide|presentation|text box|shape|创建|撰写|编写|制作|插入|添加|文档|幻灯片|演示|文本框|图形|三栏|结构/i;
const VISIBLE_ARTIFACT_INTENT_PATTERN = /document|slide|presentation|page|text box|shape|title|body|文档|幻灯片|演示|页面|文本框|图形|标题|正文|结构/i;
const VALIDATION_RECOVERY_INTENT_PATTERN = /validation|invalid|no[- ]?result|empty result|error state|clear|correct|校验|无效|无结果|空结果|错误状态|清除|修正/i;
const VALIDATION_LOW_RISK_BOUNDARY_PATTERN = /low[- ]?risk|do not submit|do not save|do not authorize|不要提交|不要保存|不要授权|低风险/i;
const EXPECTED_FAILURE_INTENT_PATTERN = /expected failure|failed-with-reason|non.?existent|unavailable|missing refs?|预期失败|不存在|不可用|失败/i;
const WINDOW_RECOVERY_INTENT_PATTERN = /display|monitor|occlusion|restore|recover|migration|move.*window|window.*(?:restore|recover|move|migration|occlusion)|显示器|遮挡|恢复|迁移|移动目标窗口|窗口.*(?:恢复|迁移|移动|遮挡)/i;

const ACTION_LEDGER_COMPLETION_REASONS: Record<string, string> = {
  'candidate-evidence-screening': 'action-ledger completion policy satisfied for multi-candidate evidence screening',
  'visible-artifact-creation': 'action-ledger completion policy satisfied for a low-risk document/slide creation task',
  'file-manager': 'action-ledger completion policy satisfied for a low-risk file-manager workflow',
  'settings-form': 'action-ledger completion policy satisfied for a low-risk settings/form control workflow',
  'validation-recovery': 'action-ledger completion policy satisfied for a low-risk validation/no-result recovery workflow',
  'expected-failure': 'action-ledger completion policy satisfied for a low-risk expected-failure chat/run workflow',
  'window-recovery': 'action-ledger completion policy satisfied for a window recovery or migration workflow',
};

export async function evaluateComputerUsePolicy(request: ComputerUsePolicyRequest): Promise<unknown | undefined> {
  if (request.mode === 'planner-only-evidence-task') {
    return { plannerOnly: isPlannerOnlyEvidenceTask(request.text) };
  }
  if (request.mode === 'action-ledger-completion') {
    return actionLedgerCompletion(request.task, request.steps.filter(isRecord));
  }
  return undefined;
}

export async function shouldCompleteFromFileRefsOnlyPolicy(text: string) {
  const result = await evaluateComputerUsePolicy({ mode: 'planner-only-evidence-task', text });
  return isRecord(result) && result.plannerOnly === true;
}

export async function actionLedgerCompletionPolicy(task: string, steps: LoopStep[]): Promise<ActionLedgerCompletionPolicy | undefined> {
  const result = await evaluateComputerUsePolicy({
    mode: 'action-ledger-completion',
    task,
    steps: policyStepLedger(steps),
  });
  if (!isRecord(result) || typeof result.complete !== 'boolean') return undefined;
  const semanticSignal = actionLedgerCompletionSemanticSignal(result);
  return {
    complete: semanticSignal?.finalComplete ?? result.complete,
    kind: typeof result.kind === 'string' ? result.kind : undefined,
    reason: typeof result.reason === 'string' ? result.reason : undefined,
    ...(semanticSignal ? { semanticSignal } : {}),
  };
}

function isPlannerOnlyEvidenceTask(text: string): boolean {
  const value = text || '';
  const primary = primaryTaskText(value);
  if (PLANNER_ONLY_EVIDENCE_PATTERN.test(primary) && !GUI_ACTION_INTENT_PATTERN.test(primary)) return true;
  if (GUI_ACTION_INTENT_PATTERN.test(value)) return false;
  return PLANNER_ONLY_EVIDENCE_PATTERN.test(value);
}

function actionLedgerCompletion(task: string, steps: Record<string, unknown>[]): ActionLedgerCompletionPolicy {
  const checks: Array<[string, (task: string, steps: Record<string, unknown>[]) => boolean]> = [
    ['candidate-evidence-screening', shouldCompleteFromCandidateActionLedger],
    ['visible-artifact-creation', shouldCompleteFromCreationActionLedger],
    ['file-manager', shouldCompleteFromFileManagerActionLedger],
    ['settings-form', shouldCompleteFromSettingsFormActionLedger],
    ['validation-recovery', shouldCompleteFromValidationRecoveryActionLedger],
    ['expected-failure', shouldCompleteFromExpectedFailureActionLedger],
    ['window-recovery', shouldCompleteFromWindowRecoveryActionLedger],
  ];
  for (const [kind, check] of checks) {
    if (check(task, steps)) {
      const semanticSignal = buildActionLedgerCompletionSemanticSignal(true, kind, steps);
      // Final completion truth is reduced from this structured ledger signal.
      // Regex/task-name detectors above are bounded evidence for detectorKind only.
      return {
        complete: semanticSignal.finalComplete,
        kind,
        reason: ACTION_LEDGER_COMPLETION_REASONS[kind],
        semanticSignal,
      };
    }
  }
  const semanticSignal = buildActionLedgerCompletionSemanticSignal(false, undefined, steps);
  return { complete: semanticSignal.finalComplete, semanticSignal };
}

function buildActionLedgerCompletionSemanticSignal(
  finalComplete: boolean,
  detectorKind: string | undefined,
  steps: Record<string, unknown>[],
): NonNullable<ActionLedgerCompletionPolicy['semanticSignal']> {
  return {
    schemaVersion: 'sciforge.vision-sense.completion-semantic-signal.v1',
    signal: finalComplete ? 'action-ledger-completion' : 'action-ledger-incomplete',
    final: true,
    finalComplete,
    ...(detectorKind ? { detectorKind } : {}),
    evidenceStepCount: doneGuiSteps(steps, { requireEffect: true }).length,
  };
}

function actionLedgerCompletionSemanticSignal(result: Record<string, unknown>): ActionLedgerCompletionPolicy['semanticSignal'] | undefined {
  const value = isRecord(result.semanticSignal) ? result.semanticSignal : undefined;
  if (!value || value.schemaVersion !== 'sciforge.vision-sense.completion-semantic-signal.v1') return undefined;
  if (value.final !== true || typeof value.finalComplete !== 'boolean') return undefined;
  const signal = value.signal === 'action-ledger-completion' || value.signal === 'action-ledger-incomplete'
    ? value.signal
    : value.finalComplete ? 'action-ledger-completion' : 'action-ledger-incomplete';
  return {
    schemaVersion: 'sciforge.vision-sense.completion-semantic-signal.v1',
    signal,
    final: true,
    finalComplete: value.finalComplete,
    detectorKind: typeof value.detectorKind === 'string' ? value.detectorKind : undefined,
    evidenceStepCount: typeof value.evidenceStepCount === 'number' && Number.isFinite(value.evidenceStepCount)
      ? value.evidenceStepCount
      : 0,
  };
}

function shouldCompleteFromCandidateActionLedger(task: string, steps: Record<string, unknown>[]) {
  if (!/候选证据|candidate evidence|screening|筛选/i.test(task)) return false;
  const targets = effectiveActions(steps, { requireEffect: true })
    .filter((action) => ['click', 'double_click'].includes(stringAt(action, 'type') ?? ''))
    .map(actionRouteTarget)
    .filter((target) => /result|link|title|candidate|evidence|article|结果|链接|标题|候选|证据|文章/i.test(target));
  return new Set(targets.map(compactRouteText)).size >= 3;
}

function shouldCompleteFromCreationActionLedger(task: string, steps: Record<string, unknown>[]) {
  if (!isLowRiskCreationTask(task)) return false;
  const effectiveSteps = doneGuiSteps(steps, { requireEffect: true });
  const actions = effectiveActions(steps, { requireEffect: true });
  const editorPattern = /powerpoint|word|presentation|document|演示|文档/i;
  const structurePattern = /placeholder|text box|textbox|shape|rectangle|canvas|slide|document|body|title|insert|占位符|文本框|图形|矩形|画布|幻灯片|文档|正文|标题|插入/i;
  const typedText = effectiveSteps
    .map(stepAction)
    .filter((action): action is Record<string, unknown> => Boolean(action))
    .filter((action) => stringAt(action, 'type') === 'type_text' && (stringAt(action, 'text') ?? '').trim().length >= 4 && !isNavigationText(stringAt(action, 'text') ?? ''))
    .map((action) => stringAt(action, 'text')?.trim() ?? '');
  const structuralTargets = effectiveSteps
    .map(stepAction)
    .filter((action): action is Record<string, unknown> => Boolean(action))
    .map(actionRouteTarget)
    .filter((target) => structurePattern.test(target));
  const openedEditor = actions.some((action) => stringAt(action, 'type') === 'open_app' && editorPattern.test(stringAt(action, 'appName') ?? ''));
  const observedEditor = effectiveSteps.some((step) => stepObservedAppMatches(step, editorPattern));
  const hasSetup = openedEditor || observedEditor || actions.some((action) => ['open_app', 'click', 'double_click'].includes(stringAt(action, 'type') ?? ''));
  if (!hasSetup) return false;
  const rich = /\b(?:three|3)\b|facts?|points?|bullets?|body text|要点|事实|正文/i.test(task);
  if (typedText.length) {
    return actions.length >= 6
      && typedText.join('\n').length >= (rich ? 60 : 8)
      && new Set(typedText.map(compactRouteText)).size >= (rich ? 2 : 1)
      && structuralTargets.length >= 2;
  }
  if (rich) return false;
  const hasStructureEdit = actions.some((action) => stringAt(action, 'type') === 'drag') || structuralTargets.some((target) => /shape|rectangle|text box|textbox|canvas|图形|矩形|文本框|画布/i.test(target));
  return actions.length >= 5 && structuralTargets.length >= 2 && hasStructureEdit;
}

function shouldCompleteFromFileManagerActionLedger(task: string, steps: Record<string, unknown>[]) {
  if (!isLowRiskFileManagerTask(task)) return false;
  const fileManagerPattern = /finder|file explorer|文件管理器|访达/i;
  const effectiveSteps = doneGuiSteps(steps, { requireEffect: true });
  const actions = effectiveActions(steps, { requireEffect: true });
  const opened = actions.some((action) => stringAt(action, 'type') === 'open_app' && fileManagerPattern.test(stringAt(action, 'appName') ?? ''));
  const observed = effectiveSteps.some((step) => stepObservedAppMatches(step, fileManagerPattern));
  const fileListInteractions = actions
    .map(actionRouteTarget)
    .filter((target) => /file|folder|list|finder|explorer|directory|row|entry|文件|文件夹|列表|目录|访达/i.test(target));
  const navigationActions = actions.filter((action) => ['scroll', 'click', 'double_click', 'drag'].includes(stringAt(action, 'type') ?? ''));
  return (opened || observed) && actions.length >= 4 && navigationActions.length >= 2 && fileListInteractions.length >= 2;
}

function shouldCompleteFromSettingsFormActionLedger(task: string, steps: Record<string, unknown>[]) {
  if (!isLowRiskSettingsFormTask(task)) return false;
  const actions = effectiveActions(steps);
  const requiredCount = /至少\s*8\s*个|at least\s*8/i.test(task)
    ? 12
    : /(?:^|[^\d])3\s*个|three\s+(?:low-risk\s+)?controls?/i.test(task) ? 3 : 8;
  if (actions.length < requiredCount) return false;
  const targets = actions.map(actionRouteTarget).map(compactRouteText).filter(Boolean);
  const controlKinds = new Set<string>();
  for (const action of actions) {
    const target = actionRouteTarget(action);
    if (/text|input|field|search|textbox|prompt|placeholder|输入|文本|字段|搜索|输入框|文本框/i.test(target) || stringAt(action, 'type') === 'type_text') controlKinds.add('text');
    if (/menu|dropdown|select|popover|popup|picker|菜单|下拉|弹出|选择器/i.test(target)) controlKinds.add('menu');
    if (/checkbox|check box|toggle|switch|radio|复选|勾选|开关|切换|单选/i.test(target)) controlKinds.add('choice');
    if (/button|tab|toolbar|cancel|close|按钮|标签|工具栏|取消|关闭/i.test(target) || ['click', 'double_click'].includes(stringAt(action, 'type') ?? '')) controlKinds.add('button');
    if (stringAt(action, 'type') === 'scroll') controlKinds.add('scroll');
  }
  const requiresText = /text|input|field|search|文本|字段|搜索|输入框|搜索框/i.test(task);
  const hasText = actions.some((action) => stringAt(action, 'type') === 'type_text') || targets.some((target) => /text|input|field|search|输入|文本|字段|搜索/i.test(target));
  return new Set(targets).size >= Math.min(6, requiredCount)
    && controlKinds.size >= (requiredCount <= 3 ? 2 : 3)
    && (!requiresText || hasText);
}

function shouldCompleteFromValidationRecoveryActionLedger(task: string, steps: Record<string, unknown>[]) {
  if (!isLowRiskValidationRecoveryTask(task)) return false;
  const actions = effectiveActions(steps);
  if (actions.length < 4) return false;
  const targets = actions.map(actionRouteTarget);
  const hasInvalidInput = actions.some((action) => stringAt(action, 'type') === 'type_text')
    || targets.some((target) => /invalid|nonexistent|no result|search|field|input|无效|不存在|无结果|搜索|字段|输入/i.test(target));
  const hasRecovery = actions.some((action) => {
    const type = stringAt(action, 'type');
    if (type === 'press_key') return /escape|esc|backspace|delete|enter/i.test(stringAt(action, 'key') ?? '');
    if (type === 'type_text') return /clear|correct|reset|valid|empty|清除|修正|恢复|有效|空/i.test(actionRouteTarget(action));
    return /clear|correct|reset|cancel|close|dismiss|清除|修正|恢复|取消|关闭/i.test(actionRouteTarget(action));
  });
  const hasObservation = actions.some((action) => ['scroll', 'click', 'double_click'].includes(stringAt(action, 'type') ?? ''));
  return hasInvalidInput && hasObservation && (hasRecovery || actions.length >= 6);
}

function shouldCompleteFromExpectedFailureActionLedger(task: string, steps: Record<string, unknown>[]) {
  if (!isLowRiskExpectedFailureTask(task)) return false;
  const actions = effectiveActions(steps, { includeWait: true });
  const typedFailure = actions.some((action) => stringAt(action, 'type') === 'type_text' && /non.?existent|unavailable|missing|refs?|failed|不存在|不可用|失败/i.test(stringAt(action, 'text') ?? ''));
  const submitted = actions.some((action) => stringAt(action, 'type') === 'press_key' && /enter|return/i.test(stringAt(action, 'key') ?? ''))
    || actions.some((action) => ['click', 'double_click'].includes(stringAt(action, 'type') ?? '') && /send|submit|run|发送|提交|运行/i.test(actionRouteTarget(action)));
  return typedFailure && submitted;
}

function shouldCompleteFromWindowRecoveryActionLedger(task: string, steps: Record<string, unknown>[]) {
  if (!isWindowRecoveryTask(task)) return false;
  const effectiveSteps = doneGuiSteps(steps, { requireEffect: true });
  const actions = effectiveActions(steps, { requireEffect: true });
  const migrationDrags = effectiveSteps.filter((step) => {
    const action = stepAction(step);
    const grounding = recordAt(step, 'grounding') ?? {};
    return action
      && stringAt(action, 'type') === 'drag'
      && (stringAt(grounding, 'provider') === 'window-cross-display-drag' || /display|monitor|screen|显示器|屏幕/i.test(actionRouteTarget(action)));
  });
  const recoveryActions = actions.filter((action) => ['hotkey', 'open_app', 'drag', 'click'].includes(stringAt(action, 'type') ?? ''));
  return migrationDrags.length >= 1 || recoveryActions.length >= 2;
}

function policyStepLedger(steps: LoopStep[]) {
  return steps.map((step) => ({
    kind: step.kind,
    status: step.status,
    plannedAction: step.plannedAction,
    verifier: step.verifier,
    windowTarget: step.windowTarget,
    execution: step.execution,
    grounding: step.grounding,
  }));
}

function doneGuiSteps(steps: Record<string, unknown>[], options: { requireEffect?: boolean } = {}) {
  return steps.filter((step) => (
    step.kind === 'gui-execution'
    && step.status === 'done'
    && (!options.requireEffect || !isNoVisibleEffectStep(step))
  ));
}

function effectiveActions(steps: Record<string, unknown>[], options: { requireEffect?: boolean; includeWait?: boolean } = {}) {
  return doneGuiSteps(steps, { requireEffect: options.requireEffect })
    .map(stepAction)
    .filter((action): action is Record<string, unknown> => Boolean(action))
    .filter((action) => options.includeWait || stringAt(action, 'type') !== 'wait');
}

function stepAction(step: Record<string, unknown>) {
  return recordAt(step, 'plannedAction');
}

function isNoVisibleEffectStep(step: Record<string, unknown>) {
  const verifier = recordAt(step, 'verifier');
  const pixelDiff = recordAt(verifier, 'pixelDiff');
  return pixelDiff?.possiblyNoEffect === true;
}

function isLowRiskSettingsFormTask(task: string) {
  const primary = primaryTaskText(task);
  if (HIGH_RISK_GUI_PATTERN.test(primary) && !NEGATED_HIGH_RISK_BOUNDARY_PATTERN.test(primary)) return false;
  return SETTINGS_FORM_INTENT_PATTERN.test(primary) && LOW_RISK_BOUNDARY_PATTERN.test(primary);
}

function isLowRiskFileManagerTask(task: string) {
  const primary = primaryTaskText(task);
  if (HIGH_RISK_GUI_PATTERN.test(primary) && !NEGATED_HIGH_RISK_BOUNDARY_PATTERN.test(primary)) return false;
  const destructive = DESTRUCTIVE_FILE_PATTERN.test(primary);
  return FILE_MANAGER_INTENT_PATTERN.test(primary) && (!destructive || NEGATED_HIGH_RISK_BOUNDARY_PATTERN.test(primary));
}

function isLowRiskCreationTask(task: string) {
  const primary = primaryTaskText(task);
  if (HIGH_RISK_GUI_PATTERN.test(primary) && !NEGATED_HIGH_RISK_BOUNDARY_PATTERN.test(primary)) return false;
  return CREATION_INTENT_PATTERN.test(primary) && VISIBLE_ARTIFACT_INTENT_PATTERN.test(primary);
}

function isLowRiskValidationRecoveryTask(task: string) {
  const primary = primaryTaskText(task);
  if (HIGH_RISK_GUI_PATTERN.test(primary) && !NEGATED_HIGH_RISK_BOUNDARY_PATTERN.test(primary)) return false;
  return VALIDATION_RECOVERY_INTENT_PATTERN.test(primary) && VALIDATION_LOW_RISK_BOUNDARY_PATTERN.test(primary);
}

function isLowRiskExpectedFailureTask(task: string) {
  const primary = primaryTaskText(task);
  if (HIGH_RISK_GUI_PATTERN.test(primary) && !NEGATED_HIGH_RISK_BOUNDARY_PATTERN.test(primary)) return false;
  return EXPECTED_FAILURE_INTENT_PATTERN.test(primary) && /low[- ]?risk|低风险|failed-with-reason/i.test(primary);
}

function isWindowRecoveryTask(task: string) {
  const primary = primaryTaskText(task);
  return !HIGH_RISK_GUI_PATTERN.test(primary) && WINDOW_RECOVERY_INTENT_PATTERN.test(primary);
}

function stepObservedAppMatches(step: Record<string, unknown>, pattern: RegExp) {
  const direct = recordAt(step, 'windowTarget') ?? {};
  const executionTarget = recordAt(recordAt(step, 'execution'), 'windowTarget') ?? {};
  return [
    stringAt(direct, 'appName'),
    stringAt(direct, 'bundleId'),
    stringAt(executionTarget, 'appName'),
    stringAt(executionTarget, 'bundleId'),
  ].some((value) => value !== undefined && pattern.test(value));
}

function actionRouteTarget(action: Record<string, unknown>) {
  return compactRouteText([
    stringAt(action, 'targetDescription'),
    stringAt(action, 'targetRegionDescription'),
    stringAt(action, 'type') === 'drag' ? stringAt(action, 'fromTargetDescription') : undefined,
    stringAt(action, 'type') === 'drag' ? stringAt(action, 'toTargetDescription') : undefined,
  ].filter(Boolean).join(' '));
}

function primaryTaskText(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? text;
}

function compactRouteText(value: string | undefined) {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isNavigationText(text: string) {
  const value = text.trim();
  return /^(?:https?:\/\/|file:\/\/|www\.)/i.test(value) || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|$)/.test(value);
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}
