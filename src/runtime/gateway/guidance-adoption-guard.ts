import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';

const ACTIVE_GUIDANCE_STATUSES = new Set(['queued', 'deferred']);
const DECISION_STATUSES = new Set(['adopted', 'deferred', 'rejected']);

export interface GuidanceAdoptionFinding {
  severity: 'repair-needed';
  reason: string;
  missingIds: string[];
  invalidIds: string[];
}

export function evaluateGuidanceAdoption(payload: ToolPayload, request: GatewayRequest): GuidanceAdoptionFinding | undefined {
  const required = activeGuidanceItems(request);
  if (!required.length) return undefined;
  const decisions = guidanceDecisionMap(payload);
  const missingIds: string[] = [];
  const invalidIds: string[] = [];
  for (const item of required) {
    const decision = decisions.get(item.id);
    if (!decision) {
      missingIds.push(item.id);
      continue;
    }
    if (!DECISION_STATUSES.has(decision.status) || !decision.reason) {
      invalidIds.push(item.id);
    }
  }
  if (!missingIds.length && !invalidIds.length) return undefined;
  const parts = [
    missingIds.length ? `missing guidance decisions for: ${missingIds.join(', ')}` : '',
    invalidIds.length ? `invalid guidance decisions for: ${invalidIds.join(', ')}; expected adopted/deferred/rejected with reason` : '',
  ].filter(Boolean);
  return {
    severity: 'repair-needed',
    reason: `TaskProject guidance adoption contract failed: ${parts.join('; ')}.`,
    missingIds,
    invalidIds,
  };
}

function activeGuidanceItems(request: GatewayRequest) {
  const items = new Map<string, { id: string; status: string }>();
  for (const record of recordsInValue(request.uiState, 0)) {
    for (const key of ['userGuidanceQueue', 'guidanceQueue']) {
      const value = record[key];
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        if (!isRecord(entry)) continue;
        const id = stringField(entry.id);
        const status = stringField(entry.status);
        if (id && status && ACTIVE_GUIDANCE_STATUSES.has(status)) {
          items.set(id, { id, status });
        }
      }
    }
  }
  return [...items.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function guidanceDecisionMap(payload: ToolPayload) {
  const decisions = new Map<string, { status: string; reason?: string }>();
  for (const record of recordsInValue(payload, 0)) {
    for (const key of ['guidanceDecisions', 'guidanceDecision']) {
      const value = record[key];
      const entries = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
      for (const entry of entries) {
        if (!isRecord(entry)) continue;
        const id = stringField(entry.id) ?? stringField(entry.guidanceId);
        const status = stringField(entry.status) ?? stringField(entry.decision);
        if (!id || !status) continue;
        decisions.set(id, {
          status,
          reason: stringField(entry.reason) ?? stringField(entry.rationale) ?? stringField(entry.decisionReason),
        });
      }
    }
  }
  return decisions;
}

function recordsInValue(value: unknown, depth: number): Record<string, unknown>[] {
  if (depth > 6 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => recordsInValue(entry, depth + 1));
  if (!isRecord(value)) return [];
  return [value, ...Object.values(value).flatMap((entry) => recordsInValue(entry, depth + 1))];
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
