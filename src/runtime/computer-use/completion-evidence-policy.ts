import { isRecord } from '../gateway-utils.js';

export const COMPLETION_EVIDENCE_POLICY_SCHEMA = 'sciforge.completion-evidence-policy.v1';
export const EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID = 'computer-use.embedded-isolated-desktop-l3';
export const COMPLETION_EVIDENCE_TRIGGER_ON_COMPLETED_CURRENT_RUN = 'on-completed-current-run';

export type CompletionEvidenceProducerPolicy = {
  id: typeof EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID;
  enabled: true;
  trigger: typeof COMPLETION_EVIDENCE_TRIGGER_ON_COMPLETED_CURRENT_RUN;
};

export type CompletionEvidencePolicy = {
  schemaVersion: typeof COMPLETION_EVIDENCE_POLICY_SCHEMA;
  producers: CompletionEvidenceProducerPolicy[];
};

export function sanitizeCompletionEvidencePolicy(value: unknown): CompletionEvidencePolicy | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== COMPLETION_EVIDENCE_POLICY_SCHEMA) return undefined;
  const producers = Array.isArray(value.producers)
    ? value.producers.map(sanitizeCompletionEvidenceProducerPolicy).filter((producer): producer is CompletionEvidenceProducerPolicy => Boolean(producer))
    : [];
  if (!producers.length) return undefined;
  return {
    schemaVersion: COMPLETION_EVIDENCE_POLICY_SCHEMA,
    producers,
  };
}

export function completionEvidenceProducerEnabled(
  policy: CompletionEvidencePolicy | undefined,
  producerId: string,
  trigger = COMPLETION_EVIDENCE_TRIGGER_ON_COMPLETED_CURRENT_RUN,
) {
  return Boolean(policy?.producers.some((producer) => (
    producer.id === producerId
    && producer.enabled === true
    && producer.trigger === trigger
  )));
}

function sanitizeCompletionEvidenceProducerPolicy(value: unknown): CompletionEvidenceProducerPolicy | undefined {
  if (!isRecord(value)) return undefined;
  if (value.id !== EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID) return undefined;
  if (value.enabled !== true) return undefined;
  const trigger = typeof value.trigger === 'string' ? value.trigger : undefined;
  if (trigger !== COMPLETION_EVIDENCE_TRIGGER_ON_COMPLETED_CURRENT_RUN) return undefined;
  return {
    id: EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID,
    enabled: true,
    trigger,
  };
}
