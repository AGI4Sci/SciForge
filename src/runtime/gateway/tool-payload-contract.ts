import type { ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { TOOL_PAYLOAD_ARRAY_FIELDS } from '@sciforge-ui/runtime-contract/tool-payload-shape';

export function isToolPayload(value: unknown): value is ToolPayload {
  if (!isRecord(value)) return false;
  return typeof value.message === 'string'
    && typeof value.confidence === 'number'
    && typeof value.claimType === 'string'
    && typeof value.evidenceLevel === 'string'
    && typeof value.reasoningTrace === 'string'
    && TOOL_PAYLOAD_ARRAY_FIELDS.every((key) => Array.isArray(value[key]));
}

export function schemaErrors(payload: unknown) {
  if (!isRecord(payload)) return ['payload is not an object'];
  const errors: string[] = [];
  for (const key of ['message', ...TOOL_PAYLOAD_ARRAY_FIELDS]) {
    if (!(key in payload)) errors.push(`missing ${key}`);
  }
  if ('message' in payload && typeof payload.message !== 'string') errors.push('message must be a string');
  if ('confidence' in payload && typeof payload.confidence !== 'number') errors.push('confidence must be a number');
  if ('claimType' in payload && typeof payload.claimType !== 'string') errors.push('claimType must be a string');
  if ('evidenceLevel' in payload && typeof payload.evidenceLevel !== 'string') errors.push('evidenceLevel must be a string');
  if ('reasoningTrace' in payload && typeof payload.reasoningTrace !== 'string') errors.push('reasoningTrace must be a string');
  for (const key of TOOL_PAYLOAD_ARRAY_FIELDS) {
    if (!Array.isArray(payload[key])) errors.push(`${key} must be an array`);
  }
  if (Array.isArray(payload.uiManifest)) {
    payload.uiManifest.forEach((slot, index) => {
      if (!isRecord(slot)) {
        errors.push(`uiManifest[${index}] must be an object`);
        return;
      }
      if (typeof slot.componentId !== 'string' || !slot.componentId.trim()) {
        errors.push(`uiManifest[${index}].componentId must be a non-empty string`);
      }
      if ('artifactRef' in slot && (typeof slot.artifactRef !== 'string' || !slot.artifactRef.trim())) {
        errors.push(`uiManifest[${index}].artifactRef must be a non-empty string when present`);
      }
    });
  }
  if (Array.isArray(payload.executionUnits)) {
    payload.executionUnits.forEach((unit, index) => {
      if (!isRecord(unit)) {
        errors.push(`executionUnits[${index}] must be an object`);
        return;
      }
      if ('status' in unit && typeof unit.status !== 'string') errors.push(`executionUnits[${index}].status must be a string`);
    });
  }
  if (Array.isArray(payload.artifacts)) {
    payload.artifacts.forEach((artifact, index) => {
      if (!isRecord(artifact)) {
        errors.push(`artifacts[${index}] must be an object`);
        return;
      }
      if (typeof artifact.id !== 'string' || !artifact.id.trim()) errors.push(`artifacts[${index}].id must be a non-empty string`);
      if (typeof artifact.type !== 'string' || !artifact.type.trim()) errors.push(`artifacts[${index}].type must be a non-empty string`);
    });
  }
  return errors;
}
