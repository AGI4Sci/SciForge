import assert from 'node:assert/strict';
import { buildWorkspaceTaskInput } from '../../src/runtime/workspace-task-input.js';

const largeText = 'A'.repeat(2 * 1024 * 1024);
const taskInput = buildWorkspaceTaskInput({
  prompt: `${'prompt '.repeat(6000)}tail`,
  artifacts: [{
    id: 'large-artifact',
    type: 'research-report',
    dataRef: '.bioagent/artifacts/report.json',
    data: {
      markdown: largeText,
      sections: Array.from({ length: 200 }, (_, index) => ({ title: `S${index}`, content: largeText.slice(0, 5000) })),
    },
  }],
  priorAttempts: Array.from({ length: 20 }, (_, index) => ({
    id: `attempt-${index}`,
    attempt: index,
    status: 'failed-with-reason',
    stderrRef: `.bioagent/logs/${index}.stderr.log`,
    failureReason: largeText,
  })),
}, {
  workspacePath: '/tmp/workspace',
  taskCodeRef: '.bioagent/tasks/run.py',
  inputRef: '.bioagent/task-inputs/run.json',
  outputRef: '.bioagent/task-results/run.json',
  stdoutRef: '.bioagent/logs/run.stdout.log',
  stderrRef: '.bioagent/logs/run.stderr.log',
});

const serialized = JSON.stringify(taskInput);
assert.ok(serialized.length < 120_000, `compacted task input should stay small, got ${serialized.length}`);
assert.ok(!serialized.includes(largeText.slice(0, 100_000)));
assert.equal(taskInput.inputRef, '.bioagent/task-inputs/run.json');
assert.equal(taskInput._bioagentInputManifest.schemaVersion, 'bioagent.task-input.v1');
const taskInputRecord = taskInput as Record<string, unknown>;
assert.equal(Array.isArray(taskInputRecord.artifacts), true);
const artifact = (taskInputRecord.artifacts as Record<string, unknown>[])[0];
assert.equal(artifact.dataOmitted, true);
assert.equal(artifact.dataRef, '.bioagent/artifacts/report.json');
assert.equal((taskInputRecord.priorAttempts as unknown[]).length, 8);

console.log('[ok] workspace task input compaction replaces large inline artifacts with compact refs');
