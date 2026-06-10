import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type ModuleInvokeRequest,
  type ModuleQueryRequest,
  type ModuleReadRequest,
} from '../../packages/contracts/runtime/modules.js';
import { isRecord, readJson, writeJson } from './server/http.js';
import { createRuntimeModuleDispatcher, createRuntimeModuleRegistry, scrubTraceText } from './modules/dispatcher.js';
import { createFilesModuleHandler } from './modules/files-module-handler.js';
import { createAutomationsModuleHandler } from './modules/automations-module-handler.js';
import {
  createBrowserRuntimeModuleHandler,
} from './modules/bounded-operation-module-handlers.js';
import { createWebRuntimeModuleHandler } from './modules/web-runtime-module-handler.js';
import { createComputerUsePrimitiveService } from '../../packages/actions/computer-use/index.js';

export interface RuntimeModuleRouteOptions {
  workspaceRootFromBodyOrRequest(body: Record<string, unknown>, url: URL): Promise<string>;
}

export async function handleWorkspaceModuleRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: RuntimeModuleRouteOptions,
) {
  const match = /^\/api\/sciforge\/modules\/(describe|query|read|invoke)$/.exec(url.pathname);
  if (!match) return false;
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return true;
  }

  try {
    const body = await readJson(req);
    const request = moduleRequestFromBody(body);
    const root = await options.workspaceRootFromBodyOrRequest(body, url);
    const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
      files: createFilesModuleHandler({ workspacePath: root }),
      automations: createAutomationsModuleHandler({ workspacePath: root }),
      web: createWebRuntimeModuleHandler({ workspacePath: root }),
      browser: createBrowserRuntimeModuleHandler({ workspacePath: root }),
      computer_use: createComputerUsePrimitiveService(),
    }));
    const functionName = match[1];
    const result = functionName === 'describe'
      ? await dispatcher.describe({ moduleId: stringField(request.moduleId) })
      : functionName === 'query'
        ? await dispatcher.query({ ...request, moduleId: stringField(request.moduleId) || 'files' } as ModuleQueryRequest)
        : functionName === 'read'
          ? await dispatcher.read(request as unknown as ModuleReadRequest)
          : await dispatcher.invoke(request as unknown as ModuleInvokeRequest);
    writeJson(res, 200, {
      ok: result.ok,
      workspacePath: root,
      result,
      trace: dispatcher.trace(),
    });
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: scrubTraceText(error instanceof Error ? error.message : String(error)),
    });
  }
  return true;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function moduleRequestFromBody(body: Record<string, unknown>) {
  if (isRecord(body.request)) return body.request;
  const { workspacePath: _workspacePath, workspace_path: _workspacePathSnake, ...request } = body;
  return request;
}
