import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { evaluateRawDataPreExecutionGuard } from '@sciforge-ui/runtime-contract/raw-data-execution-guard';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { errorMessage, generatedTaskArchiveRel, isTaskInputRel, safeWorkspaceRel } from '../gateway-utils.js';
import { ensureSessionBundle, sessionBundleRelForRequest, sessionBundleResourceRel } from '../session-bundle.js';
import { runWorkspaceTask, sha1 } from '../workspace-task-runner.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { sanitizeAgentServerError } from './backend-failure-diagnostics.js';
import { readGeneratedTaskFileIfPresent, type AgentServerTaskFilesGeneration } from './generated-task-runner-generation-lifecycle.js';
import { expectedArtifactTypesForGeneratedRun, supplementScopeForGeneratedRun } from './generated-task-runner-supplement-lifecycle.js';
import {
  buildGeneratedTaskRunInputLifecycle,
  evaluateGeneratedTaskPayloadPreflight,
  generatedTaskPayloadPreflightFailureReason,
  generatedTaskPayloadPreflightRecoverActions,
  type GeneratedTaskRuntimeRefs,
} from './generated-task-runner-validation-lifecycle.js';
import type { GeneratedTaskRunnerDeps } from './generated-task-runner.js';
import { AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE } from '../../../packages/skills/runtime-policy';

export interface GeneratedTaskExecutionLifecycleInput {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generation: AgentServerTaskFilesGeneration;
  callbacks?: WorkspaceRuntimeCallbacks;
  deps: Pick<GeneratedTaskRunnerDeps, 'repairNeededPayload'>;
}

export interface GeneratedTaskExecutionLifecycleRun extends GeneratedTaskRuntimeRefs {
  taskId: string;
  sessionBundleRel?: string;
  run: WorkspaceTaskRunResult;
  supplementArtifactTypes: string[];
}

export type GeneratedTaskExecutionLifecycleResult =
  | { kind: 'run'; execution: GeneratedTaskExecutionLifecycleRun }
  | { kind: 'payload'; payload: ToolPayload };

export async function runGeneratedTaskExecutionLifecycle(
  input: GeneratedTaskExecutionLifecycleInput,
): Promise<GeneratedTaskExecutionLifecycleResult> {
  const taskId = `generated-${input.request.skillDomain}-${sha1(`${input.request.prompt}:${Date.now()}`).slice(0, 12)}`;
  const sessionBundleRel = sessionBundleRelForRequest(input.request);
  await ensureSessionBundle(input.workspace, sessionBundleRel, {
    sessionId: typeof input.request.uiState?.sessionId === 'string' ? input.request.uiState.sessionId : 'sessionless',
    scenarioId: input.request.scenarioPackageRef?.id || input.request.skillDomain,
    createdAt: typeof input.request.uiState?.sessionCreatedAt === 'string' ? input.request.uiState.sessionCreatedAt : undefined,
    updatedAt: typeof input.request.uiState?.sessionUpdatedAt === 'string' ? input.request.uiState.sessionUpdatedAt : undefined,
  });
  const materialized = await materializeGeneratedTaskFiles({
    workspace: input.workspace,
    request: input.request,
    skill: input.skill,
    taskId,
    sessionBundleRel,
    generation: input.generation,
    callbacks: input.callbacks,
    deps: input.deps,
  });
  if (materialized.kind === 'payload') return materialized;

  const refs = generatedTaskRuntimeRefs(input.generation, taskId, materialized.generatedPathMap, sessionBundleRel);
  const rawDataGuard = evaluateRawDataPreExecutionGuard({
    taskFiles: input.generation.response.taskFiles,
    artifacts: input.request.artifacts,
    references: input.request.references,
    uiState: input.request.uiState,
    actionSideEffects: input.request.actionSideEffects,
  });
  if (rawDataGuard.blocked) {
    return {
      kind: 'payload',
      payload: input.deps.repairNeededPayload(input.request, input.skill, rawDataGuard.reason ?? 'Raw-data pre-execution guard blocked generated task execution.', {
        rawDataPreExecutionGuard: rawDataGuard,
        taskRel: refs.taskRel,
      }),
    };
  }
  const expectedArtifacts = expectedArtifactTypesForGeneratedRun(input.request, input.generation.response.expectedArtifacts);
  const payloadPreflight = evaluateGeneratedTaskPayloadPreflight({
    taskFiles: materialized.materializedTaskFiles ?? input.generation.response.taskFiles ?? [],
    entrypoint: input.generation.response.entrypoint,
    expectedArtifacts,
    request: input.request,
  });
  if (payloadPreflight.status === 'blocked') {
    return {
      kind: 'payload',
      payload: input.deps.repairNeededPayload(
        input.request,
        input.skill,
        generatedTaskPayloadPreflightFailureReason(payloadPreflight),
        {
          taskRel: refs.taskRel,
          inputRel: refs.inputRel,
          outputRel: refs.outputRel,
          stdoutRel: refs.stdoutRel,
          stderrRel: refs.stderrRel,
          recoverActions: generatedTaskPayloadPreflightRecoverActions(payloadPreflight),
          agentServerRefs: {
            generatedTaskPayloadPreflight: payloadPreflight,
          },
        },
      ),
    };
  }
  const taskInputLifecycle = await buildGeneratedTaskRunInputLifecycle({
    workspacePath: input.workspace,
    request: input.request,
    skill: input.skill,
    generatedInputRels: materialized.generatedInputRels,
    taskHelperRel: materialized.taskHelperRel,
    expectedArtifacts,
    payloadPreflight,
  });
  const run = await runWorkspaceTask(input.workspace, {
    id: taskId,
    language: input.generation.response.entrypoint.language,
    entrypoint: input.generation.response.entrypoint.command || 'main',
    entrypointArgs: input.generation.response.entrypoint.args,
    taskRel: refs.taskRel,
    input: taskInputLifecycle.taskInput,
    retentionProtectedInputRels: taskInputLifecycle.retentionProtectedInputRels,
    outputRel: refs.outputRel,
    stdoutRel: refs.stdoutRel,
    stderrRel: refs.stderrRel,
    inputRel: refs.inputRel,
    sessionBundleRel,
  });

  return {
    kind: 'run',
    execution: {
      taskId,
      sessionBundleRel,
      run,
      ...refs,
      supplementArtifactTypes: supplementScopeForGeneratedRun(input.request, input.generation.response.expectedArtifacts),
    },
  };
}

async function materializeGeneratedTaskFiles(input: GeneratedTaskExecutionLifecycleInput & { taskId: string; sessionBundleRel: string }): Promise<
  | {
    kind: 'materialized';
    generatedPathMap: Map<string, string>;
    generatedInputRels: string[];
    materializedTaskFiles: AgentServerTaskFilesGeneration['response']['taskFiles'];
    taskHelperRel: string;
  }
  | { kind: 'payload'; payload: ToolPayload }
> {
  const generatedPathMap = new Map<string, string>();
  const generatedInputRels: string[] = [];
  const materializedTaskFiles: AgentServerTaskFilesGeneration['response']['taskFiles'] = [];
  let taskHelperRel = '';
  try {
    for (const file of input.generation.response.taskFiles) {
      const declaredRel = safeWorkspaceRel(file.path);
      const rel = generatedTaskArchiveRel(input.taskId, declaredRel, input.sessionBundleRel);
      generatedPathMap.set(declaredRel, rel);
      if (isTaskInputRel(declaredRel)) generatedInputRels.push(declaredRel);
      const content = file.content || await readGeneratedTaskFileIfPresent(input.workspace, file.path);
      if (content === undefined) {
        return {
          kind: 'payload',
          payload: input.deps.repairNeededPayload(
            input.request,
            input.skill,
            `AgentServer returned taskFiles path-only reference but SciForge could not read workspace file: ${declaredRel}`,
          ),
        };
      }
      materializedTaskFiles.push({
        path: declaredRel,
        language: file.language,
        content,
      });
      await mkdir(dirname(join(input.workspace, rel)), { recursive: true });
      await writeFile(join(input.workspace, rel), content);
      emitWorkspaceRuntimeEvent(input.callbacks, {
        type: AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE,
        source: 'workspace-runtime',
        message: `Materialized AgentServer task file ${declaredRel}`,
        detail: rel === declaredRel ? declaredRel : `${declaredRel} -> ${rel}`,
      });
    }
    const entrypointOriginalRel = safeWorkspaceRel(input.generation.response.entrypoint.path);
    const entrypointRel = generatedPathMap.get(entrypointOriginalRel)
      ?? generatedTaskArchiveRel(input.taskId, entrypointOriginalRel, input.sessionBundleRel);
    taskHelperRel = `${dirname(entrypointRel).replace(/\\/g, '/')}/sciforge_task.py`;
    await mkdir(dirname(join(input.workspace, taskHelperRel)), { recursive: true });
    await writeFile(join(input.workspace, taskHelperRel), sciforgeTaskHelperSource(), 'utf8');
    emitWorkspaceRuntimeEvent(input.callbacks, {
      type: AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE,
      source: 'workspace-runtime',
      message: 'Materialized SciForge generated task helper SDK sciforge_task.py',
      detail: taskHelperRel,
    });
  } catch (error) {
    return {
      kind: 'payload',
      payload: input.deps.repairNeededPayload(
        input.request,
        input.skill,
        `AgentServer generated task files could not be archived: ${sanitizeAgentServerError(errorMessage(error))}`,
      ),
    };
  }
  return { kind: 'materialized', generatedPathMap, generatedInputRels, materializedTaskFiles, taskHelperRel };
}

function sciforgeTaskHelperSource() {
  return [
    '"""SciForge generated task helper SDK.',
    '',
    'Generated tasks may import this module from the entrypoint directory.',
    'Use provider-first policy for external web work: when task input declares',
    'a ready web_search or web_fetch provider route, do not call direct network',
    'libraries such as requests, urllib, fetch, httpx, or aiohttp from task code.',
    '"""',
    '',
    'from __future__ import annotations',
    '',
    'import json',
    'import subprocess',
    'import urllib.error',
    'import urllib.request',
    'from pathlib import Path',
    'from typing import Any, Mapping',
    '',
    'SCHEMA_VERSION = "sciforge.generated-task-helper.v1"',
    'MODULE_NAME = "sciforge_task"',
    '',
    '',
    'class ProviderInvocationError(RuntimeError):',
    '    pass',
    '',
    '',
    'def load_input(input_path: str | Path) -> dict[str, Any]:',
    '    with open(input_path, "r", encoding="utf-8") as handle:',
    '        payload = json.load(handle)',
    '    if not isinstance(payload, dict):',
    '        raise ValueError("SciForge task input must be a JSON object.")',
    '    return payload',
    '',
    '',
    'def write_payload(output_path: str | Path, payload: Mapping[str, Any]) -> None:',
    '    required = ["message", "claims", "uiManifest", "executionUnits", "artifacts"]',
    '    missing = [key for key in required if key not in payload]',
    '    if missing:',
    '        raise ValueError("ToolPayload is missing required keys: " + ", ".join(missing))',
    '    with open(output_path, "w", encoding="utf-8") as handle:',
    '        json.dump(dict(payload), handle, ensure_ascii=False, indent=2)',
    '',
    '',
    'def provider_routes(task_input: Mapping[str, Any]) -> dict[str, Any]:',
    '    routes = task_input.get("capabilityProviderRoutes")',
    '    if isinstance(routes, dict):',
    '        return routes',
    '    return {}',
    '',
    '',
    'def provider_route(task_input: Mapping[str, Any], capability_id: str) -> dict[str, Any] | None:',
    '    routes = provider_routes(task_input).get("routes", [])',
    '    if not isinstance(routes, list):',
    '        return None',
    '    for route in routes:',
    '        if isinstance(route, dict) and route.get("capabilityId") == capability_id:',
    '            return route',
    '    return None',
    '',
    '',
    'def has_ready_provider(task_input: Mapping[str, Any], capability_id: str) -> bool:',
    '    route = provider_route(task_input, capability_id)',
    '    return bool(route and route.get("status") == "ready")',
    '',
    '',
    'def require_provider_first(task_input: Mapping[str, Any], capability_id: str) -> None:',
    '    if has_ready_provider(task_input, capability_id):',
    '        return',
    '    raise RuntimeError(',
    '        f"SciForge provider-first policy requires a ready provider route for {capability_id}. "',
    '        "Write a repair-needed ToolPayload with recovery advice instead of using direct external network calls."',
    '    )',
    '',
    '',
    'def provider_first_guidance(task_input: Mapping[str, Any]) -> list[str]:',
    '    policy = task_input.get("capabilityFirstPolicy")',
    '    if isinstance(policy, dict) and isinstance(policy.get("rules"), list):',
    '        return [str(item) for item in policy["rules"]]',
    '    return []',
    '',
    '',
    'def provider_invocation_adapters(task_input: Mapping[str, Any]) -> list[dict[str, Any]]:',
    '    invocation = task_input.get("providerInvocation")',
    '    if not isinstance(invocation, dict):',
    '        return []',
    '    adapters = invocation.get("adapters")',
    '    return [item for item in adapters if isinstance(item, dict)] if isinstance(adapters, list) else []',
    '',
    '',
    'def provider_invocation_adapter(task_input: Mapping[str, Any], capability_id: str) -> dict[str, Any] | None:',
    '    for adapter in provider_invocation_adapters(task_input):',
    '        if adapter.get("capabilityId") == capability_id:',
    '            return adapter',
    '    return None',
    '',
    '',
    'def invoke_provider(task_input: Mapping[str, Any], capability_id: str, provider_input: Mapping[str, Any], *, timeout_seconds: float | None = None) -> Any:',
    '    """Invoke a SciForge provider selected by capabilityProviderRoutes.',
    '',
    '    Generated tasks should use this for provider-backed work such as web_search',
    '    and web_fetch instead of importing requests/urllib/httpx directly.',
    '    """',
    '    require_provider_first(task_input, capability_id)',
    '    adapter = provider_invocation_adapter(task_input, capability_id)',
    '    if not adapter:',
    '        raise ProviderInvocationError(f"No provider invocation adapter is available for {capability_id}.")',
    '    kind = adapter.get("kind")',
    '    if kind == "http":',
    '        return _invoke_provider_http(adapter, capability_id, provider_input, timeout_seconds)',
    '    if kind == "node-cli":',
    '        return _invoke_provider_node_cli(adapter, capability_id, provider_input, timeout_seconds)',
    '    reason = adapter.get("reason") or f"Unsupported provider invocation adapter kind: {kind}"',
    '    raise ProviderInvocationError(str(reason))',
    '',
    '',
    'def _invoke_provider_http(adapter: Mapping[str, Any], capability_id: str, provider_input: Mapping[str, Any], timeout_seconds: float | None) -> Any:',
    '    endpoint = str(adapter.get("endpoint") or "").rstrip("/")',
    '    if not endpoint:',
    '        raise ProviderInvocationError(f"Provider adapter for {capability_id} does not include an endpoint.")',
    '    invoke_path = str(adapter.get("invokePath") or "/invoke")',
    '    url = endpoint + (invoke_path if invoke_path.startswith("/") else "/" + invoke_path)',
    '    request_body = json.dumps({',
    '        "toolId": str(adapter.get("toolId") or capability_id),',
    '        "input": dict(provider_input),',
    '        "metadata": {',
    '            "capabilityId": capability_id,',
    '            "providerId": adapter.get("providerId"),',
    '            "source": "generated-task-provider-invocation",',
    '        },',
    '    }).encode("utf-8")',
    '    timeout = timeout_seconds if timeout_seconds is not None else float(adapter.get("timeoutMs") or 30000) / 1000.0',
    '    req = urllib.request.Request(url, data=request_body, method="POST", headers={"content-type": "application/json"})',
    '    try:',
    '        with urllib.request.urlopen(req, timeout=timeout) as response:',
    '            payload = json.loads(response.read().decode("utf-8") or "{}")',
    '    except urllib.error.HTTPError as error:',
    '        detail = error.read().decode("utf-8", errors="replace")',
    '        raise ProviderInvocationError(f"Provider {capability_id} HTTP {error.code}: {detail}") from error',
    '    except Exception as error:',
    '        raise ProviderInvocationError(f"Provider {capability_id} invocation failed: {error}") from error',
    '    return _provider_output_or_raise(capability_id, payload)',
    '',
    '',
    'def _invoke_provider_node_cli(adapter: Mapping[str, Any], capability_id: str, provider_input: Mapping[str, Any], timeout_seconds: float | None) -> Any:',
    '    command = adapter.get("command")',
    '    args_prefix = adapter.get("argsPrefix")',
    '    if not isinstance(command, str) or not command:',
    '        raise ProviderInvocationError(f"Provider adapter for {capability_id} does not include a command.")',
    '    if not isinstance(args_prefix, list) or not all(isinstance(item, str) for item in args_prefix):',
    '        raise ProviderInvocationError(f"Provider adapter for {capability_id} does not include argsPrefix.")',
    '    raw_input = json.dumps(dict(provider_input), ensure_ascii=False)',
    '    timeout = timeout_seconds if timeout_seconds is not None else float(adapter.get("timeoutMs") or 30000) / 1000.0',
    '    completed = subprocess.run([command, *args_prefix, raw_input], text=True, capture_output=True, timeout=timeout)',
    '    if completed.returncode != 0:',
    '        raise ProviderInvocationError(f"Provider {capability_id} CLI failed: {completed.stderr or completed.stdout}")',
    '    try:',
    '        payload = json.loads(completed.stdout or "{}")',
    '    except Exception as error:',
    '        raise ProviderInvocationError(f"Provider {capability_id} CLI returned invalid JSON: {completed.stdout}") from error',
    '    return _provider_output_or_raise(capability_id, payload)',
    '',
    '',
    'def _provider_output_or_raise(capability_id: str, payload: Any) -> Any:',
    '    if not isinstance(payload, dict):',
    '        raise ProviderInvocationError(f"Provider {capability_id} returned a non-object response.")',
    '    if payload.get("ok") is True:',
    '        return payload.get("output")',
    '    error = payload.get("error") if isinstance(payload.get("error"), dict) else {}',
    '    message = error.get("message") or payload.get("message") or f"Provider {capability_id} returned ok=false."',
    '    raise ProviderInvocationError(str(message))',
    '',
  ].join('\n');
}

function generatedTaskRuntimeRefs(
  generation: AgentServerTaskFilesGeneration,
  taskId: string,
  generatedPathMap: Map<string, string>,
  sessionBundleRel?: string,
): GeneratedTaskRuntimeRefs {
  const entrypointOriginalRel = safeWorkspaceRel(generation.response.entrypoint.path);
  return {
    taskRel: generatedPathMap.get(entrypointOriginalRel) ?? generatedTaskArchiveRel(taskId, generation.response.entrypoint.path, sessionBundleRel),
    inputRel: sessionBundleResourceRel(sessionBundleRel, 'task-inputs', `${taskId}.json`),
    outputRel: sessionBundleResourceRel(sessionBundleRel, 'task-results', `${taskId}.json`),
    stdoutRel: sessionBundleResourceRel(sessionBundleRel, 'logs', `${taskId}.stdout.log`),
    stderrRel: sessionBundleResourceRel(sessionBundleRel, 'logs', `${taskId}.stderr.log`),
  };
}
