import {
  resultPresentationFromPayload,
  validateResultPresentationContract,
  type ResultPresentationContract,
} from '@sciforge-ui/runtime-contract/result-presentation';
import type { ToolPayload } from '../runtime-types.js';
import { isRecord, toRecordList } from '../gateway-utils.js';

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

export function attachResultPresentationContract(payload: ToolPayload): ToolPayload {
  return {
    ...payload,
    displayIntent: {
      ...(isRecord(payload.displayIntent) ? payload.displayIntent : {}),
      resultPresentation: materializeResultPresentationContract({ payload }),
    },
  };
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
