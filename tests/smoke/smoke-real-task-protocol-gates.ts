import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertRealTaskProjectBoardTask } from './real-task-project-board.js';
import {
  currentProjectMappingsForSaWebTag,
} from './web-e2e/case-tags.js';

const root = process.cwd();
const [
  projectText,
  packageJson,
  guiProtocol,
  guiProtocolTest,
  manifestTest,
  inlineRefs,
  messageContent,
  messageContentTest,
  responseNormalization,
  responseNormalizationTest,
  resultPresentation,
  resultPresentationTest,
] = await Promise.all([
  readText('PROJECT.md'),
  readJson<{ scripts?: Record<string, string> }>('package.json'),
  readText('src/ui/src/app/guiProtocol.ts'),
  readText('src/ui/src/app/guiProtocol.test.ts'),
  readText('src/runtime/codex/gui-extension-manifest.test.ts'),
  readText('packages/support/object-references/inline-references.ts'),
  readText('src/ui/src/app/chat/MessageContent.tsx'),
  readText('src/ui/src/app/chat/MessageContent.test.tsx'),
  readText('src/ui/src/api/agentClient/responseNormalization.ts'),
  readText('src/ui/src/api/agentClient/responseNormalization.test.ts'),
  readText('packages/contracts/runtime/result-presentation.ts'),
  readText('packages/contracts/runtime/result-presentation.test.ts'),
]);

assert.equal(
  packageJson.scripts?.['smoke:real-task-protocol-gates'],
  'tsx tests/smoke/smoke-real-task-protocol-gates.ts',
  'package.json must expose the GUI/TUI real-task gate',
);

for (const taskId of ['R-PROTO-04', 'R-PROTO-05', 'R-VERIFY-02'] as const) {
  assertRealTaskProjectBoardTask(projectText, taskId, { root });
}

const proto04 = currentProjectMappingsForSaWebTag('SA-WEB-39').find((mapping) => mapping.taskId === 'R-PROTO-04');
assert.ok(proto04, 'R-PROTO-04 must map to SA-WEB-39');
assert.ok(proto04.contractAssertions.includes('gui-presentation-catalog-discovery'), 'R-PROTO-04 must require GUI presentation catalog discovery');

const proto05 = currentProjectMappingsForSaWebTag('SA-WEB-40').find((mapping) => mapping.taskId === 'R-PROTO-05');
assert.ok(proto05, 'R-PROTO-05 must map to SA-WEB-40');
assert.ok(proto05.contractAssertions.includes('inline-reference-right-panel-preview'), 'R-PROTO-05 must require inline object reference right-panel preview');

const verify02 = currentProjectMappingsForSaWebTag('SA-WEB-41').find((mapping) => mapping.taskId === 'R-VERIFY-02');
assert.ok(verify02, 'R-VERIFY-02 must map to SA-WEB-41');
assert.ok(verify02.contractAssertions.includes('confidence-source-explanation'), 'R-VERIFY-02 must require confidence source and explanation coverage');

assert.match(guiProtocol, /\/gui\/capabilities\/presentation\.json/, 'R-PROTO-04 must expose the presentation catalog resource');
assert.match(guiProtocol, /\/gui\/renderers\/<componentId>\.json|\/gui\/renderers\//, 'R-PROTO-04 must expose renderer resources');
assert.match(guiProtocol, /uiComponentManifests/, 'R-PROTO-04 catalog must come from package manifests');
assert.match(guiProtocol, /renderer['"]\s*\|\s*['"]artifact-type['"]\s*\|\s*['"]preview-kind/, 'R-PROTO-04 search must index renderer/artifact/preview semantics');
assert.match(guiProtocolTest, /presentation catalog and renderer resources/, 'R-PROTO-04 protocol tests must cover presentation resources');
assert.match(manifestTest, /without task rankings or workspace mutation/, 'R-PROTO-04 runtime MCP tests must reject task rankings and workspace mutation');

assert.match(inlineRefs, /resolveInlineObjectReferenceToken/, 'R-PROTO-05 must use a shared inline object reference resolver');
assert.match(inlineRefs, /uniqueReferencesByIdentity/, 'R-PROTO-05 must keep duplicate basename references ambiguous');
assert.match(messageContent, /onObjectReferenceFocus/, 'R-PROTO-05 message markdown must route clicks to the right-panel focus callback');
assert.match(messageContentTest, /unique bare filenames and leaves ambiguous code alone/, 'R-PROTO-05 tests must cover unique and ambiguous bare filenames');

assert.doesNotMatch(responseNormalization, /0\.78/, 'R-VERIFY-02 normalizer must not synthesize the old 78% confidence');
assert.match(responseNormalizationTest, /does not synthesize confidence when runtime payload is unscored/, 'R-VERIFY-02 tests must cover unscored runtime payloads');
assert.match(resultPresentation, /evidenceDefault/, 'R-VERIFY-02 contract must preserve evidenceDefault');
assert.match(resultPresentation, /evidenceCap/, 'R-VERIFY-02 contract must preserve evidenceCap');
assert.match(resultPresentation, /penalties/, 'R-VERIFY-02 contract must preserve verifier penalties');
assert.match(resultPresentationTest, /structured confidence explanation preserves verifier scoring fields/, 'R-VERIFY-02 tests must cover structured confidence explanation');

console.log('[ok] real-task GUI/TUI gates cover R-PROTO-04, R-PROTO-05, and R-VERIFY-02 catalog, inline refs, and confidence-source contracts');

async function readText(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}
