import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const visionSenseToolIds = ['local.vision-sense'];

export const visionSenseEnvKeys = [
  'SCIFORGE_VISION_DESKTOP_BRIDGE',
  'SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN',
  'SCIFORGE_VISION_RUN_ID',
  'SCIFORGE_VISION_CAPTURE_DISPLAYS',
  'SCIFORGE_VISION_ACTIONS_JSON',
  'SCIFORGE_VISION_KV_GROUND_URL',
  'SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS',
  'SCIFORGE_VISION_PLANNER_BASE_URL',
  'SCIFORGE_VISION_PLANNER_API_KEY',
  'SCIFORGE_VISION_PLANNER_MODEL',
  'SCIFORGE_VISION_GROUNDER_LLM_BASE_URL',
  'SCIFORGE_VISION_GROUNDER_LLM_API_KEY',
  'SCIFORGE_VISION_GROUNDER_LLM_MODEL',
  'SCIFORGE_VISION_MAX_STEPS',
  'SCIFORGE_VISION_DESKTOP_PLATFORM',
] as const;

type VisionSenseEnvKey = typeof visionSenseEnvKeys[number];
type GatewayInput = Parameters<typeof runWorkspaceRuntimeGateway>[0];
type GatewayResult = Awaited<ReturnType<typeof runWorkspaceRuntimeGateway>>;

export function saveVisionSenseEnv(): Record<VisionSenseEnvKey, string | undefined> {
  return Object.fromEntries(visionSenseEnvKeys.map((key) => [key, process.env[key]])) as Record<VisionSenseEnvKey, string | undefined>;
}

export function restoreVisionSenseEnv(saved: Record<VisionSenseEnvKey, string | undefined>) {
  for (const key of visionSenseEnvKeys) {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export async function createVisionWorkspace(slug: string) {
  return mkdtemp(join(tmpdir(), `sciforge-vision-${slug}-`));
}

export async function runVisionSenseGateway(input: Omit<GatewayInput, 'selectedToolIds' | 'uiState'> & { uiState?: GatewayInput['uiState'] }) {
  const dryRunApproval = process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN === '1'
    ? {
        approved: true,
        ref: 'approval:vision-sense-dry-run-smoke',
        by: 'smoke-test',
      }
    : undefined;
  const inputUiState = typeof input.uiState === 'object' && input.uiState !== null
    ? input.uiState as Record<string, unknown>
    : undefined;
  const uiState = inputUiState
    ? { ...inputUiState, humanApproval: inputUiState.humanApproval ?? dryRunApproval, selectedToolIds: visionSenseToolIds }
    : { humanApproval: dryRunApproval, selectedToolIds: visionSenseToolIds };
  return runWorkspaceRuntimeGateway({
    ...input,
    selectedToolIds: visionSenseToolIds,
    uiState,
  });
}

export function findVisionTraceArtifact(result: GatewayResult) {
  const artifact = result.artifacts.find((candidate) => candidate.id === 'vision-sense-trace');
  assert.ok(artifact);
  return artifact;
}

export async function readVisionTrace(workspacePath: string, result: GatewayResult) {
  const artifact = findVisionTraceArtifact(result);
  return {
    artifact,
    text: await readFile(join(workspacePath, String(artifact.path)), 'utf8'),
  };
}

export async function readVisionTraceJson(workspacePath: string, result: GatewayResult) {
  const { artifact, text } = await readVisionTrace(workspacePath, result);
  return {
    artifact,
    trace: JSON.parse(text) as Record<string, unknown>,
    text,
  };
}

export function createJsonPostServer(
  path: string,
  handler: (body: Record<string, unknown>, raw: string) => unknown,
) {
  return createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== path) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(handler(JSON.parse(raw) as Record<string, unknown>, raw)));
    });
  });
}

export async function listenLocal(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

export async function closeServer(server: Server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
