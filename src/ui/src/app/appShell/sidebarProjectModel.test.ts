import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSciForgeConfig, normalizeWorkspaceRootPath } from '../../config';
import {
  buildConfiguredSidebarProjects,
  buildWorkspaceProjectActivation,
  migrateLegacySidebarProjectId,
  removeSidebarProjectFromConfig,
  sidebarProjectIdForConfig,
  sidebarProjectIdForPeer,
} from './sidebarProjectModel';

const mainPath = normalizeWorkspaceRootPath('/tmp/sciforge-projects/main');
const peerPath = normalizeWorkspaceRootPath('/tmp/sciforge-projects/repair');
const mainWriter = 'http://127.0.0.1:26201';
const peerWriter = 'http://127.0.0.1:26202';

function dualProjectConfig(workspacePath = mainPath) {
  return {
    ...defaultSciForgeConfig,
    workspacePath,
    workspaceWriterBaseUrl: mainWriter,
    peerInstances: [{
      name: 'repair',
      appUrl: 'http://127.0.0.1:27301',
      workspaceWriterUrl: peerWriter,
      workspacePath: peerPath,
      role: 'peer' as const,
      trustLevel: 'readonly' as const,
      enabled: true,
    }],
  };
}

test('sidebar project ids derive from configured workspace paths', () => {
  const config = dualProjectConfig();
  const projects = buildConfiguredSidebarProjects(config);
  assert.equal(projects[0]?.id, mainPath);
  assert.equal(projects[1]?.id, peerPath);
  assert.equal(sidebarProjectIdForConfig(config), mainPath);
  assert.equal(sidebarProjectIdForPeer(config.peerInstances![0]), peerPath);
});

test('legacy sidebar project ids migrate to configured workspace paths', () => {
  const config = dualProjectConfig();
  assert.equal(migrateLegacySidebarProjectId(config, 'current'), mainPath);
  assert.equal(migrateLegacySidebarProjectId(config, 'peer:repair'), peerPath);
});

test('removeSidebarProjectFromConfig drops peer projects but keeps current workspace', () => {
  const config = dualProjectConfig();
  const projects = buildConfiguredSidebarProjects(config);
  assert.equal(removeSidebarProjectFromConfig(config, projects[0]), undefined);
  const patch = removeSidebarProjectFromConfig(config, projects[1]!);
  assert.deepEqual(patch?.peerInstances, []);
});

test('workspace project activation switches workspace path without changing shared writer config', () => {
  const config = dualProjectConfig();
  const patch = buildWorkspaceProjectActivation(config, {
    id: peerPath,
    detail: peerPath,
    current: false,
  });

  assert.equal(patch?.workspacePath, peerPath);
  assert.equal(patch?.workspaceWriterBaseUrl, undefined);
  assert.equal(patch?.peerInstances?.[0]?.workspacePath, mainPath);
  assert.equal(patch?.peerInstances?.[0]?.workspaceWriterUrl, peerWriter);
});
