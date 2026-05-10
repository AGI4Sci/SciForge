import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import {
  validationRepairTelemetryAttemptRefFromWriteResult,
  writeValidationRepairTelemetrySpansFromPayload,
  type ValidationRepairTelemetryWriteResult,
} from './validation-repair-telemetry-sink.js';

export async function recordValidationRepairTelemetryForPayload(
  payload: ToolPayload,
  request: GatewayRequest,
): Promise<ToolPayload> {
  try {
    const writeResult = await writeValidationRepairTelemetrySpansFromPayload(payload, {
      workspacePath: request.workspacePath || process.cwd(),
    });
    return writeResult.records.length ? attachValidationRepairTelemetryRefs(payload, writeResult) : payload;
  } catch {
    return payload;
  }
}

function attachValidationRepairTelemetryRefs(
  payload: ToolPayload,
  writeResult: ValidationRepairTelemetryWriteResult,
): ToolPayload {
  const current = payload as ToolPayload & { refs?: unknown };
  const refs = isRecord(current.refs) ? current.refs : {};
  const existingTelemetry = Array.isArray(refs.validationRepairTelemetry)
    ? refs.validationRepairTelemetry
    : [];
  const telemetryRef = validationRepairTelemetryAttemptRefFromWriteResult(writeResult);
  if (!telemetryRef) return payload;
  return {
    ...payload,
    refs: {
      ...refs,
      validationRepairTelemetry: [
        ...existingTelemetry,
        telemetryRef,
      ],
    },
  } as ToolPayload;
}
