import type { ModuleInvokeRequest } from '@sciforge-ui/runtime-contract/modules';
import {
  COMPUTER_USE_ACTION_TYPES,
  COMPUTER_USE_CAPTURE_MODES,
  COMPUTER_USE_CONTROL_COMMANDS,
  COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS,
  COMPUTER_USE_PRIMITIVE_INTENTS,
  COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
  COMPUTER_USE_PROCEDURE_STEP_PRIMITIVES,
  COMPUTER_USE_TARGET_KINDS,
  type ComputerUsePrimitiveService,
} from './index.js';

export const COMPUTER_USE_MCP_PACKAGE_ID = '@agi4sci/sciforge-computer-use-action-provider' as const;
export const COMPUTER_USE_MCP_SERVER_NAME = 'sciforge-computer-use' as const;

export interface ComputerUseMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ComputerUseMcpCallToolRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

export function computerUseMcpTools(): ComputerUseMcpToolDefinition[] {
  return [
    {
      name: COMPUTER_USE_PRIMITIVE_INTENTS.bind,
      description: 'Bind a Host-selected desktop target and return scoped Computer Use session refs.',
      inputSchema: objectSchema(['schemaVersion', 'target'], {
        schemaVersion: { const: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind },
        target: targetSchema(),
        riskPolicy: { enum: ['fail-closed', 'allow-confirmed'] },
        approvalRef: { type: 'string', minLength: 1 },
        budget: budgetSchema(),
      }),
    },
    {
      name: COMPUTER_USE_PRIMITIVE_INTENTS.observe,
      description: 'Observe an existing bound target and return refs-first GUI evidence.',
      inputSchema: observeInputSchema(),
    },
    {
      name: COMPUTER_USE_PRIMITIVE_INTENTS.act,
      description: 'Execute one Host-selected atomic GUI action against an existing session.',
      inputSchema: actInputSchema(),
    },
    {
      name: COMPUTER_USE_PRIMITIVE_INTENTS.runProcedure,
      description: 'Execute Host-specified local primitive steps without planning, locating, repair, verification, or completion truth.',
      inputSchema: objectSchema(['schemaVersion', 'sessionId', 'steps'], {
        schemaVersion: { const: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.runProcedure },
        sessionId: { type: 'string', minLength: 1 },
        procedureRef: { type: 'string', minLength: 1 },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: procedureStepSchema(),
        },
        budget: budgetSchema(),
      }),
    },
    {
      name: COMPUTER_USE_PRIMITIVE_INTENTS.control,
      description: 'Pause, resume, cancel, stop, or release a scoped Computer Use session.',
      inputSchema: controlInputSchema(),
    },
  ];
}

export function createComputerUseMcpAdapter(service: ComputerUsePrimitiveService) {
  return {
    tools: computerUseMcpTools,
    callTool: async (request: ComputerUseMcpCallToolRequest) => {
      const moduleRequest: ModuleInvokeRequest = {
        moduleId: COMPUTER_USE_PRIMITIVE_SERVICE_MODULE_ID,
        intent: request.name,
        input: request.arguments ?? {},
      };
      return service.invoke(moduleRequest);
    },
  };
}

function targetSchema() {
  return {
    ...objectSchema(['kind'], {
    kind: { enum: [...COMPUTER_USE_TARGET_KINDS] },
    targetRef: { type: 'string', minLength: 1 },
    windowRef: { type: 'string', minLength: 1 },
    appRef: { type: 'string', minLength: 1 },
    displayRef: { type: 'string', minLength: 1 },
    regionRef: { type: 'string', minLength: 1 },
    remoteSessionRef: { type: 'string', minLength: 1 },
    windowId: { type: 'string', minLength: 1 },
    appId: { type: 'string', minLength: 1 },
    titleContains: { type: 'string', minLength: 1 },
    }),
    anyOf: [
      { required: ['targetRef'] },
      { required: ['windowRef'] },
      { required: ['appRef'] },
      { required: ['displayRef'] },
      { required: ['regionRef'] },
      { required: ['remoteSessionRef'] },
      { required: ['windowId'] },
      { required: ['appId'] },
      { required: ['titleContains'] },
    ],
  };
}

function observeInputSchema() {
  return objectSchema(['schemaVersion', 'sessionId'], {
    schemaVersion: { const: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe },
    sessionId: { type: 'string', minLength: 1 },
    capture: { enum: [...COMPUTER_USE_CAPTURE_MODES] },
    includeTree: { type: 'boolean' },
    budget: budgetSchema(),
  });
}

function actInputSchema() {
  return objectSchema(['schemaVersion', 'sessionId', 'action'], {
    schemaVersion: { const: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act },
    sessionId: { type: 'string', minLength: 1 },
    actionId: { type: 'string', minLength: 1 },
    action: actionSchema(),
    captureAfter: { type: 'boolean' },
    risk: riskSchema(),
    approvalRef: { type: 'string', minLength: 1 },
    budget: budgetSchema(),
  });
}

function controlInputSchema() {
  return objectSchema(['schemaVersion', 'sessionId', 'command'], {
    schemaVersion: { const: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control },
    sessionId: { type: 'string', minLength: 1 },
    command: { enum: [...COMPUTER_USE_CONTROL_COMMANDS] },
    reasonRef: { type: 'string', minLength: 1 },
    budget: budgetSchema(),
  });
}

function procedureStepSchema() {
  return objectSchema(['id', 'primitive', 'input'], {
    id: { type: 'string', minLength: 1 },
    primitive: { enum: [...COMPUTER_USE_PROCEDURE_STEP_PRIMITIVES] },
    input: {
      oneOf: [
        observeInputSchema(),
        actInputSchema(),
        controlInputSchema(),
      ],
    },
  });
}

function actionSchema() {
  const properties = {
    type: { enum: [...COMPUTER_USE_ACTION_TYPES] },
    elementRef: { type: 'string', minLength: 1 },
    point: objectSchema(['x', 'y', 'coordinateSpace'], {
      x: { type: 'number' },
      y: { type: 'number' },
      coordinateSpace: { enum: ['screen', 'window', 'element'] },
    }),
    toPoint: objectSchema(['x', 'y', 'coordinateSpace'], {
      x: { type: 'number' },
      y: { type: 'number' },
      coordinateSpace: { enum: ['screen', 'window', 'element'] },
    }),
    textRef: { type: 'string', minLength: 1 },
    key: { type: 'string', minLength: 1 },
    keys: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    direction: { enum: ['up', 'down', 'left', 'right'] },
    amount: { type: 'number', exclusiveMinimum: 0 },
    durationMs: { type: 'number', exclusiveMinimum: 0 },
    command: { type: 'string', minLength: 1 },
  };
  return {
    ...objectSchema(['type'], properties),
    oneOf: [
      actionBranch('click', ['type'], [['elementRef'], ['point']]),
      actionBranch('double_click', ['type'], [['elementRef'], ['point']]),
      actionBranch('type', ['type', 'textRef']),
      actionBranch('key', ['type'], [['key'], ['keys']]),
      actionBranch('scroll', ['type', 'direction']),
      actionBranch('wait', ['type', 'durationMs']),
      actionBranch('app_command', ['type', 'command']),
      actionBranch('drag', ['type', 'point', 'toPoint']),
    ],
  };
}

function actionBranch(type: string, required: string[], anyOf?: string[][]) {
  return {
    required,
    properties: {
      type: { const: type },
    },
    ...(anyOf ? { anyOf: anyOf.map((fields) => ({ required: fields })) } : {}),
  };
}

function riskSchema() {
  return objectSchema([], {
    level: { enum: ['low', 'medium', 'high'] },
    categories: { type: 'array', items: { type: 'string', minLength: 1 } },
    actionHash: { type: 'string', minLength: 1 },
  });
}

function budgetSchema() {
  return objectSchema([], {
    maxTimeMs: { type: 'number', exclusiveMinimum: 0 },
    elapsedMs: { type: 'number', minimum: 0 },
    maxSteps: { type: 'integer', minimum: 1, maximum: 50 },
    stepsUsed: { type: 'integer', minimum: 0, maximum: 50 },
  });
}

function objectSchema(required: string[], properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}
