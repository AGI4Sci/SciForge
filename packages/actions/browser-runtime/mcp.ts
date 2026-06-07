import type { ModuleInvokeRequest } from '@sciforge-ui/runtime-contract/modules';
import {
  BROWSER_EXTRACT_TARGETS,
  BROWSER_PRIMITIVE_INPUT_SCHEMAS,
  BROWSER_PRIMITIVE_INTENTS,
  BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
  type BrowserPrimitiveService,
} from './index.js';

export const BROWSER_RUNTIME_MCP_PACKAGE_ID = '@agi4sci/sciforge-browser-runtime-action-provider' as const;
export const BROWSER_RUNTIME_MCP_SERVER_NAME = 'sciforge-browser-runtime' as const;

export interface BrowserRuntimeMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BrowserRuntimeMcpCallToolRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

export function browserRuntimeMcpTools(): BrowserRuntimeMcpToolDefinition[] {
  return [
    {
      name: BROWSER_PRIMITIVE_INTENTS.search,
      description: 'Discover candidate web pages for a Host-provided query. Does not read result pages.',
      inputSchema: objectSchema(['schemaVersion', 'query'], {
        schemaVersion: { const: BROWSER_PRIMITIVE_INPUT_SCHEMAS.search },
        query: { type: 'string', minLength: 1 },
        engine: { enum: ['bing', 'duckduckgo'] },
        locale: { type: 'string' },
        region: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
        budget: budgetSchema(),
        constraints: constraintsSchema(),
      }),
    },
    {
      name: BROWSER_PRIMITIVE_INTENTS.navigate,
      description: 'Navigate to a Host-provided HTTP(S) URL and return browser session refs.',
      inputSchema: objectSchema(['schemaVersion', 'url'], {
        schemaVersion: { const: BROWSER_PRIMITIVE_INPUT_SCHEMAS.navigate },
        url: { type: 'string', format: 'uri' },
        sessionId: { type: 'string' },
        timeoutMs: { type: 'number', exclusiveMinimum: 0 },
        capture: { enum: ['none', 'frame', 'screenshot'] },
        constraints: constraintsSchema(),
      }),
    },
    {
      name: BROWSER_PRIMITIVE_INTENTS.observe,
      description: 'Observe an existing browser session and return current state refs.',
      inputSchema: objectSchema(['schemaVersion', 'sessionId'], {
        schemaVersion: { const: BROWSER_PRIMITIVE_INPUT_SCHEMAS.observe },
        sessionId: { type: 'string', minLength: 1 },
        timeoutMs: { type: 'number', exclusiveMinimum: 0 },
        capture: { enum: ['none', 'frame', 'screenshot'] },
      }),
    },
    {
      name: BROWSER_PRIMITIVE_INTENTS.read,
      description: 'Materialize page content from a session or explicitly ephemeral URL into refs-first source evidence.',
      inputSchema: objectSchema(['schemaVersion'], {
        schemaVersion: { const: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read },
        sessionId: { type: 'string' },
        url: { type: 'string', format: 'uri' },
        navigationMode: { enum: ['none', 'ephemeral'] },
        includeText: { type: 'boolean' },
        includeHtml: { type: 'boolean' },
        maxTextChars: { type: 'integer', minimum: 1, maximum: 1_000_000 },
        timeoutMs: { type: 'number', exclusiveMinimum: 0 },
      }),
    },
    {
      name: BROWSER_PRIMITIVE_INTENTS.extract,
      description: 'Parse already materialized refs for links, forms, dates, metadata, or repeated result items.',
      inputSchema: objectSchema(['schemaVersion', 'ref', 'extract'], {
        schemaVersion: { const: BROWSER_PRIMITIVE_INPUT_SCHEMAS.extract },
        ref: { type: 'string', minLength: 1 },
        extract: {
          type: 'array',
          minItems: 1,
          items: { enum: [...BROWSER_EXTRACT_TARGETS] },
        },
        maxItems: { type: 'integer', minimum: 1, maximum: 10_000 },
      }),
    },
    {
      name: BROWSER_PRIMITIVE_INTENTS.download,
      description: 'Download a Host-selected remote resource into session-scoped artifacts.',
      inputSchema: objectSchema(['schemaVersion', 'saveScope'], {
        schemaVersion: { const: BROWSER_PRIMITIVE_INPUT_SCHEMAS.download },
        url: { type: 'string', format: 'uri' },
        sessionId: { type: 'string' },
        linkSelector: { type: 'string' },
        saveScope: { const: 'session-artifacts' },
        maxBytes: { type: 'number', exclusiveMinimum: 0 },
        timeoutMs: { type: 'number', exclusiveMinimum: 0 },
        filenameHint: { type: 'string' },
      }),
    },
  ];
}

export function createBrowserRuntimeMcpAdapter(service: BrowserPrimitiveService) {
  return {
    tools: browserRuntimeMcpTools,
    callTool: async (request: BrowserRuntimeMcpCallToolRequest) => {
      const moduleRequest: ModuleInvokeRequest = {
        moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
        intent: request.name,
        input: request.arguments ?? {},
      };
      return service.invoke(moduleRequest);
    },
  };
}

function objectSchema(required: string[], properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

function budgetSchema() {
  return objectSchema([], {
    maxTimeMs: { type: 'number', exclusiveMinimum: 0 },
    elapsedMs: { type: 'number', minimum: 0 },
    maxBytes: { type: 'number', exclusiveMinimum: 0 },
    bytesRead: { type: 'number', minimum: 0 },
  });
}

function constraintsSchema() {
  return objectSchema([], {
    allowedDomains: { type: 'array', items: { type: 'string' } },
    blockedDomains: { type: 'array', items: { type: 'string' } },
    safeSearch: { enum: ['off', 'moderate', 'strict'] },
    requireUserConfirmationForCrossOrigin: { type: 'boolean' },
  });
}
