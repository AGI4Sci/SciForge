/**
 * Aggregate budget for one admitted plugin business invocation. It is longer
 * than any single model/worker attempt because one operation may perform
 * several model calls and worker actions; it is not a lifecycle deadline.
 */
export const HOST_BUSINESS_INVOKE_TIMEOUT_MS = 1_800_000