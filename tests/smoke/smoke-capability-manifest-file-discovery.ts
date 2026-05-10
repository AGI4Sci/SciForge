import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { discoverPackageCapabilityManifestsFromFiles } from '../../src/runtime/capability-manifest-file-discovery.js';
import {
  loadCapabilityManifestRegistry,
  loadCoreCapabilityManifestRegistry,
} from '../../src/runtime/capability-manifest-registry.js';
import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-capability-manifest-discovery-'));

try {
  await writeJsonPackageManifest(tmpRoot);
  await writeTsPackageManifest(tmpRoot);
  await writeNonCapabilityManifest(tmpRoot);

  const discovery = await discoverPackageCapabilityManifestsFromFiles({
    rootDir: tmpRoot,
    maxDepth: 5,
  });
  const coreRegistry = loadCoreCapabilityManifestRegistry();
  const registry = loadCapabilityManifestRegistry({ packageDiscovery: discovery });

  assert.equal(discovery.audit.contract, 'sciforge.capability-manifest-file-discovery-audit.v1');
  assert.equal(discovery.audit.filesScanned, 3);
  assert.equal(discovery.audit.manifestCount, 2);
  assert.equal(discovery.audit.packageCount, 2);
  assert.deepEqual(
    discovery.audit.entries.filter((entry) => entry.status === 'loaded').map((entry) => entry.manifestIds[0]).sort(),
    ['fixture.json-tool', 'fixture.ts-view'],
  );
  assert.equal(
    discovery.audit.entries.find((entry) => entry.filePath.endsWith('notes/manifest.json'))?.status,
    'skipped',
  );

  assert.equal(registry.manifestIds.length, coreRegistry.manifestIds.length + 2);
  assert.equal(registry.getManifest('fixture.json-tool')?.ownerPackage, '@sciforge-fixture/json-tool');
  assert.equal(registry.getManifest('fixture.ts-view')?.ownerPackage, '@sciforge-fixture/ts-view');
  assert.equal(registry.getManifestByProviderId('provider.fixture.ts-view')?.id, 'fixture.ts-view');

  const registryAudit = registry.compactAudit;
  assert.equal(registryAudit.sourceCounts.packageDiscovery, 2);
  assert.equal(registryAudit.entries.find((entry) => entry.id === 'fixture.json-tool')?.packageName, '@sciforge-fixture/json-tool');
  assert.equal(registryAudit.entries.find((entry) => entry.id === 'fixture.ts-view')?.packageName, '@sciforge-fixture/ts-view');
  assert.equal(
    registryAudit.entries.find((entry) => entry.id === 'fixture.ts-view')?.providerAvailability[0]?.available,
    false,
  );

  const graph = registry.projectHarnessCandidates({
    preferredCapabilityIds: ['fixture.ts-view'],
    availableProviders: ['provider.fixture.json-tool', 'provider.fixture.ts-view'],
  });
  assert.ok(graph.candidates.some((candidate) => candidate.id === 'fixture.json-tool'));
  assert.ok(graph.candidates.some((candidate) => candidate.id === 'fixture.ts-view' && candidate.kind === 'view'));

  console.log('[ok] capability manifest file discovery merges JSON and TS package manifests into registry audit');
} finally {
  await rm(tmpRoot, { recursive: true, force: true });
}

async function writeJsonPackageManifest(rootDir: string) {
  const packageRoot = path.join(rootDir, 'packages/json-tool');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@sciforge-fixture/json-tool' }, null, 2));
  await writeFile(
    path.join(packageRoot, 'capability.manifest.json'),
    JSON.stringify({
      manifest: manifest('fixture.json-tool', '@sciforge-fixture/json-tool', 'skill', ['workspace-read']),
      providerAvailability: ['provider.fixture.json-tool'],
    }, null, 2),
  );
}

async function writeTsPackageManifest(rootDir: string) {
  const packageRoot = path.join(rootDir, 'packages/ts-view');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@sciforge-fixture/ts-view' }, null, 2));
  await writeFile(
    path.join(packageRoot, 'manifest.ts'),
    [
      'export const providerAvailability = [{ id: "provider.fixture.ts-view", available: false, reason: "ts fixture disabled" }];',
      `export const capabilityManifest = ${JSON.stringify(manifest('fixture.ts-view', '@sciforge-fixture/ts-view', 'view', ['none']), null, 2)};`,
      '',
    ].join('\n'),
  );
}

async function writeNonCapabilityManifest(rootDir: string) {
  const packageRoot = path.join(rootDir, 'packages/notes');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@sciforge-fixture/notes' }, null, 2));
  await writeFile(path.join(packageRoot, 'manifest.json'), JSON.stringify({ id: 'notes-only', title: 'not a capability manifest' }, null, 2));
}

function manifest(
  id: string,
  ownerPackage: string,
  kind: CapabilityManifest['kind'],
  sideEffects: CapabilityManifest['sideEffects'],
): CapabilityManifest {
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id,
    name: id,
    version: '0.1.0',
    ownerPackage,
    kind,
    brief: `${id} fixture capability manifest`,
    routingTags: ['fixture', kind],
    domains: ['fixture'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffects,
    safety: { risk: sideEffects.includes('none') ? 'low' : 'medium', dataScopes: ['fixture'] },
    examples: [{ title: `${id} example` }],
    validators: [{ id: `${id}.schema`, kind: 'schema', expectedRefs: [] }],
    repairHints: [{ failureCode: `${id}.invalid`, summary: 'rerun fixture validation', recoverActions: ['retry'] }],
    providers: [{
      id: `provider.${id}`,
      label: `${id} provider`,
      kind: 'package',
      requiredConfig: [],
    }],
    lifecycle: { status: 'validated', sourceRef: `fixture/${id}` },
  };
}
