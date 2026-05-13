import type { ReleaseGatePolicyInput } from './release-gate';

export type IntentRequestedActionType = 'answer' | 'advice' | 'code-change' | 'file-change' | 'data-analysis' | 'external-action' | 'unknown';
export type VerifyRouteMode = 'skip' | 'background' | 'wait' | 'careful' | 'release';

export const INTENT_FIRST_VERIFICATION_POLICY_CONTRACT_ID = 'sciforge.intent-first-verification-policy.v1';

export interface VerifyRouteIntentOptions {
  releaseGatePolicy?: ReleaseGatePolicyInput | Record<string, unknown>;
}

const HIGH_RISK_SIDE_EFFECT_TOKENS = new Set([
  'delete',
  'remove',
  'destroy',
  'drop',
  'publish',
  'deploy',
  'payment',
  'external',
  'external-write',
  'production',
  'credential',
  'secret',
  'sync',
  'push',
  'release',
]);

export function explicitIntentConstraintsForText(text: string) {
  void text;
  return [];
}

export function requestedActionTypeForIntentText(text: string): IntentRequestedActionType {
  if (text.trim()) return 'answer';
  return 'unknown';
}

export function verifyRouteModeForIntentText(text: string, options: VerifyRouteIntentOptions = {}): VerifyRouteMode | undefined {
  void text;
  void options;
  return undefined;
}

export function intentTextHasHighRiskSignal(text: string) {
  void text;
  return false;
}

export function actionSideEffectsHaveHighRiskSignal(sideEffects: readonly unknown[]) {
  return sideEffects.some((sideEffect) => {
    if (typeof sideEffect === 'string') return HIGH_RISK_SIDE_EFFECT_TOKENS.has(sideEffect.trim().toLowerCase());
    if (!sideEffect || typeof sideEffect !== 'object' || Array.isArray(sideEffect)) return false;
    const record = sideEffect as Record<string, unknown>;
    return record.riskLevel === 'high'
      || record.risk === 'high'
      || record.sideEffectClass === 'external-write'
      || record.sideEffectClass === 'production'
      || (typeof record.kind === 'string' && HIGH_RISK_SIDE_EFFECT_TOKENS.has(record.kind.trim().toLowerCase()))
      || (typeof record.type === 'string' && HIGH_RISK_SIDE_EFFECT_TOKENS.has(record.type.trim().toLowerCase()));
  });
}
