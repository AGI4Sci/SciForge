import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord, uniqueStrings } from '../gateway-utils.js';
import {
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
  return {
    ...payload,
    refs: {
      ...refs,
      validationRepairTelemetry: [
        ...existingTelemetry,
        {
          kind: 'validation-repair-telemetry',
          ref: writeResult.ref,
          spanRefs: writeResult.projection.spanRefs,
          recordRefs: writeResult.records.map((record) => record.ref),
          spanKinds: uniqueStrings(writeResult.records.map((record) => record.spanKind)),
        },
      ],
    },
  } as ToolPayload;
}
