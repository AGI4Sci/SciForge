import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { sessionBundleRelForRequest, sessionBundleResourceRel } from '../session-bundle.js';
import { sha1 } from '../workspace-task-runner.js';
import { materializeBackendPayloadOutput, type RuntimeRefBundle } from './artifact-materializer.js';
import { generatedTaskStablePayloadTaskId } from '../../../packages/skills/runtime-policy.js';

export function backendPayloadRefs(taskId: string, taskRel: string, sessionBundleRel?: string): RuntimeRefBundle {
  return {
    taskRel,
    outputRel: sessionBundleResourceRel(sessionBundleRel, 'task-results', `${taskId}.json`),
    stdoutRel: sessionBundleResourceRel(sessionBundleRel, 'logs', `${taskId}.stdout.log`),
    stderrRel: sessionBundleResourceRel(sessionBundleRel, 'logs', `${taskId}.stderr.log`),
  };
}

export function stableGeneratedTaskPayloadTaskId(
  kind: string,
  request: GatewayRequest,
  skill: SkillAvailability,
  runId: string | undefined,
) {
  return generatedTaskStablePayloadTaskId({
    kind,
    skillDomain: request.skillDomain,
    skillId: skill.id,
    prompt: request.prompt,
    runId,
    shortHash: (value) => sha1(value).slice(0, 12),
  });
}

export async function writeBackendPayloadLogs(
  workspace: string,
  refs: RuntimeRefBundle,
  stdout: string,
  stderr = '',
) {
  try {
    await Promise.all([
      mkdir(dirname(join(workspace, refs.stdoutRel)), { recursive: true }),
      mkdir(dirname(join(workspace, refs.stderrRel)), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(workspace, refs.stdoutRel), stdout),
      writeFile(join(workspace, refs.stderrRel), stderr),
    ]);
  } catch {
    // Stable output materialization is the contract; direct-payload logs are best effort.
  }
}

export async function materializeBackendGenerationLifecyclePayload(input: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  payload: ToolPayload;
  reason: string;
  kind: string;
  taskRel: string;
}) {
  const refs = backendPayloadRefs(
    stableGeneratedTaskPayloadTaskId(input.kind, input.request, input.skill, sha1(input.reason).slice(0, 8)),
    input.taskRel,
    sessionBundleRelForRequest(input.request),
  );
  await writeBackendPayloadLogs(input.workspace, refs, `${input.kind}: ${input.reason}\n`);
  return await materializeBackendPayloadOutput(input.workspace, input.request, input.payload, refs);
}
