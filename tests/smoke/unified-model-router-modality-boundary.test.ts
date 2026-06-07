import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

const repoRoot = new URL('../..', import.meta.url).pathname;

async function source(path: string) {
  return readFile(join(repoRoot, path), 'utf8');
}

test('Runtime Codex server does not own Browser evidence direct or fallback bypasses', async () => {
  const text = await source('src/runtime/codex/codex-runtime-server.ts');
  for (const pattern of [
    /\bruntimeDirectBrowserEvidenceTurn\b/,
    /\bruntimeBrowserEvidenceFallback\b/,
    /\bruntimeStructuredModuleInvokeFallback\b/,
    /\bdefaultRuntimeBrowserPrimitiveInvoker\b/,
    /\bbrowserPrimitiveInvoker\b/,
    /\bevaluateCodexAgentHostTurnLoop\b/,
    /\bevaluateBrowserEvidenceNeed\b/,
    /\bcreateBrowserRuntimeModuleHandler\b/,
  ]) {
    assert.doesNotMatch(text, pattern);
  }
});

test('Agent Host does not expose ordinary-chat Browser primitive bypasses', async () => {
  const text = await source('src/runtime/codex/agent-host-turn-loop.ts');
  for (const pattern of [
    /\bCodexAgentHostBrowserPrimitiveInvoker\b/,
    /\bbrowserPrimitiveInvoker\b/,
    /\bevaluateBrowserEvidenceNeed\b/,
    /\bBROWSER_PRIMITIVE_/,
    /\bbrowserPrimitiveRun\b/,
    /\bbrowserPrimitiveTurnLoopResult\b/,
    /\bbrowserModuleUnavailableTurnLoopResult\b/,
    /\bbrowser\.primitives\b/,
    /\bagent-host-browser\b/,
  ]) {
    assert.doesNotMatch(text, pattern);
  }
});

test('Retired ordinary-chat Browser acceptance writer cannot call Agent Host Browser bypasses', async () => {
  const text = await source('src/runtime/runtime-codex-browser-ordinary-chat-acceptance-writer.ts');
  assert.match(text, /Retired: ordinary-chat Browser acceptance must flow through the unified Runtime Codex app-server \/ Model Router tool protocol/);
  for (const pattern of [
    /\bevaluateCodexAgentHostTurnLoop\b/,
    /\bCodexAgentHostBrowserPrimitiveInvoker\b/,
    /\bbrowserPrimitiveInvoker\b/,
    /\bcreateDefaultBrowserPrimitiveInvoker\b/,
    /\bbrowser\.primitives\b/,
  ]) {
    assert.doesNotMatch(text, pattern);
  }
});

test('UI Runtime Codex transport keeps input objects structured instead of prompt-encoded or modality-classified', async () => {
  const text = await source('src/ui/src/api/sciforgeToolsClient/client.ts');
  assert.match(text, /\binputObjects\b/);
  assert.match(text, /\bruntimeInputObjectsForRuntimeRequest\b/);
  assert.doesNotMatch(text, /\bmodalityRefs\b/);
  assert.doesNotMatch(text, /\bruntimeModalityRefsForRuntimeRequest\b/);
  assert.doesNotMatch(text, /\bRuntimeModalityKind\b/);
  assert.doesNotMatch(text, /\bruntimeModalityKind\b/);
  assert.doesNotMatch(text, /\brouterModalityRefsForRuntimeCommand\b/);
  assert.doesNotMatch(text, /\[\.\.\.inputObjects,\s*\.\.\.readableRefs\]/);
  assert.doesNotMatch(text, /ask\s+\$\{refs\.map[\s\S]{0,120}modality/i);
});

test('Codex app-server client transports inputObjects only as app-server compatible carriers', async () => {
  const text = await source('src/runtime/codex/codex-app-server-client.ts');
  assert.match(text, /\brequest\.inputObjects\b/);
  assert.match(text, /\bcodexAppServerTurnInputItems\b/);
  assert.match(text, /type:\s*'localImage'/);
  assert.match(text, /SciForge input_object attachments/);
  assert.doesNotMatch(text, /\bruntimeInputObjectTransportParts\b/);
  assert.doesNotMatch(text, /type:\s*['"]input_object['"]/);
  assert.doesNotMatch(text, /\brequest\.modalityRefs\b/);
  assert.doesNotMatch(text, /\bcallModelRouter\b/);
  assert.doesNotMatch(text, /\brouteResponsesRequest\b/);
  assert.doesNotMatch(text, /\binput_image\b/);
  assert.doesNotMatch(text, /\binput_audio\b/);
  assert.doesNotMatch(text, /\binput_video\b/);
  assert.doesNotMatch(text, /\binput_table\b/);
  assert.doesNotMatch(text, /\binput_file\b/);
  assert.doesNotMatch(text, /ask --ref[\s\S]{0,160}(?:input_image|modalityRefs|inputObjects)/i);
  assert.doesNotMatch(text, /image_url:\s*\{\s*url:\s*item\.ref/);
});

test('Runtime Codex server accepts inputObjects and rejects retired modalityRefs', async () => {
  const text = await source('src/runtime/codex/codex-runtime-server.ts');
  assert.match(text, /\binputObjects\b/);
  assert.match(text, /\bruntimeInputObjectsFromBody\b/);
  assert.doesNotMatch(text, /\bmodalityRefs\b/);
  assert.doesNotMatch(text, /\bruntimeModalityRefsFromBody\b/);
});

test('Model Router stays an API boundary and does not own multimodal object memory', async () => {
  const text = await source('packages/workers/model-router/src/router.ts');
  for (const pattern of [
    /\bRegionGroundedDescriptor\b/,
    /\bDescriptorStatus\b/,
    /\bmodel-router-descriptors\b/,
    /\bvisionDescriptorCache\b/,
    /\bloadOrCreateVisionDescriptor\b/,
    /\bneed_more_visual_info\b/,
    /\bmaxSupplementRounds\b/,
    /\bdescriptorStatus\b/,
    /\btargetedVisionRefinementInstruction\b/,
  ]) {
    assert.doesNotMatch(text, pattern);
  }
});
