import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { evaluateRawDataPreExecutionGuard } from '@sciforge-ui/runtime-contract/raw-data-execution-guard';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { errorMessage, generatedTaskArchiveRel, isTaskInputRel, safeWorkspaceRel } from '../gateway-utils.js';
import { ensureSessionBundle, sessionBundleRelForRequest, sessionBundleResourceRel } from '../session-bundle.js';
import { fileExists, runWorkspaceTask, sha1 } from '../workspace-task-runner.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { sanitizeAgentServerError } from './backend-failure-diagnostics.js';
import { readGeneratedTaskFileIfPresent, type AgentServerTaskFilesGeneration } from './generated-task-runner-generation-lifecycle.js';
import { expectedArtifactTypesForGeneratedRun, supplementScopeForGeneratedRun } from './generated-task-runner-supplement-lifecycle.js';
import {
  buildGeneratedTaskRunInputLifecycle,
  evaluateGeneratedTaskPayloadPreflight,
  generatedTaskPayloadPreflightFailureReason,
  generatedTaskPayloadPreflightRecoverActions,
  runGeneratedTaskRepairAttemptLifecycle,
  type GeneratedTaskRuntimeRefs,
} from './generated-task-runner-validation-lifecycle.js';
import { isGeneratedTaskCapabilityFirstPolicyIssue } from './generated-task-payload-preflight.js';
import type { GeneratedTaskRunnerDeps } from './generated-task-runner.js';
import { AGENTSERVER_GENERATED_TASK_MATERIALIZED_EVENT_TYPE, workspaceTaskPythonCommandCandidates } from '../../../packages/skills/runtime-policy';

const execFileAsync = promisify(execFile);

export interface GeneratedTaskExecutionLifecycleInput {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generation: AgentServerTaskFilesGeneration;
  callbacks?: WorkspaceRuntimeCallbacks;
  deps: Pick<GeneratedTaskRunnerDeps, 'repairNeededPayload'> & Partial<Pick<GeneratedTaskRunnerDeps, 'attemptPlanRefs' | 'tryAgentServerRepairAndRerun'>>;
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
    const capabilityFirstBlocked = generatedTaskCapabilityFirstPreflightBlocked(payloadPreflight);
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
          blocker: capabilityFirstBlocked ? 'generated-task-capability-first-policy' : 'generated-task-payload-preflight',
          executionUnitStatus: capabilityFirstBlocked ? 'failed-with-reason' : undefined,
          recoverActions: generatedTaskPayloadPreflightRecoverActions(payloadPreflight),
          agentServerRefs: {
            generatedTaskPayloadPreflight: payloadPreflight,
          },
        },
      ),
    };
  }
  const syntaxPreflight = await evaluateGeneratedTaskEntrypointSyntax({
    workspace: input.workspace,
    entrypoint: input.generation.response.entrypoint,
    generatedPathMap: materialized.generatedPathMap,
  });
  if (syntaxPreflight.blocked) {
    const repaired = await runGeneratedTaskSyntaxPreflightRepairLifecycle({
      workspace: input.workspace,
      request: input.request,
      skill: input.skill,
      generation: input.generation,
      taskId,
      refs,
      syntaxPreflight,
      callbacks: input.callbacks,
      deps: input.deps,
    });
    if (repaired) return { kind: 'payload', payload: repaired };
    return {
      kind: 'payload',
      payload: input.deps.repairNeededPayload(
        input.request,
        input.skill,
        syntaxPreflight.reason,
        {
          taskRel: refs.taskRel,
          inputRel: refs.inputRel,
          outputRel: refs.outputRel,
          stdoutRel: refs.stdoutRel,
          stderrRel: refs.stderrRel,
          blocker: 'generated-task-python-syntax-preflight',
          executionUnitStatus: 'failed-with-reason',
          recoverActions: [
            'Regenerate the task code so the entrypoint parses before execution.',
            'Run a syntax-only parser check before rerunning expensive workspace work.',
          ],
          agentServerRefs: {
            generatedTaskSyntaxPreflight: syntaxPreflight,
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

async function runGeneratedTaskSyntaxPreflightRepairLifecycle(input: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generation: AgentServerTaskFilesGeneration;
  taskId: string;
  refs: GeneratedTaskRuntimeRefs;
  syntaxPreflight: { blocked: true; reason: string; language: string; taskRel?: string; diagnostic: string };
  callbacks?: WorkspaceRuntimeCallbacks;
  deps: Pick<GeneratedTaskRunnerDeps, 'repairNeededPayload'> & Partial<Pick<GeneratedTaskRunnerDeps, 'attemptPlanRefs' | 'tryAgentServerRepairAndRerun'>>;
}): Promise<ToolPayload | undefined> {
  if (!input.deps.attemptPlanRefs || !input.deps.tryAgentServerRepairAndRerun) return undefined;
  await writeSyntaxPreflightDiagnosticRefs(input.workspace, input.refs, input.syntaxPreflight);
  const run = syntaxPreflightRunResult(input);
  return await runGeneratedTaskRepairAttemptLifecycle({
    workspacePath: input.workspace,
    request: input.request,
    skill: input.skill,
    taskId: input.taskId,
    runId: input.generation.runId,
    run,
    ...input.refs,
    attemptPlanRefs: input.deps.attemptPlanRefs,
    attemptStatus: 'repair-needed',
    schemaErrors: ['python entrypoint syntax preflight failed'],
    attemptSchemaErrors: ['python entrypoint syntax preflight failed'],
    failureReason: input.syntaxPreflight.reason,
    recoverActions: [
      'Regenerate the task code so the entrypoint parses before execution.',
      'Run a syntax-only parser check before rerunning expensive workspace work.',
    ],
    callbacks: input.callbacks,
    tryAgentServerRepairAndRerun: input.deps.tryAgentServerRepairAndRerun,
  });
}

async function writeSyntaxPreflightDiagnosticRefs(
  workspace: string,
  refs: GeneratedTaskRuntimeRefs,
  syntaxPreflight: { reason: string; diagnostic: string },
) {
  const writes = [
    { rel: refs.stdoutRel, content: '' },
    { rel: refs.stderrRel, content: `${syntaxPreflight.reason}\n` },
    {
      rel: refs.outputRel,
      content: `${JSON.stringify({
        schemaVersion: 'sciforge.generated-task.syntax-preflight.v1',
        status: 'repair-needed',
        failureReason: syntaxPreflight.reason,
        diagnostic: syntaxPreflight.diagnostic,
      }, null, 2)}\n`,
    },
  ].filter((entry): entry is { rel: string; content: string } => typeof entry.rel === 'string' && entry.rel.length > 0);
  for (const entry of writes) {
    await mkdir(dirname(join(workspace, entry.rel)), { recursive: true });
    await writeFile(join(workspace, entry.rel), entry.content, 'utf8');
  }
}

function syntaxPreflightRunResult(input: {
  workspace: string;
  request: GatewayRequest;
  generation: AgentServerTaskFilesGeneration;
  taskId: string;
  refs: GeneratedTaskRuntimeRefs;
  syntaxPreflight: { reason: string; diagnostic: string };
}): WorkspaceTaskRunResult {
  return {
    spec: {
      id: input.taskId,
      language: input.generation.response.entrypoint.language,
      entrypoint: input.generation.response.entrypoint.command || 'main',
      entrypointArgs: input.generation.response.entrypoint.args,
      taskRel: input.refs.taskRel,
      inputRel: input.refs.inputRel,
      outputRel: input.refs.outputRel,
      stdoutRel: input.refs.stdoutRel,
      stderrRel: input.refs.stderrRel,
      sessionBundleRel: sessionBundleRelForRequest(input.request),
      input: {
        prompt: input.request.prompt,
        syntaxPreflight: {
          status: 'blocked',
          reason: input.syntaxPreflight.reason,
          diagnostic: input.syntaxPreflight.diagnostic,
        },
      },
    },
    workspace: input.workspace,
    command: 'python3',
    args: ['-m', 'py_compile', input.refs.taskRel],
    exitCode: 1,
    stdoutRef: input.refs.stdoutRel,
    stderrRef: input.refs.stderrRel,
    outputRef: input.refs.outputRel,
    stdout: '',
    stderr: input.syntaxPreflight.reason,
    runtimeFingerprint: {
      kind: 'generated-task-python-syntax-preflight',
      blocked: true,
      taskRel: input.refs.taskRel,
    },
  };
}

function generatedTaskCapabilityFirstPreflightBlocked(preflight: ReturnType<typeof evaluateGeneratedTaskPayloadPreflight>) {
  return preflight.issues.some((issue) => issue.severity === 'repair-needed' && isGeneratedTaskCapabilityFirstPolicyIssue(issue));
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

async function evaluateGeneratedTaskEntrypointSyntax(input: {
  workspace: string;
  entrypoint: AgentServerTaskFilesGeneration['response']['entrypoint'];
  generatedPathMap: Map<string, string>;
}): Promise<{ blocked: false } | { blocked: true; reason: string; language: string; taskRel?: string; diagnostic: string }> {
  if (input.entrypoint.language !== 'python') return { blocked: false };
  const entrypointOriginalRel = safeWorkspaceRel(input.entrypoint.path);
  const taskRel = input.generatedPathMap.get(entrypointOriginalRel);
  if (!taskRel) return { blocked: false };
  const taskPath = join(input.workspace, taskRel);
  const command = await pythonSyntaxCommand(input.workspace);
  try {
    await execFileAsync(command, [
      '-c',
      [
        'import ast, pathlib, sys',
        'path = pathlib.Path(sys.argv[1])',
        'ast.parse(path.read_text(encoding="utf-8"), filename=str(path))',
      ].join('\n'),
      taskPath,
    ], {
      cwd: input.workspace,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    return { blocked: false };
  } catch (error) {
    const diagnostic = sanitizeAgentServerError(childProcessDiagnostic(error));
    return {
      blocked: true,
      language: 'python',
      taskRel,
      diagnostic,
      reason: `Generated Python entrypoint failed syntax preflight before execution: ${diagnostic}`,
    };
  }
}

async function pythonSyntaxCommand(workspace: string) {
  for (const candidate of workspaceTaskPythonCommandCandidates(workspace)) {
    if (await fileExists(candidate)) return candidate;
  }
  return 'python3';
}

function childProcessDiagnostic(error: unknown) {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  return [
    typeof record.stderr === 'string' ? record.stderr : '',
    typeof record.stdout === 'string' ? record.stdout : '',
    errorMessage(error),
  ].filter((part) => part.trim()).join('\n').trim();
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
    'import re',
    'import subprocess',
    'import urllib.error',
    'import urllib.request',
    'from pathlib import Path',
    'from typing import Any, Mapping',
    '',
    'SCHEMA_VERSION = "sciforge.generated-task-helper.v1"',
    'MODULE_NAME = "sciforge_task"',
    'CAPABILITY_ROUTE_REF_PREFIX = "runtime:" + "//capability-"',
    'CAPABILITY_ROUTE_REF_PREFIX += "provider"',
    'CAPABILITY_ROUTE_REF_PREFIX += "-route/"',
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
    '    data = dict(payload)',
    '    missing_required = [key for key in ["message"] if key not in data]',
    '    if missing_required:',
    '        raise ValueError("ToolPayload is missing required keys: " + ", ".join(missing_required))',
    '    for key in ["claims", "uiManifest", "executionUnits", "artifacts"]:',
    '        if key not in data:',
    '            data[key] = []',
    '        if not isinstance(data[key], list):',
    '            raise ValueError("ToolPayload field must be an array: " + key)',
    '    with open(output_path, "w", encoding="utf-8") as handle:',
    '        json.dump(data, handle, ensure_ascii=False, indent=2)',
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
    '    Generated tasks should use this for provider-backed web/browser work',
    '    instead of importing requests/urllib/httpx directly.',
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
    'def capability_discovery_search(task_input: Mapping[str, Any], query: Mapping[str, Any]) -> dict[str, Any]:',
    '    """Return compact capability candidates from the bounded task input context.',
    '',
    '    Discovery is planning/audit evidence only. Generated tasks must still call',
    '    invoke_capability for real work or write an honest failed-with-reason payload.',
    '    """',
    '    max_candidates = _clamp_int(_nested_get(query, ("constraints", "maxCandidates")), 1, 12, 6)',
    '    candidates = []',
    '    for route in _capability_route_entries(task_input)[:max_candidates]:',
    '        capability_id = str(route.get("capabilityId") or "")',
    '        if not capability_id:',
    '            continue',
    '        candidates.append({',
    '            "capabilityId": capability_id,',
    '            "title": str(route.get("label") or capability_id.replace("_", " ")),',
    '            "brief": str(route.get("summary") or route.get("reason") or "Capability route exposed by SciForge runtime."),',
    '            "kind": str(route.get("kind") or "runtime-adapter"),',
    '            "confidence": 0.8 if route.get("status") == "ready" else 0.45,',
    '            "availability": "ready" if route.get("status") == "ready" else "missing-provider",',
    '            "why": [f"matched bounded task route for {capability_id}"],',
    '            "sideEffectClass": str(route.get("sideEffectClass") or "external"),',
    '            **({"missing": [str(route.get("reason"))]} if route.get("status") != "ready" and route.get("reason") else {}),',
    '        })',
    '    return _sanitize_discovery({',
    '        "contract": "sciforge.capability-discovery.v1",',
    '        "discoveryRef": "capability-discovery:search:generated-task",',
    '        "auditRef": "audit:capability-discovery:search:generated-task",',
    '        "candidates": candidates,',
    '        "excluded": [],',
    '        "next": _discovery_next_actions(candidates),',
    '    })',
    '',
    '',
    'def capability_discovery_expand(task_input: Mapping[str, Any], query: Mapping[str, Any]) -> dict[str, Any]:',
    '    include = set(query.get("include") if isinstance(query.get("include"), list) else [])',
    '    wanted = [str(item) for item in query.get("capabilityIds", []) if isinstance(item, str)][:8] if isinstance(query.get("capabilityIds"), list) else []',
    '    route_by_id = {str(route.get("capabilityId")): route for route in _capability_route_entries(task_input) if route.get("capabilityId")}',
    '    expanded = []',
    '    excluded = []',
    '    for capability_id in wanted:',
    '        route = route_by_id.get(capability_id)',
    '        if not route:',
    '            excluded.append({"capabilityId": capability_id, "reason": "unknown capability id in bounded task routes"})',
    '            continue',
    '        entry = {',
    '            "capabilityId": capability_id,',
    '            "title": str(route.get("label") or capability_id.replace("_", " ")),',
    '            "kind": str(route.get("kind") or "runtime-adapter"),',
    '            "brief": str(route.get("summary") or "Capability route exposed by SciForge runtime."),',
    '            "availability": "ready" if route.get("status") == "ready" else "missing-provider",',
    '            "executionContract": "execute with invoke_capability; discovery is not completion evidence",',
    '        }',
    '        if "providers" in include:',
    '            entry["providers"] = _public_route_providers(route)',
    '        expanded.append(entry)',
    '    return _sanitize_discovery({',
    '        "contract": "sciforge.capability-discovery.v1",',
    '        "discoveryRef": "capability-discovery:expand:generated-task",',
    '        "auditRef": "audit:capability-discovery:expand:generated-task",',
    '        "expanded": expanded,',
    '        "excluded": excluded,',
    '    })',
    '',
    '',
    'def capability_discovery_plan(task_input: Mapping[str, Any], query: Mapping[str, Any]) -> dict[str, Any]:',
    '    candidate_ids = [str(item) for item in query.get("candidateIds", []) if isinstance(item, str)][:8] if isinstance(query.get("candidateIds"), list) else []',
    '    route_by_id = {str(route.get("capabilityId")): route for route in _capability_route_entries(task_input) if route.get("capabilityId")}',
    '    steps = []',
    '    missing_providers = []',
    '    for index, capability_id in enumerate(candidate_ids):',
    '        route = route_by_id.get(capability_id, {})',
    '        ready = route.get("status") == "ready"',
    '        steps.append({',
    '            "order": index + 1,',
    '            "capabilityId": capability_id,',
    '            "action": "invoke_capability" if ready else "ask-user",',
    '            "dependsOn": [] if index == 0 else [candidate_ids[index - 1]],',
    '            "expectedArtifacts": [f"{capability_id}-result"],',
    '            "fallbackCapabilityIds": [],',
    '            "missing": [] if ready else [str(route.get("reason") or "provider is not ready")],',
    '        })',
    '        if not ready:',
    '            missing_providers.append({"capabilityId": capability_id, "providerIds": [], "reason": str(route.get("reason") or "provider is not ready")})',
    '    return _sanitize_discovery({',
    '        "contract": "sciforge.capability-discovery.v1",',
    '        "planId": "capability-plan:generated-task",',
    '        "discoveryRef": "capability-discovery:plan:generated-task",',
    '        "auditRef": "audit:capability-discovery:plan:generated-task",',
    '        "summary": "Discovery plan built from bounded task routes. Execute only through invoke_capability.",',
    '        "steps": steps,',
    '        "missingProviders": missing_providers,',
    '        "missingPermissions": [],',
    '        "userConfirmations": [],',
    '        "expectedArtifacts": _unique([artifact for step in steps for artifact in step.get("expectedArtifacts", [])]),',
    '        "completionEvidence": "not-evidence",',
    '    })',
    '',
    '',
    'def capability_discovery_explain(task_input: Mapping[str, Any], query: Mapping[str, Any]) -> dict[str, Any]:',
    '    audience = str(query.get("audience") or "user")',
    '    capability_ids = [str(item) for item in query.get("capabilityIds", []) if isinstance(item, str)] if isinstance(query.get("capabilityIds"), list) else []',
    '    text = "Discovery can explain capability choices, but it does not execute the task."',
    '    if capability_ids:',
    '        text = "Discovery selected " + ", ".join(capability_ids[:8]) + "; actual work still requires invoke_capability."',
    '    result = {',
    '        "contract": "sciforge.capability-discovery.v1",',
    '        "discoveryRef": "capability-discovery:explain:generated-task",',
    '        "auditRef": "audit:capability-discovery:explain:generated-task",',
    '        "audience": audience,',
    '        "text": text,',
    '    }',
    '    if audience != "user":',
    '        result["details"] = {"capabilityIds": capability_ids[:8], "executionRequiresInvokeCapability": True, "completionEvidence": "not-evidence"}',
    '    return _sanitize_discovery(result)',
    '',
    '',
    'def invoke_capability(task_input: Mapping[str, Any], capability_id: str, capability_input: Mapping[str, Any], *, timeout_seconds: float | None = None) -> Any:',
    '    """Invoke any ready SciForge capability route exposed in task_input.',
    '',
    '    This is the generic alias for future tools. invoke_provider remains',
    '    available for provider-backed web_search/web_fetch compatibility.',
    '    """',
    '    if capability_id == "capability_discovery.search":',
    '        return capability_discovery_search(task_input, capability_input)',
    '    if capability_id == "capability_discovery.expand":',
    '        return capability_discovery_expand(task_input, capability_input)',
    '    if capability_id == "capability_discovery.plan":',
    '        return capability_discovery_plan(task_input, capability_input)',
    '    if capability_id == "capability_discovery.explain":',
    '        return capability_discovery_explain(task_input, capability_input)',
    '    return invoke_provider(task_input, capability_id, capability_input, timeout_seconds=timeout_seconds)',
    '',
    '',
    'def _capability_route_entries(task_input: Mapping[str, Any]) -> list[dict[str, Any]]:',
    '    routes = _nested_get(task_input, ("capabilityProviderRoutes", "routes"))',
    '    return [route for route in routes if isinstance(route, dict)] if isinstance(routes, list) else []',
    '',
    '',
    'def _public_route_providers(route: Mapping[str, Any]) -> list[dict[str, Any]]:',
    '    providers = route.get("providers")',
    '    public = []',
    '    if isinstance(providers, list):',
    '        for provider in providers:',
    '            if not isinstance(provider, dict):',
    '                continue',
    '            public.append({',
    '                "providerId": provider.get("providerId"),',
    '                "label": provider.get("label"),',
    '                "transport": provider.get("transport"),',
    '                "healthStatus": provider.get("status") or "unknown",',
    '                "fallbackEligible": provider.get("fallbackEligible"),',
    '            })',
    '    return public',
    '',
    '',
    'def _nested_get(value: Mapping[str, Any], path: tuple[str, ...]) -> Any:',
    '    current: Any = value',
    '    for key in path:',
    '        if not isinstance(current, Mapping):',
    '            return None',
    '        current = current.get(key)',
    '    return current',
    '',
    '',
    'def _clamp_int(value: Any, minimum: int, maximum: int, fallback: int) -> int:',
    '    try:',
    '        parsed = int(value)',
    '    except Exception:',
    '        parsed = fallback',
    '    return max(minimum, min(maximum, parsed))',
    '',
    '',
    'def _discovery_next_actions(candidates: list[dict[str, Any]]) -> list[str]:',
    '    actions = []',
    '    if candidates:',
    '        actions.extend(["expand", "plan"])',
    '    if any(candidate.get("availability") == "ready" for candidate in candidates):',
    '        actions.append("invoke-capability")',
    '    if any(candidate.get("availability") != "ready" for candidate in candidates):',
    '        actions.append("ask-user")',
    '    return _unique(actions)',
    '',
    '',
    'def _unique(values: list[Any]) -> list[Any]:',
    '    out = []',
    '    for value in values:',
    '        if value not in out:',
    '            out.append(value)',
    '    return out',
    '',
    '',
    'def _sanitize_discovery(value: Any) -> Any:',
    '    if isinstance(value, list):',
    '        return [_sanitize_discovery(item) for item in value]',
    '    if isinstance(value, dict):',
    '        blocked = ("endpoint", "baseurl", "invokeurl", "url", "auth", "token", "secret", "workspaceroot", "workspaceroots", "runtimelocation", "command", "mcpserver")',
    '        return {key: _sanitize_discovery(entry) for key, entry in value.items() if not any(part in str(key).lower() for part in blocked)}',
    '    if isinstance(value, str):',
    '        return re.sub(r"/(?:Applications|Users|private|var|tmp)/[^\\s\\\")]+", "[redacted-path]", re.sub(r"https?://[^\\s\\\")]+", "[redacted-url]", value))',
    '    return value',
    '',
    '',
    'def provider_result_count(result: Any) -> int | None:',
    '    """Return a generic count for common provider result shapes, or None when unknown."""',
    '    if isinstance(result, list):',
    '        return len(result)',
    '    if not isinstance(result, dict):',
    '        return None',
    '    for key in ("results", "items", "documents", "papers", "records", "data"):',
    '        value = result.get(key)',
    '        if isinstance(value, list):',
    '            return len(value)',
    '    for key in ("totalResults", "total_results", "count", "resultCount"):',
    '        value = result.get(key)',
    '        if isinstance(value, int):',
    '            return value',
    '    return None',
    '',
    '',
    'def provider_result_is_empty(result: Any) -> bool:',
    '    """True when the provider result is explicitly empty, without guessing unknown shapes."""',
    '    count = provider_result_count(result)',
    '    return count == 0',
    '',
    '',
    'def empty_result_payload(capability_id: str, reason: str, *, recover_actions: list[str] | None = None, refs: list[str] | None = None) -> dict[str, Any]:',
    '    actions = recover_actions or ["Refine or broaden the query, then retry the same ready provider route."]',
    '    evidence_refs = refs or [CAPABILITY_ROUTE_REF_PREFIX + capability_id]',
    '    return {',
    '        "message": reason,',
    '        "confidence": 0.6,',
    '        "claimType": "runtime-diagnostic",',
    '        "evidenceLevel": "provider",',
    '        "reasoningTrace": reason,',
    '        "claims": [{',
    '            "id": f"empty-result-{capability_id}",',
    '            "type": "observation",',
    '            "text": reason,',
    '            "confidence": 0.7,',
    '            "evidenceLevel": "provider",',
    '            "supportingRefs": evidence_refs,',
    '            "opposingRefs": [],',
    '        }],',
    '        "uiManifest": [{"componentId": "runtime-diagnostic", "artifactRef": f"empty-result-{capability_id}"}],',
    '        "executionUnits": [{',
    '            "id": f"EU-empty-result-{capability_id}",',
    '            "tool": "invoke_capability",',
    '            "status": "failed-with-reason",',
    '            "failureReason": "empty-results",',
    '            "recoverActions": actions,',
    '            "nextStep": actions[0] if actions else "Refine query and retry.",',
    '        }],',
    '        "artifacts": [{',
    '            "id": f"empty-result-{capability_id}",',
    '            "type": "runtime-diagnostic",',
    '            "data": {"reason": reason, "recoverActions": actions, "refs": evidence_refs},',
    '        }],',
    '        "objectReferences": [{"id": f"obj-empty-result-{capability_id}", "kind": "runtime-diagnostic", "title": "Provider empty result", "ref": evidence_refs[0], "status": "needs-attention"}],',
    '    }',
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
    '    try:',
    '        completed = subprocess.run([command, *args_prefix, raw_input], text=True, capture_output=True, timeout=timeout)',
    '    except subprocess.TimeoutExpired as error:',
    '        raise ProviderInvocationError(f"Provider {capability_id} CLI timed out after {timeout:.1f}s.") from error',
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
