export * from './computer-use-long-task-pool/matrix-config.js';
export * from './computer-use-long-task-pool/run-orchestration.js';
export * from './computer-use-long-task-pool/trace-validation.js';
export * from './computer-use-long-task-pool/report-writer.js';
export {
  computerUseLongRoundTimeoutMs,
  computerUsePlannerStepTimeoutMs,
  CU_LONG_ABORT_GRACE_MS,
  CU_LONG_DEFAULT_DRY_RUN_ROUND_TIMEOUT_MS,
  CU_LONG_DEFAULT_REAL_MAX_STEPS,
  CU_LONG_FINALIZATION_GRACE_MS,
} from './computer-use-long-task-pool/run-core.js';
export { runComputerUseLongTaskPoolCli } from './computer-use-long-task-pool/cli-entry.js';

import { runComputerUseLongTaskPoolCli } from './computer-use-long-task-pool/cli-entry.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  await runComputerUseLongTaskPoolCli(process.argv);
}
