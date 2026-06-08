import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createComputerUseAppModuleRegistry,
  validateComputerUseAppModuleReadiness,
  type ComputerUseAppModule,
} from './computer-use-app-module-registry.js';

const vscodeModule: ComputerUseAppModule = {
  moduleId: 'vscode',
  canHandle: ({ refs }) => refs.includes('macos-app:vscode') || refs.some((ref) => ref.startsWith('window:vscode:')),
  normalizeObservation: ({ refs }) => ({
    refs: refs.filter((ref) => ref.startsWith('window:') || ref.startsWith('macos-app:') || ref.startsWith('observation:')),
  }),
  getCapabilities: () => ['read-visible-text', 'focus-editor'],
  checkReadiness: ({ operation, refs }) => {
    if (!refs.includes('operation:read-visible-text') && operation !== 'read-visible-text') {
      return {
        status: 'blocked',
        reasonRef: 'blocked:vscode:operation-not-supported',
        evidenceRefs: ['module:vscode'],
      };
    }
    return {
      status: 'ready',
      primitive: {
        name: 'computer_use.observe',
        inputRefs: ['window:vscode:1', 'observation:vscode:1'],
      },
      evidenceRefs: ['module:vscode', 'decision:vscode:read-visible-text'],
    };
  },
};

test('registry selects a Host-side app module from current refs', () => {
  const registry = createComputerUseAppModuleRegistry([vscodeModule]);

  const match = registry.resolve({
    refs: ['macos-app:vscode', 'window:vscode:1', 'observation:vscode:1'],
  });

  assert.equal(match.status, 'ready');
  assert.equal(match.module.moduleId, 'vscode');
});

test('registry blocks unknown app refs instead of falling back to natural language execution', () => {
  const registry = createComputerUseAppModuleRegistry([vscodeModule]);

  const match = registry.resolve({
    refs: ['macos-app:unknown', 'window:unknown:1'],
  });

  assert.equal(match.status, 'blocked');
  assert.equal(match.reasonRef, 'blocked:computer-use-app-module:unsupported-app');
  assert.deepEqual(match.candidateModuleIds, []);
});

test('readiness rejects user-visible final answer fields from modules', () => {
  const unsafe = validateComputerUseAppModuleReadiness({
    status: 'ready',
    primitive: {
      name: 'computer_use.observe',
      inputRefs: ['window:vscode:1'],
    },
    evidenceRefs: ['module:vscode'],
    finalAnswer: 'I did it',
  });

  assert.equal(unsafe.status, 'blocked');
  assert.equal(unsafe.reasonRef, 'blocked:computer-use-app-module:final-answer-not-allowed');
});

test('readiness rejects user-visible final answer fields nested in primitive actions', () => {
  const unsafe = validateComputerUseAppModuleReadiness({
    status: 'ready',
    primitive: {
      name: 'computer_use.act',
      inputRefs: ['window:vscode:1'],
      action: {
        kind: 'app_command',
        message: 'I did it',
      },
    },
    evidenceRefs: ['module:vscode'],
  });

  assert.equal(unsafe.status, 'blocked');
  assert.equal(unsafe.reasonRef, 'blocked:computer-use-app-module:final-answer-not-allowed');
});

test('readiness rejects raw payload refs before Host can execute a primitive', () => {
  const unsafe = validateComputerUseAppModuleReadiness({
    status: 'ready',
    primitive: {
      name: 'computer_use.act',
      inputRefs: ['window:vscode:1', 'raw-command:npm test'],
    },
    evidenceRefs: ['module:vscode'],
  });

  assert.equal(unsafe.status, 'blocked');
  assert.equal(unsafe.reasonRef, 'blocked:computer-use-app-module:raw-ref-not-allowed');
});

test('readiness rejects raw payload strings nested in primitive actions', () => {
  const unsafe = validateComputerUseAppModuleReadiness({
    status: 'ready',
    primitive: {
      name: 'computer_use.act',
      inputRefs: ['window:vscode:1'],
      action: {
        kind: 'type',
        text: 'raw-command:npm test',
      },
    },
    evidenceRefs: ['module:vscode'],
  });

  assert.equal(unsafe.status, 'blocked');
  assert.equal(unsafe.reasonRef, 'blocked:computer-use-app-module:raw-ref-not-allowed');
});
