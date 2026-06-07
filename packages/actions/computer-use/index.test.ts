import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { moduleResult, type ModuleInvokeRequest } from '@sciforge-ui/runtime-contract/modules';
import {
  COMPUTER_USE_ACTION_TYPES,
  COMPUTER_USE_ACTION_REQUIREMENTS,
  COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS,
  COMPUTER_USE_PRIMITIVE_INTENTS,
  COMPUTER_USE_PRIMITIVE_RESULT_SCHEMA,
  COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
  createComputerUsePrimitiveService,
  validateComputerUsePrimitiveInvokeRequest,
  type ComputerUsePrimitivePorts,
} from './index.js';
import {
  computerUseMcpTools,
  createComputerUseMcpAdapter,
} from './mcp.js';

describe('computer use primitive contract', () => {
  it('rejects legacy task-shaped public intents', () => {
    for (const intent of ['computer_use.runTask', 'computer_use.perform_local_action', 'computer_use.fill_fields']) {
      const validation = validateComputerUsePrimitiveInvokeRequest({
        moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
        intent,
        input: {
          schemaVersion: 'sciforge.computer-use.request.v1',
          task: 'click the selected button',
        },
      });

      assert.equal(validation.ok, false);
      assert.match(validation.errors.join('\n'), /unsupported_computer_use_primitive_intent/);
    }
  });

  it('strictly rejects task, goal, locate, verify, and raw text fields', () => {
    const actValidation = validateComputerUsePrimitiveInvokeRequest(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-1',
      goal: 'submit the form',
      action: {
        type: 'type',
        elementRef: 'element:search-box',
        text: 'inline raw text is not a refs-first payload',
      },
    }));

    assert.equal(actValidation.ok, false);
    assert.deepEqual(actValidation.errors.sort(), [
      'missing_string:action.textRef',
      'unknown_action_field:text',
      'unknown_input_field:goal',
    ]);

    const procedureValidation = validateComputerUsePrimitiveInvokeRequest(request(COMPUTER_USE_PRIMITIVE_INTENTS.runProcedure, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.runProcedure,
      sessionId: 'cu-session-1',
      task: 'fill and submit the visible form',
      steps: [{
        id: 'step-1',
        primitive: 'locate',
        input: { targetDescription: 'search box' },
      }],
      verify: true,
    }));

    assert.equal(procedureValidation.ok, false);
    assert.ok(procedureValidation.errors.includes('unknown_input_field:task'));
    assert.ok(procedureValidation.errors.includes('unknown_input_field:verify'));
    assert.ok(procedureValidation.errors.includes('invalid_enum:steps[0].primitive'));
  });

  it('requires explicit target binding before a session can be created', () => {
    const validation = validateComputerUsePrimitiveInvokeRequest(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
      },
    }));

    assert.equal(validation.ok, false);
    assert.match(validation.errors.join('\n'), /missing_target_ref/);
  });

  it('covers the complete atomic GUI action surface including drag', () => {
    assert.deepEqual([...COMPUTER_USE_ACTION_TYPES], [
      'click',
      'double_click',
      'type',
      'key',
      'scroll',
      'wait',
      'app_command',
      'drag',
    ]);

    const missingEndpoint = validateComputerUsePrimitiveInvokeRequest(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-1',
      action: {
        type: 'drag',
        point: {
          x: 10,
          y: 10,
          coordinateSpace: 'window',
        },
      },
    }));

    assert.equal(missingEndpoint.ok, false);
    assert.ok(missingEndpoint.errors.includes('missing_action_target:point_and_toPoint'));

    const validDrag = validateComputerUsePrimitiveInvokeRequest(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-1',
      action: {
        type: 'drag',
        point: {
          x: 10,
          y: 10,
          coordinateSpace: 'window',
        },
        toPoint: {
          x: 80,
          y: 10,
          coordinateSpace: 'window',
        },
      },
    }));

    assert.equal(validDrag.ok, true, validDrag.errors.join('\n'));
  });

  it('accepts one minimal valid payload for each atomic action type', () => {
    for (const actionType of COMPUTER_USE_ACTION_TYPES) {
      const validation = validateComputerUsePrimitiveInvokeRequest(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
        schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
        sessionId: 'cu-session-1',
        action: minimalAction(actionType),
      }));

      assert.equal(validation.ok, true, `${actionType}: ${validation.errors.join('\n')}`);
    }
  });

  it('rejects missing required fields for each atomic action type', () => {
    const invalidActions: Array<[typeof COMPUTER_USE_ACTION_TYPES[number], Record<string, unknown>, string]> = [
      ['click', { type: 'click' }, 'missing_action_target:elementRef_or_point'],
      ['double_click', { type: 'double_click' }, 'missing_action_target:elementRef_or_point'],
      ['type', { type: 'type', elementRef: 'element:target' }, 'missing_string:action.textRef'],
      ['key', { type: 'key' }, 'missing_key:action.key_or_keys'],
      ['scroll', { type: 'scroll', elementRef: 'element:target' }, 'missing_enum:action.direction'],
      ['wait', { type: 'wait' }, 'missing_number:action.durationMs'],
      ['app_command', { type: 'app_command' }, 'missing_string:action.command'],
      ['drag', {
        type: 'drag',
        point: {
          x: 1,
          y: 1,
          coordinateSpace: 'window',
        },
      }, 'missing_action_target:point_and_toPoint'],
    ];

    for (const [actionType, action, expectedError] of invalidActions) {
      const validation = validateComputerUsePrimitiveInvokeRequest(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
        schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
        sessionId: 'cu-session-1',
        action,
      }));

      assert.equal(validation.ok, false, `${actionType} should reject missing fields`);
      assert.ok(validation.errors.includes(expectedError), `${actionType}: ${validation.errors.join('\n')}`);
    }
  });

  it('rejects non-finite coordinates for point-based atomic actions', () => {
    const validation = validateComputerUsePrimitiveInvokeRequest(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-1',
      action: {
        type: 'drag',
        point: {
          x: 10,
          y: 10,
          coordinateSpace: 'window',
        },
        toPoint: {
          x: Number.POSITIVE_INFINITY,
          y: 10,
          coordinateSpace: 'window',
        },
      },
    }));

    assert.equal(validation.ok, false);
    assert.ok(validation.errors.includes('invalid_number:action.toPoint.x'));
  });

  it('keeps every action in the action table with explicit evidence requirements', () => {
    assert.deepEqual(Object.keys(COMPUTER_USE_ACTION_REQUIREMENTS).sort(), [...COMPUTER_USE_ACTION_TYPES].sort());
    for (const actionType of COMPUTER_USE_ACTION_TYPES) {
      const requirement = COMPUTER_USE_ACTION_REQUIREMENTS[actionType];
      assert.ok(requirement.required.length > 0, `${actionType} should declare required fields`);
      assert.ok(requirement.evidenceRefs.includes('actionRef'), `${actionType} should require actionRef evidence`);
      assert.ok(requirement.evidenceRefs.includes('executorEventRef'), `${actionType} should require executorEventRef evidence`);
      assert.ok(requirement.evidenceRefs.includes('inputEventRef'), `${actionType} should require inputEventRef evidence`);
      assert.ok(requirement.evidenceRefs.includes('invalidatedRefs'), `${actionType} should require invalidated refs`);
    }
  });
});

describe('computer use primitive service', () => {
  it('fails closed when a primitive host port is missing', async () => {
    const service = createComputerUsePrimitiveService();
    const result = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.observe, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
      sessionId: 'cu-session-1',
    }));

    assert.equal(result.ok, false);
    assert.equal(result.value?.schemaVersion, COMPUTER_USE_PRIMITIVE_RESULT_SCHEMA);
    assert.equal(result.value?.status, 'blocked');
    assert.equal(result.value?.blockedReason, 'missing_computer_use_primitive_port:observe');
    assert.deepEqual(result.refs, []);
  });

  it('blocks high-risk actions without invoking the executor port until approval ref is supplied', async () => {
    const calls: string[] = [];
    const service = createComputerUsePrimitiveService({
      ports: {
        act: async () => {
          calls.push('act');
          return { status: 'completed', refs: ['executor-event:should-not-exist'] };
        },
      },
    });

    const result = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-1',
      action: {
        type: 'app_command',
        command: 'submit',
      },
      risk: {
        level: 'high',
        categories: ['external-side-effect'],
        actionHash: 'risk:submit:1',
      },
    }));

    assert.equal(result.ok, false);
    assert.equal(result.value?.status, 'needs-confirmation');
    assert.equal(result.value?.blockedReason, 'computer_use_action_needs_confirmation');
    assert.deepEqual(calls, []);
  });

  it('requires action-time confirmation for every built-in high-risk app command', async () => {
    const calls: string[] = [];
    const service = createComputerUsePrimitiveService({
      ports: {
        act: async () => {
          calls.push('act');
          return { status: 'completed', refs: ['executor-event:should-not-exist'] };
        },
      },
    });

    for (const command of ['submit', 'send', 'publish', 'upload', 'delete', 'pay', 'authorize']) {
      const result = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
        schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
        sessionId: `cu-session-${command}`,
        action: {
          type: 'app_command',
          command,
        },
      }));

      assert.equal(result.ok, false, command);
      assert.equal(result.value?.status, 'needs-confirmation', command);
      assert.equal(result.value?.blockedReason, 'computer_use_action_needs_confirmation', command);
    }
    assert.deepEqual(calls, []);
  });

  it('requires confirmation for Host-marked cross-boundary or irreversible risk categories', async () => {
    const calls: string[] = [];
    const service = createComputerUsePrimitiveService({
      ports: {
        act: async () => {
          calls.push('act');
          return { status: 'completed', refs: ['executor-event:should-not-exist'] };
        },
      },
    });

    for (const category of ['cross-app', 'cross-window', 'cross-account', 'irreversible']) {
      const result = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
        schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
        sessionId: `cu-session-${category}`,
        action: {
          type: 'click',
          elementRef: `element:${category}:confirm`,
        },
        risk: {
          categories: [category],
          actionHash: `risk:${category}:1`,
        },
      }));

      assert.equal(result.ok, false, category);
      assert.equal(result.value?.status, 'needs-confirmation', category);
      assert.equal(result.value?.blockedReason, 'computer_use_action_needs_confirmation', category);
    }
    assert.deepEqual(calls, []);
  });

  it('blocks high-risk actions when approvalRef is not bound to the current risk envelope', async () => {
    const calls: string[] = [];
    const service = createComputerUsePrimitiveService({
      ports: {
        bind: async () => ({
          status: 'completed',
          output: {
            sessionId: 'cu-session-risk',
            sessionRef: 'computer-use:session:risk',
            targetRef: 'window:risk',
            inputAdapterRef: 'input-adapter:risk',
            cursorRef: 'cursor:risk',
            scopedInputLeaseRef: 'scoped-input-lease:risk',
          },
          refs: [
            'computer-use:session:risk',
            'window:risk',
            'input-adapter:risk',
            'cursor:risk',
            'scoped-input-lease:risk',
          ],
        }),
        act: async () => {
          calls.push('act');
          return {
            status: 'completed',
            output: {
              sessionId: 'cu-session-risk',
              actionRef: 'window-action:risk',
              executorEventRef: 'executor-event:risk',
              inputEventRef: 'input-event:risk',
              beforeObservationRef: 'observation:before:risk',
              afterObservationRef: 'observation:after:risk',
              invalidatedRefs: ['observation:before:risk'],
            },
          };
        },
      },
    });

    const bind = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:risk',
      },
    }));
    assert.equal(bind.ok, true);

    const result = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-risk',
      approvalRef: 'approval:other-risk-envelope',
      action: {
        type: 'app_command',
        command: 'delete',
      },
      risk: {
        level: 'high',
        categories: ['destructive'],
        actionHash: 'risk:delete-visible-owned-test-document',
      },
    }));

    assert.equal(result.ok, false);
    assert.equal(result.value?.status, 'needs-confirmation');
    assert.equal(result.value?.blockedReason, 'computer_use_action_approval_ref_mismatch');
    assert.deepEqual(calls, []);
  });

  it('blocks high-risk run_procedure steps before invoking executor ports', async () => {
    const calls: string[] = [];
    const service = createComputerUsePrimitiveService({
      ports: {
        bind: async () => ({
          status: 'completed',
          output: {
            sessionId: 'cu-session-procedure-risk',
            sessionRef: 'computer-use:session:procedure-risk',
            targetRef: 'window:procedure-risk',
            inputAdapterRef: 'input-adapter:procedure-risk',
            cursorRef: 'cursor:procedure-risk',
            scopedInputLeaseRef: 'scoped-input-lease:procedure-risk',
          },
          refs: [
            'computer-use:session:procedure-risk',
            'window:procedure-risk',
            'input-adapter:procedure-risk',
            'cursor:procedure-risk',
            'scoped-input-lease:procedure-risk',
          ],
        }),
        act: async () => {
          calls.push('act');
          return {
            status: 'completed',
            output: {
              sessionId: 'cu-session-procedure-risk',
              actionRef: 'window-action:procedure-risk',
              executorEventRef: 'executor-event:procedure-risk',
              inputEventRef: 'input-event:procedure-risk',
              beforeObservationRef: 'observation:before:procedure-risk',
              afterObservationRef: 'observation:after:procedure-risk',
              invalidatedRefs: ['observation:before:procedure-risk'],
            },
          };
        },
      },
    });

    const bind = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:procedure-risk',
      },
    }));
    assert.equal(bind.ok, true);

    const result = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.runProcedure, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.runProcedure,
      sessionId: 'cu-session-procedure-risk',
      procedureRef: 'procedure:dangerous-delete',
      steps: [{
        id: 'delete',
        primitive: 'act',
        input: {
          schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
          sessionId: 'cu-session-procedure-risk',
          approvalRef: 'approval:wrong-risk',
          action: {
            type: 'app_command',
            command: 'delete',
          },
          risk: {
            level: 'high',
            categories: ['destructive'],
            actionHash: 'risk:delete-visible-owned-test-document',
          },
        },
      }],
    }));

    assert.equal(result.ok, false);
    assert.equal(result.value?.status, 'needs-confirmation');
    assert.equal(result.value?.blockedReason, 'procedure_step_needs_confirmation:delete');
    assert.deepEqual(calls, []);
    const output = result.value?.output as { stepResults: Array<{ stepId: string; status: string; blockedReason?: string }> };
    assert.deepEqual(output.stepResults, [{
      stepId: 'delete',
      primitive: 'act',
      status: 'needs-confirmation',
      refs: [],
      blockedReason: 'computer_use_action_approval_ref_mismatch',
      diagnostics: [{
        code: 'computer_use_action_approval_ref_mismatch',
        message: 'High-risk Computer Use action approvalRef is not bound to the current risk envelope.',
        severity: 'error',
        retryable: true,
      }],
    }]);
  });

  it('rejects successful bind outputs that do not provide session-scoped input adapter and cursor refs', async () => {
    const service = createComputerUsePrimitiveService({
      ports: {
        bind: async () => ({
          status: 'completed',
          output: {
            sessionId: 'cu-session-missing-isolation',
            sessionRef: 'computer-use:session:missing-isolation',
            targetRef: 'window:missing-isolation',
            scopedInputLeaseRef: 'scoped-input-lease:missing-isolation',
          },
          refs: [
            'computer-use:session:missing-isolation',
            'window:missing-isolation',
            'scoped-input-lease:missing-isolation',
          ],
        }),
      },
    });

    const result = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:missing-isolation',
      },
    }));

    assert.equal(result.ok, false);
    assert.equal(result.value?.status, 'failed');
    assert.equal(result.value?.blockedReason, 'invalid_bind_session_isolation_refs');
    assert.match(result.value?.diagnostics[0]?.message ?? '', /inputAdapterRef.*cursorRef/);
  });

  it('requires each active session to own unique input adapter and cursor refs', async () => {
    let sequence = 0;
    const service = createComputerUsePrimitiveService({
      ports: {
        bind: async () => {
          sequence += 1;
          return {
            status: 'completed',
            output: {
              sessionId: `cu-session-${sequence}`,
              sessionRef: `computer-use:session:${sequence}`,
              targetRef: `window:${sequence}`,
              inputAdapterRef: 'input-adapter:shared',
              cursorRef: 'cursor:shared',
              scopedInputLeaseRef: `scoped-input-lease:${sequence}`,
            },
            refs: [
              `computer-use:session:${sequence}`,
              `window:${sequence}`,
              'input-adapter:shared',
              'cursor:shared',
              `scoped-input-lease:${sequence}`,
            ],
          };
        },
      },
    });

    const first = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:one',
      },
    }));
    assert.equal(first.ok, true);

    const second = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:two',
      },
    }));

    assert.equal(second.ok, false);
    assert.equal(second.value?.blockedReason, 'duplicate_active_session_input_isolation_refs');
  });

  it('records session input adapter and cursor refs on act evidence and blocks act after release before executor invocation', async () => {
    const calls: string[] = [];
    const service = createComputerUsePrimitiveService({
      ports: {
        bind: async () => ({
          status: 'completed',
          output: {
            sessionId: 'cu-session-isolated',
            sessionRef: 'computer-use:session:isolated',
            targetRef: 'window:isolated',
            inputAdapterRef: 'input-adapter:isolated',
            cursorRef: 'cursor:isolated',
            scopedInputLeaseRef: 'scoped-input-lease:isolated',
          },
          refs: [
            'computer-use:session:isolated',
            'window:isolated',
            'input-adapter:isolated',
            'cursor:isolated',
            'scoped-input-lease:isolated',
          ],
        }),
        act: async (input) => {
          calls.push(`act:${input.sessionId}`);
          assert.equal(input.inputAdapterRef, 'input-adapter:isolated');
          assert.equal(input.cursorRef, 'cursor:isolated');
          assert.equal(input.scopedInputLeaseRef, 'scoped-input-lease:isolated');
          return {
            status: 'completed',
            output: {
              sessionId: input.sessionId,
              actionRef: 'window-action:isolated:1',
              executorEventRef: 'executor-event:isolated:1',
              inputEventRef: 'input-event:isolated:1',
              inputAdapterRef: input.inputAdapterRef,
              cursorRef: input.cursorRef,
              scopedInputLeaseRef: input.scopedInputLeaseRef,
              beforeObservationRef: 'observation:before:isolated:1',
              afterObservationRef: 'observation:after:isolated:1',
              invalidatedRefs: ['observation:stale:isolated:1'],
            },
            refs: [
              'window-action:isolated:1',
              'executor-event:isolated:1',
              'input-event:isolated:1',
              'input-adapter:isolated',
              'cursor:isolated',
              'observation:stale:isolated:1',
            ],
          };
        },
        control: async (input) => {
          calls.push(`control:${input.command}`);
          return {
            status: 'completed',
            output: {
              sessionId: input.sessionId,
              controlRef: 'control:release:isolated',
              releasedRefs: [
                'scoped-input-lease:isolated',
                'input-adapter:isolated',
                'cursor:isolated',
              ],
            },
            refs: [
              'control:release:isolated',
              'scoped-input-lease:isolated',
              'input-adapter:isolated',
              'cursor:isolated',
            ],
          };
        },
      },
    });

    const bind = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:isolated',
      },
    }));
    assert.equal(bind.ok, true);

    const act = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-isolated',
      action: {
        type: 'click',
        elementRef: 'element:button',
      },
    }));
    assert.equal(act.ok, true);
    const actOutput = act.value?.output as { inputAdapterRef: string; cursorRef: string; scopedInputLeaseRef: string };
    assert.equal(actOutput.inputAdapterRef, 'input-adapter:isolated');
    assert.equal(actOutput.cursorRef, 'cursor:isolated');
    assert.equal(actOutput.scopedInputLeaseRef, 'scoped-input-lease:isolated');

    const release = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.control, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control,
      sessionId: 'cu-session-isolated',
      command: 'release',
      reasonRef: 'reason:done',
    }));
    assert.equal(release.ok, true);

    const blocked = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-isolated',
      action: {
        type: 'click',
        elementRef: 'element:button',
      },
    }));

    assert.equal(blocked.ok, false);
    assert.equal(blocked.value?.blockedReason, 'computer_use_session_released');
    assert.deepEqual(calls, [
      'act:cu-session-isolated',
      'control:release',
    ]);
  });

  it('blocks unknown-session act before executor invocation', async () => {
    const calls: string[] = [];
    const service = createComputerUsePrimitiveService({
      ports: {
        act: async () => {
          calls.push('act');
          return {
            status: 'completed',
            output: {
              sessionId: 'cu-session-missing',
              actionRef: 'window-action:missing',
              executorEventRef: 'executor-event:missing',
              inputEventRef: 'input-event:missing',
              beforeObservationRef: 'observation:before:missing',
              afterObservationRef: 'observation:after:missing',
              invalidatedRefs: ['observation:before:missing'],
            },
          };
        },
      },
    });

    const result = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-missing',
      action: {
        type: 'click',
        elementRef: 'element:missing',
      },
    }));

    assert.equal(result.ok, false);
    assert.equal(result.value?.blockedReason, 'unknown_computer_use_session');
    assert.deepEqual(calls, []);
  });

  it('fails closed when an act port reports adapter or cursor refs outside the bound session scope', async () => {
    const service = createComputerUsePrimitiveService({
      ports: {
        bind: async () => ({
          status: 'completed',
          output: {
            sessionId: 'cu-session-scope',
            sessionRef: 'computer-use:session:scope',
            targetRef: 'window:scope',
            inputAdapterRef: 'input-adapter:scope',
            cursorRef: 'cursor:scope',
            scopedInputLeaseRef: 'scoped-input-lease:scope',
          },
          refs: [
            'computer-use:session:scope',
            'window:scope',
            'input-adapter:scope',
            'cursor:scope',
            'scoped-input-lease:scope',
          ],
        }),
        act: async (input) => ({
          status: 'completed',
          output: {
            sessionId: input.sessionId,
            actionRef: 'window-action:scope',
            executorEventRef: 'executor-event:scope',
            inputEventRef: 'input-event:scope',
            inputAdapterRef: 'input-adapter:other',
            cursorRef: input.cursorRef,
            scopedInputLeaseRef: input.scopedInputLeaseRef,
            beforeObservationRef: 'observation:before:scope',
            afterObservationRef: 'observation:after:scope',
            invalidatedRefs: ['observation:before:scope'],
          },
          refs: ['window-action:scope', 'executor-event:scope', 'input-event:scope'],
        }),
      },
    });

    const bind = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:scope',
      },
    }));
    assert.equal(bind.ok, true);

    const act = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-scope',
      action: {
        type: 'click',
        elementRef: 'element:scope',
      },
    }));

    assert.equal(act.ok, false);
    assert.equal(act.value?.blockedReason, 'computer_use_session_input_scope_mismatch');
  });

  it('fails closed when observe or act ports complete without required evidence refs', async () => {
    const service = createComputerUsePrimitiveService({
      ports: {
        bind: async () => ({
          status: 'completed',
          output: {
            sessionId: 'cu-session-evidence',
            sessionRef: 'computer-use:session:evidence',
            targetRef: 'window:evidence',
            inputAdapterRef: 'input-adapter:evidence',
            cursorRef: 'cursor:evidence',
            scopedInputLeaseRef: 'scoped-input-lease:evidence',
          },
          refs: [
            'computer-use:session:evidence',
            'window:evidence',
            'input-adapter:evidence',
            'cursor:evidence',
            'scoped-input-lease:evidence',
          ],
        }),
        observe: async (input) => ({
          status: 'completed',
          output: {
            sessionId: input.sessionId,
            observationRef: 'observation:evidence:missing',
          },
          refs: ['observation:evidence:missing'],
        }),
        act: async (input) => ({
          status: 'completed',
          output: {
            sessionId: input.sessionId,
            actionRef: 'window-action:evidence:missing',
            executorEventRef: 'executor-event:evidence:missing',
            inputAdapterRef: input.inputAdapterRef,
            cursorRef: input.cursorRef,
            scopedInputLeaseRef: input.scopedInputLeaseRef,
          },
          refs: ['window-action:evidence:missing', 'executor-event:evidence:missing'],
        }),
      },
    });

    const bind = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:evidence',
      },
    }));
    assert.equal(bind.ok, true);

    const observe = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.observe, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
      sessionId: 'cu-session-evidence',
      capture: 'both',
    }));
    assert.equal(observe.ok, false);
    assert.equal(observe.value?.blockedReason, 'invalid_observe_evidence_refs');

    const act = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: 'cu-session-evidence',
      action: {
        type: 'click',
        elementRef: 'element:evidence',
      },
    }));
    assert.equal(act.ok, false);
    assert.equal(act.value?.blockedReason, 'invalid_act_evidence_refs');
  });

  it('delegates bind, observe, act, and control through structured refs', async () => {
    const calls: string[] = [];
    const ports: ComputerUsePrimitivePorts = {
      bind: async (input) => {
        calls.push(`bind:${input.target.kind}`);
        return {
          status: 'completed',
          output: {
            sessionId: 'cu-session-1',
            sessionRef: 'computer-use:session:1',
            targetRef: input.target.windowRef,
            inputAdapterRef: 'input-adapter:window:1',
            cursorRef: 'cursor:window:1',
            scopedInputLeaseRef: 'lease:window:1',
          },
          refs: ['computer-use:session:1', 'window:TextEdit:1', 'input-adapter:window:1', 'cursor:window:1', 'lease:window:1'],
        };
      },
      observe: async (input) => {
        calls.push(`observe:${input.sessionId}`);
        return {
          status: 'completed',
          output: {
            sessionId: input.sessionId,
            observationRef: 'observation:before:1',
            screenshotRef: 'image:before:1',
            accessibilityRef: 'accessibility:before:1',
            elementRefs: ['element:save-button'],
            textRefs: ['text:save-button-label'],
          },
          refs: ['observation:before:1', 'image:before:1', 'accessibility:before:1', 'element:save-button', 'text:save-button-label'],
        };
      },
      act: async (input) => {
        calls.push(`act:${input.action.type}`);
        return {
          status: 'completed',
          output: {
            sessionId: input.sessionId,
            actionRef: 'window-action:click:1',
            executorEventRef: 'executor-event:click:1',
            inputEventRef: 'input-event:click:1',
            inputAdapterRef: input.inputAdapterRef,
            cursorRef: input.cursorRef,
            scopedInputLeaseRef: input.scopedInputLeaseRef,
            beforeObservationRef: 'observation:before:1',
            afterObservationRef: 'observation:after:1',
            invalidatedRefs: ['observation:before:1'],
          },
          refs: ['window-action:click:1', 'executor-event:click:1', 'input-event:click:1', 'observation:after:1'],
        };
      },
      control: async (input) => {
        calls.push(`control:${input.command}`);
        return {
          status: 'completed',
          output: {
            sessionId: input.sessionId,
            controlRef: 'control:release:1',
            releasedRefs: [input.scopedInputLeaseRef ?? '', input.inputAdapterRef ?? '', input.cursorRef ?? ''],
          },
          refs: ['control:release:1'],
        };
      },
    };
    const service = createComputerUsePrimitiveService({ ports });

    const bind = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:TextEdit:1',
      },
      riskPolicy: 'fail-closed',
    }));
    assert.equal(bind.ok, true);
    const bindOutput = bind.value?.output as { sessionId: string };

    const observe = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.observe, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
      sessionId: bindOutput.sessionId,
      capture: 'both',
    }));
    assert.equal(observe.ok, true);

    const act = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: bindOutput.sessionId,
      action: {
        type: 'click',
        elementRef: 'element:save-button',
      },
      captureAfter: true,
    }));
    assert.equal(act.ok, true);

    const control = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.control, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control,
      sessionId: bindOutput.sessionId,
      command: 'release',
      reasonRef: 'reason:done',
    }));
    assert.equal(control.ok, true);

    assert.deepEqual(calls, [
      'bind:window',
      'observe:cu-session-1',
      'act:click',
      'control:release',
    ]);
  });

  it('delegates every atomic action through act with scoped refs and required evidence', async () => {
    const delegatedActions: string[] = [];
    const service = createComputerUsePrimitiveService({
      ports: {
        bind: async () => ({
          status: 'completed',
          output: {
            sessionId: 'cu-session-actions',
            sessionRef: 'computer-use:session:actions',
            targetRef: 'window:actions',
            inputAdapterRef: 'input-adapter:actions',
            cursorRef: 'cursor:actions',
            scopedInputLeaseRef: 'scoped-input-lease:actions',
          },
          refs: [
            'computer-use:session:actions',
            'window:actions',
            'input-adapter:actions',
            'cursor:actions',
            'scoped-input-lease:actions',
          ],
        }),
        act: async (input) => {
          delegatedActions.push(input.action.type);
          assert.equal(input.inputAdapterRef, 'input-adapter:actions');
          assert.equal(input.cursorRef, 'cursor:actions');
          assert.equal(input.scopedInputLeaseRef, 'scoped-input-lease:actions');
          return {
            status: 'completed',
            output: {
              sessionId: input.sessionId,
              actionRef: `window-action:${input.action.type}:1`,
              executorEventRef: `executor-event:${input.action.type}:1`,
              inputEventRef: `input-event:${input.action.type}:1`,
              inputAdapterRef: input.inputAdapterRef,
              cursorRef: input.cursorRef,
              scopedInputLeaseRef: input.scopedInputLeaseRef,
              beforeObservationRef: `observation:before:${input.action.type}:1`,
              afterObservationRef: `observation:after:${input.action.type}:1`,
              invalidatedRefs: [`observation:before:${input.action.type}:1`],
            },
            refs: [
              `window-action:${input.action.type}:1`,
              `executor-event:${input.action.type}:1`,
              `input-event:${input.action.type}:1`,
              `observation:before:${input.action.type}:1`,
              `observation:after:${input.action.type}:1`,
            ],
          };
        },
      },
    });

    const bind = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:actions',
      },
    }));
    assert.equal(bind.ok, true);

    for (const actionType of COMPUTER_USE_ACTION_TYPES) {
      const result = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.act, {
        schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
        sessionId: 'cu-session-actions',
        action: minimalAction(actionType),
      }));
      assert.equal(result.ok, true, actionType);
      assert.equal(result.value?.status, 'completed', actionType);
      const output = result.value?.output as {
        actionRef: string;
        executorEventRef: string;
        inputEventRef: string;
        invalidatedRefs: string[];
      };
      assert.match(output.actionRef, new RegExp(`window-action:${actionType}`));
      assert.match(output.executorEventRef, new RegExp(`executor-event:${actionType}`));
      assert.match(output.inputEventRef, new RegExp(`input-event:${actionType}`));
      assert.ok(output.invalidatedRefs.length > 0, `${actionType} should invalidate stale observations`);
    }

    assert.deepEqual(delegatedActions, [...COMPUTER_USE_ACTION_TYPES]);
  });

  it('runs local structured procedures without owning locate, repair, verify, or completion truth', async () => {
    const calls: string[] = [];
    const service = createComputerUsePrimitiveService({
      ports: {
        bind: async () => ({
          status: 'completed',
          output: {
            sessionId: 'cu-session-1',
            sessionRef: 'computer-use:session:1',
            targetRef: 'window:procedure',
            inputAdapterRef: 'input-adapter:procedure:1',
            cursorRef: 'cursor:procedure:1',
            scopedInputLeaseRef: 'scoped-input-lease:procedure:1',
          },
          refs: [
            'computer-use:session:1',
            'window:procedure',
            'input-adapter:procedure:1',
            'cursor:procedure:1',
            'scoped-input-lease:procedure:1',
          ],
        }),
        observe: async (input) => {
          calls.push(`observe:${input.sessionId}`);
          return {
            status: 'completed',
            output: {
              sessionId: input.sessionId,
              observationRef: `observation:${calls.length}`,
              screenshotRef: `image:${calls.length}`,
              accessibilityRef: `accessibility:${calls.length}`,
              elementRefs: ['element:search-box'],
              textRefs: ['text:query:1'],
            },
            refs: [`observation:${calls.length}`, `image:${calls.length}`, `accessibility:${calls.length}`, 'element:search-box', 'text:query:1'],
          };
        },
        act: async (input) => {
          calls.push(`act:${input.action.type}`);
          return {
            status: 'completed',
            output: {
              sessionId: input.sessionId,
              actionRef: 'window-action:type:1',
              executorEventRef: 'executor-event:type:1',
              inputEventRef: 'input-event:type:1',
              inputAdapterRef: input.inputAdapterRef,
              cursorRef: input.cursorRef,
              scopedInputLeaseRef: input.scopedInputLeaseRef,
              beforeObservationRef: 'observation:1',
              afterObservationRef: 'observation:2',
              invalidatedRefs: ['observation:1'],
            },
            refs: ['window-action:type:1', 'executor-event:type:1', 'input-event:type:1'],
          };
        },
      },
    });

    const bind = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.bind, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        windowRef: 'window:procedure',
      },
    }));
    assert.equal(bind.ok, true);

    const result = await service.invoke(request(COMPUTER_USE_PRIMITIVE_INTENTS.runProcedure, {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.runProcedure,
      sessionId: 'cu-session-1',
      procedureRef: 'procedure:fill-search-box',
      steps: [
        {
          id: 'observe-before',
          primitive: 'observe',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
            sessionId: 'cu-session-1',
            capture: 'screenshot',
          },
        },
        {
          id: 'type-query',
          primitive: 'act',
          input: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
            sessionId: 'cu-session-1',
            action: {
              type: 'type',
              elementRef: 'element:search-box',
              textRef: 'text:query:1',
            },
          },
        },
      ],
    }));

    assert.equal(result.ok, true);
    assert.equal(result.value?.primitive, 'run_procedure');
    assert.equal(result.value?.status, 'completed');
    assert.deepEqual(result.refs, [
      'observation:1',
      'image:1',
      'accessibility:1',
      'element:search-box',
      'text:query:1',
      'window-action:type:1',
      'executor-event:type:1',
      'input-event:type:1',
      'input-adapter:procedure:1',
      'cursor:procedure:1',
      'scoped-input-lease:procedure:1',
    ]);
    assert.deepEqual(calls, [
      'observe:cu-session-1',
      'act:type',
    ]);

    const output = result.value?.output as {
      procedureRef: string;
      stepResults: Array<{ stepId: string; primitive: string; status: string; refs: string[] }>;
      completionTruth: unknown;
    };
    assert.equal(output.procedureRef, 'procedure:fill-search-box');
    assert.deepEqual(output.stepResults.map((step) => [step.stepId, step.primitive, step.status, step.refs]), [
      ['observe-before', 'observe', 'completed', ['observation:1', 'image:1', 'accessibility:1', 'element:search-box', 'text:query:1']],
      ['type-query', 'act', 'completed', [
        'window-action:type:1',
        'executor-event:type:1',
        'input-event:type:1',
        'input-adapter:procedure:1',
        'cursor:procedure:1',
        'scoped-input-lease:procedure:1',
      ]],
    ]);
    assert.equal('completionTruth' in output, false);
  });
});

describe('computer use MCP adapter', () => {
  it('publishes only primitive tools and never advertises runTask', () => {
    const tools = computerUseMcpTools();

    assert.deepEqual(tools.map((tool) => tool.name), [
      COMPUTER_USE_PRIMITIVE_INTENTS.bind,
      COMPUTER_USE_PRIMITIVE_INTENTS.observe,
      COMPUTER_USE_PRIMITIVE_INTENTS.act,
      COMPUTER_USE_PRIMITIVE_INTENTS.runProcedure,
      COMPUTER_USE_PRIMITIVE_INTENTS.control,
    ]);
    assert.equal(JSON.stringify(tools).includes('runTask'), false);
    assert.equal(JSON.stringify(tools).includes('"drag"'), true);
    assert.equal(JSON.stringify(tools).includes('"toPoint"'), true);
  });

  it('keeps MCP action schema aligned with TS action-specific required payloads', () => {
    const actTool = computerUseMcpTools().find((tool) => tool.name === COMPUTER_USE_PRIMITIVE_INTENTS.act);
    assert.ok(actTool);
    const action = recordAt(recordAt(actTool.inputSchema, 'properties'), 'action');
    const oneOf = arrayAt(action, 'oneOf');
    assert.equal(oneOf.length, COMPUTER_USE_ACTION_TYPES.length);

    const expected = new Map<string, { required: string[]; anyOf?: string[][] }>([
      ['click', { required: ['type'], anyOf: [['elementRef'], ['point']] }],
      ['double_click', { required: ['type'], anyOf: [['elementRef'], ['point']] }],
      ['type', { required: ['type', 'textRef'] }],
      ['key', { required: ['type'], anyOf: [['key'], ['keys']] }],
      ['scroll', { required: ['type', 'direction'] }],
      ['wait', { required: ['type', 'durationMs'] }],
      ['app_command', { required: ['type', 'command'] }],
      ['drag', { required: ['type', 'point', 'toPoint'] }],
    ]);

    for (const branch of oneOf) {
      const branchRecord = branch as Record<string, unknown>;
      const typeConst = stringAt(recordAt(recordAt(branchRecord, 'properties'), 'type'), 'const');
      assert.ok(typeConst, `missing action type const in ${JSON.stringify(branchRecord)}`);
      const requirement = expected.get(typeConst);
      assert.ok(requirement, `unexpected MCP action branch ${typeConst}`);
      assert.deepEqual(arrayAt(branchRecord, 'required').sort(), requirement.required.sort(), typeConst);
      if (requirement.anyOf) {
        assert.deepEqual(
          arrayAt(branchRecord, 'anyOf').map((item) => arrayAt(item, 'required').sort()),
          requirement.anyOf.map((item) => [...item].sort()),
          typeConst,
        );
      }
    }
  });

  it('keeps MCP bind target schema aligned with TS missing target ref validation', () => {
    const bindTool = computerUseMcpTools().find((tool) => tool.name === COMPUTER_USE_PRIMITIVE_INTENTS.bind);
    assert.ok(bindTool);
    const target = recordAt(recordAt(bindTool.inputSchema, 'properties'), 'target');
    assert.deepEqual(arrayAt(target, 'required'), ['kind']);
    assert.deepEqual(
      arrayAt(target, 'anyOf').map((item) => arrayAt(item, 'required')),
      [
        ['targetRef'],
        ['windowRef'],
        ['appRef'],
        ['displayRef'],
        ['regionRef'],
        ['remoteSessionRef'],
        ['windowId'],
        ['appId'],
        ['titleContains'],
      ],
    );
  });

  it('adapts MCP tool calls to module invoke requests', async () => {
    const calls: ModuleInvokeRequest[] = [];
    const adapter = createComputerUseMcpAdapter({
      describe: () => {
        throw new Error('not used by this adapter test');
      },
      invoke: async (input) => {
        calls.push(input);
        return moduleResult({
          moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
          ok: true,
          value: {
            schemaVersion: COMPUTER_USE_PRIMITIVE_RESULT_SCHEMA,
            moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
            primitive: 'observe',
            status: 'completed',
            refs: ['observation:1'],
            diagnostics: [],
            budget: {},
          },
          refs: ['observation:1'],
        });
      },
    });

    const result = await adapter.callTool({
      name: COMPUTER_USE_PRIMITIVE_INTENTS.observe,
      arguments: {
        schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
        sessionId: 'cu-session-1',
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls, [{
      moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
      intent: COMPUTER_USE_PRIMITIVE_INTENTS.observe,
      input: {
        schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
        sessionId: 'cu-session-1',
      },
    }]);
  });
});

function request(intent: string, input: Record<string, unknown>): ModuleInvokeRequest {
  return {
    moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
    intent,
    input,
  };
}

function minimalAction(actionType: typeof COMPUTER_USE_ACTION_TYPES[number]) {
  if (actionType === 'click' || actionType === 'double_click') {
    return { type: actionType, elementRef: 'element:target' };
  }
  if (actionType === 'type') {
    return { type: actionType, elementRef: 'element:target', textRef: 'text:payload' };
  }
  if (actionType === 'key') {
    return { type: actionType, key: 'Enter' };
  }
  if (actionType === 'scroll') {
    return { type: actionType, elementRef: 'element:target', direction: 'down', amount: 1 };
  }
  if (actionType === 'wait') {
    return { type: actionType, durationMs: 100 };
  }
  if (actionType === 'app_command') {
    return { type: actionType, command: 'select_all' };
  }
  return {
    type: actionType,
    point: {
      x: 10,
      y: 10,
      coordinateSpace: 'window',
    },
    toPoint: {
      x: 40,
      y: 10,
      coordinateSpace: 'window',
    },
  };
}

function recordAt(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : undefined;
}

function arrayAt(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const item = (value as Record<string, unknown>)[key];
  return Array.isArray(item) ? item : [];
}

function stringAt(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === 'string' ? item : undefined;
}
