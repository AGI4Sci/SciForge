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

test('readiness rejects completion truth fields from modules', () => {
  const unsafe = validateComputerUseAppModuleReadiness({
    status: 'ready',
    primitive: {
      name: 'computer_use.observe',
      inputRefs: ['window:vscode:1'],
    },
    evidenceRefs: ['module:vscode'],
    completionTruth: {
      scope: 'workflow',
      status: 'satisfied',
    },
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

test('readiness rejects nested provider payload objects even when their values are opaque', () => {
  const unsafe = validateComputerUseAppModuleReadiness({
    status: 'ready',
    primitive: {
      name: 'computer_use.act',
      inputRefs: ['window:vscode:1'],
      action: {
        kind: 'type',
        textRef: 'text-ref:vscode:draft',
        providerPayload: {
          request: {
            opaque: 'stored-outside-public-context',
          },
        },
      },
    },
    evidenceRefs: ['module:vscode'],
  });

  assert.equal(unsafe.status, 'blocked');
  assert.equal(unsafe.reasonRef, 'blocked:computer-use-app-module:raw-ref-not-allowed');
});

test('readiness rejects forbidden fields nested in blocked diagnostics', () => {
  const unsafe = validateComputerUseAppModuleReadiness({
    status: 'blocked',
    reasonRef: 'blocked:vscode-app-module:diagnostic',
    evidenceRefs: ['module:vscode'],
    diagnostics: [{
      detail: {
        completionTruth: {
          status: 'satisfied',
        },
      },
    }],
  });

  assert.equal(unsafe.status, 'blocked');
  assert.equal(unsafe.reasonRef, 'blocked:computer-use-app-module:final-answer-not-allowed');
});

test('readiness rejects public-event raw log payloads through shared sanitizer rules', () => {
  const unsafe = validateComputerUseAppModuleReadiness({
    status: 'blocked',
    reasonRef: 'blocked:vscode-app-module:diagnostic',
    evidenceRefs: ['module:vscode', 'observation:vscode:current'],
    logs: [{
      stdout: 'SECRET_STDOUT_SHOULD_NOT_LEAK',
    }],
  });

  assert.equal(unsafe.status, 'blocked');
  assert.equal(unsafe.reasonRef, 'blocked:computer-use-app-module:raw-ref-not-allowed');
  assert.deepEqual(unsafe.evidenceRefs, ['module:vscode', 'observation:vscode:current']);
  assert.doesNotMatch(JSON.stringify(unsafe), /SECRET_STDOUT|stdout|logs/i);
});

test('readiness rejects final-answer aliases with snake or kebab case', () => {
  for (const key of ['final_answer', 'final-answer', 'completion_truth', 'completion-truth']) {
    const unsafe = validateComputerUseAppModuleReadiness({
      status: 'ready',
      primitive: {
        name: 'computer_use.observe',
        inputRefs: ['window:vscode:1'],
        action: {
          [key]: 'I handled it',
        },
      },
      evidenceRefs: ['module:vscode'],
    });

    assert.equal(unsafe.status, 'blocked', key);
    assert.equal(unsafe.reasonRef, 'blocked:computer-use-app-module:final-answer-not-allowed', key);
  }
});

test('readiness rejects raw payload key aliases with snake, kebab, and generic byte carriers', () => {
  for (const key of ['raw_payload', 'provider-payload', 'raw_command', 'raw-path', 'screenshotBase64', 'screenshot_base64', 'base64', 'bytes', 'buffer']) {
    const unsafe = validateComputerUseAppModuleReadiness({
      status: 'ready',
      primitive: {
        name: 'computer_use.act',
        inputRefs: ['window:vscode:1'],
        action: {
          kind: 'app_command',
          [key]: 'opaque',
        },
      },
      evidenceRefs: ['module:vscode'],
    });

    assert.equal(unsafe.status, 'blocked', key);
    assert.equal(unsafe.reasonRef, 'blocked:computer-use-app-module:raw-ref-not-allowed', key);
  }
});

test('readiness rejects raw payload values without explicit raw markers', () => {
  const pngBase64 = `iVBORw0KGgo${'A'.repeat(70)}12==`;
  const cases = [
    pngBase64,
    '<html><body><button>Run</button></body></html>',
    '/Users/example/Library/Application Support/Code/User/settings.json',
  ];

  for (const value of cases) {
    const unsafe = validateComputerUseAppModuleReadiness({
      status: 'ready',
      primitive: {
        name: 'computer_use.act',
        inputRefs: ['window:vscode:1'],
        action: {
          kind: 'app_command',
          textRef: value,
        },
      },
      evidenceRefs: ['module:vscode'],
    });

    assert.equal(unsafe.status, 'blocked', value);
    assert.equal(unsafe.reasonRef, 'blocked:computer-use-app-module:raw-ref-not-allowed', value);
  }
});
