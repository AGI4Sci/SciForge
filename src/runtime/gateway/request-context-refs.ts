import type { GatewayRequest } from '../runtime-types.js';
import { toRecordList } from '../gateway-utils.js';

export function requestContextRefs(request: GatewayRequest, uiState: Record<string, unknown>) {
  return [
    ...toRecordList(request.references),
    ...toRecordList(uiState.currentReferences),
    ...toRecordList(uiState.recentExecutionRefs),
  ].slice(0, 12);
}
