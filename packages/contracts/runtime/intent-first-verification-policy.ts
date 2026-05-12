export type IntentRequestedActionType = 'answer' | 'advice' | 'code-change' | 'file-change' | 'data-analysis' | 'external-action' | 'unknown';
export type VerifyRouteMode = 'skip' | 'background' | 'wait' | 'careful' | 'release';

export const INTENT_FIRST_VERIFICATION_POLICY_CONTRACT_ID = 'sciforge.intent-first-verification-policy.v1';

const EXPLICIT_CONSTRAINTS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'negative-or-skip-instruction', pattern: /不需要|不要|别|skip|without|do not|don't/i },
  { id: 'scope-limiting-instruction', pattern: /只|only|just/i },
  { id: 'background-request', pattern: /后台|background/i },
  { id: 'wait-request', pattern: /等待|等.*验证|wait/i },
  { id: 'network-restriction', pattern: /不联网|不要联网|offline|no network/i },
];

const REQUESTED_ACTION_PATTERNS: Array<{ type: IntentRequestedActionType; pattern: RegExp }> = [
  { type: 'advice', pattern: /建议|recommend|advice|proposal|plan/i },
  { type: 'code-change', pattern: /代码|实现|修复|test|typecheck|code|patch/i },
  { type: 'file-change', pattern: /文件|文档|写入|修改|file|document/i },
  { type: 'data-analysis', pattern: /数据|表格|分析|csv|xlsx|data|analysis/i },
  { type: 'external-action', pattern: /发布|上线|删除|支付|提交|推送|deploy|delete|payment|commit|push/i },
];

const PROMPT_ROUTE_PATTERNS: Array<{ mode: VerifyRouteMode; pattern: RegExp }> = [
  { mode: 'skip', pattern: /skip verify|no verify|不要验证|不需要验证|跳过验证/i },
  { mode: 'release', pattern: /release verify|full verify|发布验证|上线验证|合并前验证/i },
  { mode: 'background', pattern: /background verify|verify in background|后台验证|后台.*verify/i },
  { mode: 'wait', pattern: /wait.*verify|verify.*before|等.*验证|验证.*再/i },
  { mode: 'careful', pattern: /careful verify|deep verify|仔细验证|深度验证|更稳/i },
];

const HIGH_RISK_TEXT_PATTERN = /不可逆|危险|production|prod|external/i;
const HIGH_RISK_SIDE_EFFECT_PATTERN = /delete|publish|deploy|payment|external|不可逆|删除|发布|上线|支付/i;

export function explicitIntentConstraintsForText(text: string) {
  return EXPLICIT_CONSTRAINTS
    .filter((constraint) => constraint.pattern.test(text))
    .map((constraint) => constraint.id);
}

export function requestedActionTypeForIntentText(text: string): IntentRequestedActionType {
  for (const action of REQUESTED_ACTION_PATTERNS) {
    if (action.pattern.test(text)) return action.type;
  }
  if (text.trim()) return 'answer';
  return 'unknown';
}

export function verifyRouteModeForIntentText(text: string): VerifyRouteMode | undefined {
  for (const route of PROMPT_ROUTE_PATTERNS) {
    if (route.pattern.test(text)) return route.mode;
  }
  return undefined;
}

export function intentTextHasHighRiskSignal(text: string) {
  return HIGH_RISK_TEXT_PATTERN.test(text);
}

export function actionSideEffectsHaveHighRiskSignal(sideEffects: readonly unknown[]) {
  return HIGH_RISK_SIDE_EFFECT_PATTERN.test(sideEffects.join(' '));
}
