import {
  resultPresentationFromPayload,
  validateResultPresentationContract,
  type ResultPresentationContract,
} from '@sciforge-ui/runtime-contract/result-presentation';
import type { ToolPayload } from '../runtime-types.js';
import { isRecord, toRecordList } from '../gateway-utils.js';
import {
  attachTaskOutcomeProjection,
  type GatewayTaskOutcomeProjectionContext,
} from './task-outcome-projection.js';

export { validateResultPresentationContract };
export type { ResultPresentationContract };

export interface ResultPresentationMaterializerInput {
  payload?: unknown;
  request?: unknown;
  harness?: unknown;
  objectReferences?: Array<Record<string, unknown>>;
  fallbackTitle?: string;
}

export function materializeResultPresentationContract(input: ToolPayload | ResultPresentationMaterializerInput): ResultPresentationContract {
  const record = isRecord(input) ? input : {};
  const payload = isRecord(record.payload) ? record.payload : record;
  const request = isRecord(record.request) ? record.request : {};
  return resultPresentationFromPayload({
    payload,
    objectReferences: toRecordList(record.objectReferences),
    fallbackTitle: stringField(record.fallbackTitle) ?? stringField(request.prompt) ?? 'Result completed.',
  });
}

export function attachResultPresentationContract(
  payload: ToolPayload,
  context: GatewayTaskOutcomeProjectionContext = {},
): ToolPayload {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const existing = displayIntent.resultPresentation;
  if (validateResultPresentationContract(existing).ok) {
    return attachTaskOutcomeProjection({
      ...payload,
      displayIntent,
    }, context);
  }

  return attachTaskOutcomeProjection({
    ...payload,
    displayIntent: {
      ...displayIntent,
      resultPresentation: materializeResultPresentationContract({ payload }),
    },
  }, context);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
