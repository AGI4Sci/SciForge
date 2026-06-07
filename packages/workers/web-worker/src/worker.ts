import type { ToolInvokeRequest, ToolInvokeResponse, ToolWorker } from '../../../contracts/tool-worker/src/index';
import { validateToolInput } from '../../../contracts/tool-worker/src/index';
import { webWorkerManifest } from './manifest';
import { browserFetch, pdfExtract, pdfTextExtractorHealth, RetryableToolError, webFetch, webSearch } from './web-tools';

export function createWebWorker(): ToolWorker {
  return {
    manifest: webWorkerManifest,
    async health() {
      const pdfHealth = await pdfTextExtractorHealth();
      return {
        status: pdfHealth.available ? 'ok' : 'degraded',
        checkedAt: new Date().toISOString(),
        details: {
          tools: webWorkerManifest.tools.map((tool) => tool.id),
          toolStatus: {
            web_search: 'available',
            web_fetch: 'available',
            browser_fetch: 'available',
            pdf_extract: pdfHealth.available ? 'available' : 'unavailable',
          },
          pdf_extract: {
            status: pdfHealth.available ? 'available' : 'unavailable',
            extractor: pdfHealth.extractor,
            ...(pdfHealth.reason ? { reason: pdfHealth.reason } : {}),
          },
        },
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
    const output = await invokeWebToolHandler(request.toolId, request.input);
    return { ok: true, requestId: request.requestId, output };
  } catch (error) {
    const retryable = error instanceof RetryableToolError;
    const message = error instanceof Error ? error.message : 'Unknown web worker error';
    return failure(request, retryable ? 'network_error' : 'web_worker_error', message, retryable);
  }
}

async function invokeWebToolHandler(toolId: string, input: ToolInvokeRequest['input']) {
  if (toolId === 'web_search') return webSearch(input);
  if (toolId === 'web_fetch') return webFetch(input);
  if (toolId === 'browser_fetch') return browserFetch(input);
  if (toolId === 'pdf_extract') return pdfExtract(input);
  throw new Error(`Unknown tool: ${toolId}`);
}

function failure(request: ToolInvokeRequest, code: string, message: string, retryable = false): ToolInvokeResponse {
  return { ok: false, requestId: request.requestId, error: { code, message, retryable } };
}
