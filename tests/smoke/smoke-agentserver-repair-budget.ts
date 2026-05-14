import assert from 'node:assert/strict';

import {
  agentServerRepairMaxAttempts,
  repairShouldStopForNoCodeChange,
} from '../../src/runtime/generation-gateway';

const previous = process.env.SCIFORGE_AGENTSERVER_REPAIR_MAX_ATTEMPTS;
try {
  delete process.env.SCIFORGE_AGENTSERVER_REPAIR_MAX_ATTEMPTS;
  assert.equal(agentServerRepairMaxAttempts(), 4);

  process.env.SCIFORGE_AGENTSERVER_REPAIR_MAX_ATTEMPTS = '1';
  assert.equal(agentServerRepairMaxAttempts(), 2);

  process.env.SCIFORGE_AGENTSERVER_REPAIR_MAX_ATTEMPTS = '500';
  assert.equal(agentServerRepairMaxAttempts(), 50);

  process.env.SCIFORGE_AGENTSERVER_REPAIR_MAX_ATTEMPTS = 'not-a-number';
  assert.equal(agentServerRepairMaxAttempts(), 4);
} finally {
  if (previous === undefined) delete process.env.SCIFORGE_AGENTSERVER_REPAIR_MAX_ATTEMPTS;
  else process.env.SCIFORGE_AGENTSERVER_REPAIR_MAX_ATTEMPTS = previous;
}

assert.equal(
  repairShouldStopForNoCodeChange('print(1)', 'print(2)', [{ failureReason: 'missing output' }], 'missing output'),
  false,
);
assert.equal(
  repairShouldStopForNoCodeChange('print(1)', 'print(1)', [], 'missing output'),
  true,
);
assert.equal(
  repairShouldStopForNoCodeChange(
    'print(1)',
    'print(1)',
    [{ failureReason: 'AgentServer generated task output could not be parsed: ENOENT: no such file or directory' }],
    'AgentServer generated task output could not be parsed: ENOENT: no such file or directory',
  ),
  true,
);
assert.equal(
  repairShouldStopForNoCodeChange(
    'print(1)',
    'print(1)',
    [{ failureReason: '.sciforge/task-results/generated-literature-abc123def456-attempt-2.json missing' }],
    '.sciforge/task-results/generated-literature-abc123def456-attempt-9.json missing',
  ),
  true,
);

console.log('[ok] AgentServer repair budget and no-code-change stop guard prevent runaway repair loops');
