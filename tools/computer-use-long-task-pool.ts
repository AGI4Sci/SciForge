export * from './computer-use-long-task-pool/matrix-config.js';
export * from './computer-use-long-task-pool/run-orchestration.js';
export * from './computer-use-long-task-pool/trace-validation.js';
export * from './computer-use-long-task-pool/report-writer.js';
export { runComputerUseLongTaskPoolCli } from './computer-use-long-task-pool/cli-entry.js';

import { runComputerUseLongTaskPoolCli } from './computer-use-long-task-pool/cli-entry.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  await runComputerUseLongTaskPoolCli(process.argv);
}
