import type {
  ComposerDeclaredAuthorizationProfileId,
  ComposerDeclaredCapabilityTier,
  ComposerDeclaredIntentSnapshot,
  ComposerDeclaredModeIntentId,
  ComposerDeclaredModelIntentId,
  ComposerDeclaredModelMode,
  SciForgeSession,
} from '../../domain';
import { uiActionAuditLogForSession } from '../uiActionBoundary';

const SCHEMA_VERSION = 'sciforge.composer-declared-intents.v1' as const;

const MODEL_INTENT_IDS = new Set<ComposerDeclaredModelIntentId>([
  'auto',
  'max',
  'assistant-auto',
  'assistant-fast',
  'assistant-balanced',
  'assistant-deep',
]);

const MODEL_MODES = new Set<ComposerDeclaredModelMode>(['auto', 'max', 'assistant']);
const CAPABILITY_TIERS = new Set<ComposerDeclaredCapabilityTier>(['auto', 'max', 'fast', 'balanced', 'deep']);
const MODE_INTENT_IDS = new Set<ComposerDeclaredModeIntentId>(['plan', 'debug', 'multitask', 'ask']);
const AUTHORIZATION_PROFILE_IDS = new Set<ComposerDeclaredAuthorizationProfileId>(['assisted-autonomy', 'high-autonomy', 'research-sandbox-max']);
const MULTITASK_SUMMARY_GUIDANCE = 'Use Multitask for parallel research, long commands, or independent verification. Keep strongly coupled same-file edits or full-chat-history work with the main agent.';
const HARD_CONFIRM_CATEGORIES = [
  'payments-transfers-purchases',
  'external-communications',
  'external-system-submission',
  'remote-delete-overwrite-archive',
  'external-upload',
  'account-security-privacy-billing',
  'legal-compliance-contracts',
  'external-system-execution',
] as const;

export function composerDeclaredIntentsForSession(session: SciForgeSession): ComposerDeclaredIntentSnapshot | undefined {
  const actions = [...uiActionAuditLogForSession(session)].reverse();
  const modelAction = actions.find((action) => {
    if (action.type !== 'update-capability-preference') return false;
    return action.preference.intent === 'composer-model-selection'
      && action.preference.source === 'composer-model-menu';
  });
  const modeAction = actions.find((action) => {
    if (action.type !== 'update-capability-preference') return false;
    return action.preference.intent === 'composer-mode-selection'
      && action.preference.source === 'composer-mode-chip';
  });
  const authorizationAction = actions.find((action) => {
    if (action.type !== 'update-capability-preference') return false;
    return action.preference.intent === 'composer-autonomy-profile'
      && action.preference.source === 'composer-autonomy-menu';
  });
  const model = modelAction?.type === 'update-capability-preference'
    ? composerModelIntentFromPreference(modelAction.preference, {
      actionId: modelAction.id,
      declaredAt: modelAction.createdAt,
    })
    : undefined;
  const mode = modeAction?.type === 'update-capability-preference'
    ? composerModeIntentFromPreference(modeAction.preference, {
      actionId: modeAction.id,
      declaredAt: modeAction.createdAt,
    })
    : undefined;
  const authorization = authorizationAction?.type === 'update-capability-preference'
    ? composerAuthorizationFromPreference(authorizationAction.preference, {
      actionId: authorizationAction.id,
      declaredAt: authorizationAction.createdAt,
    })
    : defaultComposerAuthorization();
  if (!model && !mode && !authorization) return undefined;
  return {
    schemaVersion: SCHEMA_VERSION,
    source: 'ui-action-audit-log',
    ...(model ? { model } : {}),
    ...(mode ? { mode } : {}),
    ...(authorization ? { authorization } : {}),
  };
}

function composerModelIntentFromPreference(
  preference: Record<string, unknown>,
  provenance: { actionId: string; declaredAt: string },
): NonNullable<ComposerDeclaredIntentSnapshot['model']> | undefined {
  const modelIntentId = asKnownValue(preference.modelIntentId, MODEL_INTENT_IDS);
  const mode = asKnownValue(preference.mode, MODEL_MODES);
  const capabilityTier = asKnownValue(preference.capabilityTier, CAPABILITY_TIERS);
  if (!modelIntentId || !mode || !capabilityTier) return undefined;
  const publicLabel = publicIntentLabel(preference.publicLabel, publicModelLabelForIntent(modelIntentId));
  return {
    modelIntentId,
    mode,
    capabilityTier,
    publicLabel,
    actionId: provenance.actionId,
    declaredAt: provenance.declaredAt,
  };
}

function composerModeIntentFromPreference(
  preference: Record<string, unknown>,
  provenance: { actionId: string; declaredAt: string },
): NonNullable<ComposerDeclaredIntentSnapshot['mode']> | undefined {
  const modeIntentId = asKnownValue(preference.modeIntentId, MODE_INTENT_IDS);
  if (!modeIntentId) return undefined;
  return {
    modeIntentId,
    publicLabel: publicIntentLabel(preference.publicLabel, publicModeLabelForIntent(modeIntentId)),
    ...(modeIntentId === 'multitask' ? { summaryGuidance: MULTITASK_SUMMARY_GUIDANCE } : {}),
    actionId: provenance.actionId,
    declaredAt: provenance.declaredAt,
  };
}

function composerAuthorizationFromPreference(
  preference: Record<string, unknown>,
  provenance: { actionId: string; declaredAt: string },
): NonNullable<ComposerDeclaredIntentSnapshot['authorization']> | undefined {
  const profileId = asKnownValue(preference.profileId, AUTHORIZATION_PROFILE_IDS);
  if (!profileId) return defaultComposerAuthorization();
  return {
    profileId,
    publicLabel: publicIntentLabel(preference.publicLabel, publicAuthorizationLabel(profileId)),
    scope: {
      user: 'current-user',
      workspace: 'current-workspace',
    },
    source: 'composer-autonomy-menu',
    singleTurnOverride: true,
    actionId: provenance.actionId,
    declaredAt: provenance.declaredAt,
    hardConfirmCategories: [...HARD_CONFIRM_CATEGORIES],
  };
}

function defaultComposerAuthorization(): NonNullable<ComposerDeclaredIntentSnapshot['authorization']> {
  return {
    profileId: 'high-autonomy',
    publicLabel: 'High Autonomy',
    scope: {
      user: 'current-user',
      workspace: 'current-workspace',
    },
    source: 'composer-autonomy-default',
    singleTurnOverride: false,
    hardConfirmCategories: [...HARD_CONFIRM_CATEGORIES],
  };
}

function asKnownValue<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  if (typeof value !== 'string') return undefined;
  return allowed.has(value as T) ? value as T : undefined;
}

function publicIntentLabel(value: unknown, fallbackLabel: string) {
  if (typeof value !== 'string') return fallbackLabel;
  const compact = value.replace(/\s+/g, ' ').trim().slice(0, 48);
  if (!compact || containsInternalTerm(compact)) return fallbackLabel;
  return compact;
}

function publicModelLabelForIntent(intentId: ComposerDeclaredModelIntentId) {
  if (intentId === 'auto') return 'Auto';
  if (intentId === 'max') return 'MAX Mode';
  if (intentId === 'assistant-fast') return 'Assistant Fast';
  if (intentId === 'assistant-balanced') return 'Assistant Balanced';
  if (intentId === 'assistant-deep') return 'Assistant Deep';
  return 'Assistant Auto';
}

function publicModeLabelForIntent(intentId: ComposerDeclaredModeIntentId) {
  if (intentId === 'plan') return 'Plan';
  if (intentId === 'debug') return 'Debug';
  if (intentId === 'multitask') return 'Multitask';
  if (intentId === 'ask') return 'Ask';
  return 'Mode';
}

function publicAuthorizationLabel(profileId: ComposerDeclaredAuthorizationProfileId) {
  if (profileId === 'assisted-autonomy') return 'Assisted Autonomy';
  if (profileId === 'research-sandbox-max') return 'Research Sandbox Max';
  return 'High Autonomy';
}

function containsInternalTerm(value: string) {
  return /\b(?:provider|modelProvider|modelName|modelBaseUrl|baseUrl|endpoint|profile|runtime\s+codex|workspacePath|Authorization|api\s*key|secret|token|credential|password)\b/i.test(value)
    || /https?:\/\/|(?:^|\s)(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\/|\bsk-[A-Za-z0-9._-]+/i.test(value);
}
