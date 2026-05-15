import type { ToolInvokeRequest, ToolInvokeResponse, ToolWorker } from '../../../contracts/tool-worker/src/index';
import { validateToolInput } from '../../../contracts/tool-worker/src/index';
import { webWorkerManifest } from './manifest';
import { RetryableToolError, webFetch, webSearch } from './web-tools';

export function createWebWorker(): ToolWorker {
  return {
    manifest: webWorkerManifest,
    health() {
      return {
        status: 'ok',
        checkedAt: new Date().toISOString(),
        details: { tools: webWorkerManifest.tools.map((tool) => tool.id) },
      };
    },
    async invoke(request) {
      return invokeWebTool(request);
    },
  };
}

export async function invokeWebTool(request: ToolInvokeRequest): Promise<ToolInvokeResponse> {
  const tool = webWorkerManifest.tools.find((candidate) => candidate.id === request.toolId);
  if (!tool) {
    return failure(request, 'tool_not_found', `Unknown tool: ${request.toolId}`);
  }

  const inputIssues = validateToolInput(tool, request.input);
  if (inputIssues.length > 0) {
    return failure(request, 'invalid_input', inputIssues.join('; '));
  }

  try {
    const output = request.toolId === 'web_search' ? await webSearch(request.input) : await webFetch(request.input);
    return { ok: true, requestId: request.requestId, output };
  } catch (error) {
    const retryable = error instanceof RetryableToolError;
    const message = error instanceof Error ? error.message : 'Unknown web worker error';
    return failure(request, retryable ? 'network_error' : 'web_worker_error', message, retryable);
  }
}

function failure(request: ToolInvokeRequest, code: string, message: string, retryable = false): ToolInvokeResponse {
  return { ok: false, requestId: request.requestId, error: { code, message, retryable } };
}
