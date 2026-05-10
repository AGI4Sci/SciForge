import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import {
  buildValidationRepairTelemetrySummary,
  mergeValidationRepairTelemetryAttemptMetadata,
  validationRepairTelemetryAttemptRefFromWriteResult,
  validationRepairTelemetryAttemptMetadataFromPayload,
  type ValidationRepairTelemetrySummary,
  writeValidationRepairTelemetrySpansFromPayload,
  type ValidationRepairTelemetryWriteResult,
} from './validation-repair-telemetry-sink.js';

export interface AttachValidationRepairTelemetryWriteResultOptions {
  workspacePath?: string;
  telemetryPath?: string;
  now?: () => Date;
  readSummary?: boolean;
}

export async function recordValidationRepairTelemetryForPayload(
  payload: ToolPayload,
  request: GatewayRequest,
): Promise<ToolPayload> {
  try {
    const writeResult = await writeValidationRepairTelemetrySpansFromPayload(payload, {
      workspacePath: request.workspacePath || process.cwd(),
    });
    return writeResult.records.length
      ? await attachValidationRepairTelemetryWriteResult(payload, writeResult)
      : payload;
  } catch {
    return payload;
  }
}

export async function attachValidationRepairTelemetryWriteResult<T extends object>(
  target: T,
  writeResult: ValidationRepairTelemetryWriteResult,
  options: AttachValidationRepairTelemetryWriteResultOptions = {},
): Promise<T> {
  const telemetryRef = validationRepairTelemetryAttemptRefFromWriteResult(writeResult);
  if (!telemetryRef) return target;
  const current = target as T & {
    refs?: unknown;
    validationRepairTelemetrySummary?: ValidationRepairTelemetrySummary;
  };
  const refs = isRecord(current.refs) ? current.refs : {};
  const metadata = mergeValidationRepairTelemetryAttemptMetadata(
    validationRepairTelemetryAttemptMetadataFromPayload({ refs }),
    { telemetryRefs: [telemetryRef] },
  );
  const summary = options.readSummary && options.workspacePath
    ? await buildValidationRepairTelemetrySummary({
      workspacePath: options.workspacePath,
      telemetryPath: options.telemetryPath,
      now: options.now,
    })
    : undefined;
  return {
    ...target,
    refs: {
      ...refs,
      validationRepairTelemetry: metadata?.telemetryRefs ?? [telemetryRef],
    },
    ...(summary ? { validationRepairTelemetrySummary: summary } : {}),
  };
}
