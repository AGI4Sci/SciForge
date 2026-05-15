export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type ToolSideEffect = 'none' | 'read' | 'network' | 'write' | 'desktop' | 'external';
export type ToolHealthStatus = 'ok' | 'degraded' | 'unavailable';

export interface ToolInputField {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description?: string;
  enum?: JsonPrimitive[];
  default?: JsonValue;
}

export interface ToolManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  inputSchema: Record<string, ToolInputField>;
  outputSchema?: Record<string, ToolInputField>;
  sideEffects: ToolSideEffect[];
  timeoutMs?: number;
  tags?: string[];
}

export interface ToolWorkerManifest {
  protocolVersion: 'sciforge.tools.v1';
  workerId: string;
  workerVersion: string;
  description: string;
  tools: ToolManifest[];
  providers?: ToolProviderManifest[];
  capabilities?: string[];
}

export interface ToolProviderManifest {
  providerId: string;
  capabilityId: string;
  transport: 'http';
  invokePath: string;
  healthPath: string;
  manifestPath: string;
  permissions: string[];
  status: 'available' | 'unavailable' | 'degraded';
}

export interface ToolWorkerHealth {
  status: ToolHealthStatus;
  checkedAt: string;
  details?: JsonObject;
}

export interface ToolInvokeRequest {
  toolId: string;
  input: JsonObject;
  requestId?: string;
  deadlineMs?: number;
  metadata?: JsonObject;
}

export interface ToolInvokeSuccess {
  ok: true;
  requestId?: string;
  output: JsonValue;
  metadata?: JsonObject;
}

export interface ToolInvokeFailure {
  ok: false;
  requestId?: string;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: JsonObject;
  };
  metadata?: JsonObject;
}

export type ToolInvokeResponse = ToolInvokeSuccess | ToolInvokeFailure;

export interface ToolWorker {
  manifest: ToolWorkerManifest;
  health(): Promise<ToolWorkerHealth> | ToolWorkerHealth;
  invoke(request: ToolInvokeRequest): Promise<ToolInvokeResponse> | ToolInvokeResponse;
}
