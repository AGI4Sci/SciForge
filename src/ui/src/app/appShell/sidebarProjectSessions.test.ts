import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSciForgeConfig, normalizeWorkspaceRootPath } from '../../config';
import type { SciForgeSession, ScenarioInstanceId } from '../../domain';
import { buildSidebarProjectThreadGroups, buildSidebarThreadItems } from './ShellPanels';
import {
  buildSidebarProjectSessionsByPath,
  peerSidebarProjectSessionTargets,
} from './sidebarProjectSessions';

const mainPath = normalizeWorkspaceRootPath('/tmp/sciforge-projects/main');
const peerPath = normalizeWorkspaceRootPath('/tmp/sciforge-projects/repair');

test('sidebar project groups bind threads to each project workspace snapshot', () => {
  const mainSessions = {
    'literature-evidence-review': session({
      sessionId: 'main-thread',
      title: 'Main project chat',
    }),
  } as Record<ScenarioInstanceId, SciForgeSession>;
  const peerSessions = {
    'literature-evidence-review': session({
      sessionId: 'peer-thread',
      title: 'Peer project chat',
    }),
  } as Record<ScenarioInstanceId, SciForgeSession>;

  const config = {
    ...defaultSciForgeConfig,
    workspacePath: mainPath,
    peerInstances: [{
      name: 'repair',
      appUrl: 'http://127.0.0.1:27301',
      workspaceWriterUrl: 'http://127.0.0.1:26202',
      workspacePath: peerPath,
      role: 'peer' as const,
      trustLevel: 'readonly' as const,
      enabled: true,
    }],
  };
  const projectSessionsByPath = buildSidebarProjectSessionsByPath(
    config,
    { workspacePath: mainPath, sessionsByScenario: mainSessions, archivedSessions: [] },
    { [peerPath]: { sessionsByScenario: peerSessions, archivedSessions: [] } },
  );

  const groups = buildSidebarProjectThreadGroups(config, mainSessions, [], { projectSessionsByPath });
  assert.equal(groups[0]?.id, mainPath);
  assert.equal(groups[0]?.threads[0]?.sessionId, 'main-thread');
  assert.equal(groups[1]?.id, peerPath);
  assert.equal(groups[1]?.threads[0]?.sessionId, 'peer-thread');
});

test('switching active workspace does not move peer project threads into current project', () => {
  const mainSessions = {
    'literature-evidence-review': session({ sessionId: 'main-thread', title: 'Main project chat' }),
  } as Record<ScenarioInstanceId, SciForgeSession>;
  const peerSessions = {
    'literature-evidence-review': session({ sessionId: 'peer-thread', title: 'Peer project chat' }),
  } as Record<ScenarioInstanceId, SciForgeSession>;
  const config = {
    ...defaultSciForgeConfig,
    workspacePath: peerPath,
    workspaceWriterBaseUrl: 'http://127.0.0.1:26202',
    peerInstances: [{
      name: 'main',
      appUrl: 'http://127.0.0.1:27301',
      workspaceWriterUrl: 'http://127.0.0.1:26201',
      workspacePath: mainPath,
      role: 'peer' as const,
      trustLevel: 'readonly' as const,
      enabled: true,
    }],
  };
  const projectSessionsByPath = buildSidebarProjectSessionsByPath(
    config,
    { workspacePath: mainPath, sessionsByScenario: mainSessions, archivedSessions: [] },
    { [peerPath]: { sessionsByScenario: peerSessions, archivedSessions: [] } },
  );

  const groups = buildSidebarProjectThreadGroups(config, peerSessions, [], { projectSessionsByPath });
  assert.equal(groups.find((group) => group.current)?.threads[0]?.sessionId, 'peer-thread');
  assert.equal(groups.find((group) => group.id === mainPath)?.threads[0]?.sessionId, 'main-thread');
  assert.deepEqual(buildSidebarThreadItems(peerSessions).map((item) => item.sessionId), ['peer-thread']);
});

test('project switch mid-hydrate keeps stale sessions under previous workspace path', () => {
  const mainSessions = {
    'literature-evidence-review': session({ sessionId: 'main-thread', title: 'Main project chat' }),
  } as Record<ScenarioInstanceId, SciForgeSession>;
  const config = {
    ...defaultSciForgeConfig,
    workspacePath: peerPath,
    peerInstances: [{
      name: 'main',
      appUrl: 'http://127.0.0.1:27301',
      workspaceWriterUrl: 'http://127.0.0.1:26201',
      workspacePath: mainPath,
      role: 'peer' as const,
      trustLevel: 'readonly' as const,
      enabled: true,
    }],
  };
  const projectSessionsByPath = buildSidebarProjectSessionsByPath(
    config,
    { workspacePath: mainPath, sessionsByScenario: mainSessions, archivedSessions: [] },
    { [mainPath]: { sessionsByScenario: mainSessions, archivedSessions: [] } },
  );

  const groups = buildSidebarProjectThreadGroups(config, mainSessions, [], {
    projectSessionsByPath,
    activeWorkspacePath: mainPath,
  });
  assert.deepEqual(groups.find((group) => group.current)?.threads, []);
  assert.equal(groups.find((group) => group.id === mainPath)?.threads[0]?.sessionId, 'main-thread');
});

test('peer sidebar session targets skip current workspace path', () => {
  const sharedWriter = 'http://127.0.0.1:26201';
  const config = {
    ...defaultSciForgeConfig,
    workspacePath: mainPath,
    workspaceWriterBaseUrl: sharedWriter,
    peerInstances: [{
      name: 'repair',
      appUrl: 'http://127.0.0.1:27301',
      workspaceWriterUrl: 'http://127.0.0.1:26202',
      workspacePath: peerPath,
      role: 'peer' as const,
      trustLevel: 'readonly' as const,
      enabled: true,
    }],
  };

  assert.deepEqual(peerSidebarProjectSessionTargets(config), [{
    path: peerPath,
    writerBaseUrl: sharedWriter,
  }]);
});

function session(patch: Partial<SciForgeSession> = {}): SciForgeSession {
  const scenarioId = patch.scenarioId ?? 'literature-evidence-review';
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: scenarioId as ScenarioInstanceId,
    title: '默认聊天',
    createdAt: '2026-05-21T00:00:00.000Z',
    messages: [{ id: 'user-1', role: 'user', content: 'hello', createdAt: '2026-05-21T00:00:00.000Z' }],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    updatedAt: '2026-05-21T00:01:00.000Z',
    ...patch,
  };
}
