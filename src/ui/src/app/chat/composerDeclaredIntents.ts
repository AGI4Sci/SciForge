import type {
  ComposerDeclaredCapabilityTier,
  ComposerDeclaredIntentSnapshot,
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

export function composerDeclaredIntentsForSession(session: SciForgeSession): ComposerDeclaredIntentSnapshot | undefined {
  const modelAction = [...uiActionAuditLogForSession(session)]
    .reverse()
    .find((action) => {
      if (action.type !== 'update-capability-preference') return false;
      return action.preference.intent === 'composer-model-selection'
        && action.preference.source === 'composer-model-menu';
    });
  if (!modelAction || modelAction.type !== 'update-capability-preference') return undefined;
  const model = composerModelIntentFromPreference(modelAction.preference, {
    actionId: modelAction.id,
    declaredAt: modelAction.createdAt,
  });
  if (!model) return undefined;
  return {
    schemaVersion: SCHEMA_VERSION,
    source: 'ui-action-audit-log',
    model,
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
  const publicLabel = publicIntentLabel(preference.publicLabel, modelIntentId);
  return {
    modelIntentId,
    mode,
    capabilityTier,
    publicLabel,
    actionId: provenance.actionId,
    declaredAt: provenance.declaredAt,
  };
}

function asKnownValue<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  if (typeof value !== 'string') return undefined;
  return allowed.has(value as T) ? value as T : undefined;
}

function publicIntentLabel(value: unknown, fallbackId: ComposerDeclaredModelIntentId) {
  if (typeof value !== 'string') return publicLabelForIntent(fallbackId);
  const compact = value.replace(/\s+/g, ' ').trim().slice(0, 48);
  if (!compact || containsInternalTerm(compact)) return publicLabelForIntent(fallbackId);
  return compact;
}

function publicLabelForIntent(intentId: ComposerDeclaredModelIntentId) {
  if (intentId === 'auto') return 'Auto';
  if (intentId === 'max') return 'MAX Mode';
  if (intentId === 'assistant-fast') return 'Assistant Fast';
  if (intentId === 'assistant-balanced') return 'Assistant Balanced';
  if (intentId === 'assistant-deep') return 'Assistant Deep';
  return 'Assistant Auto';
}

function containsInternalTerm(value: string) {
  return /\b(?:provider|modelProvider|modelName|modelBaseUrl|baseUrl|endpoint|profile|runtime\s+codex|workspacePath|Authorization|api\s*key|secret|token|credential|password)\b/i.test(value)
    || /https?:\/\/|(?:^|\s)(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\/|\bsk-[A-Za-z0-9._-]+/i.test(value);
}
