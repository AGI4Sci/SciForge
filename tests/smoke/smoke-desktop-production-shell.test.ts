import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  DesktopProductionShellController,
  assertDesktopPackagingPreflightCanClaimPass,
  assertDesktopProductionArtifactCannotClaimRDeskOrRPkgPass,
  assertDesktopProductionArtifactInspectable,
  assertNoViteDevServerUrls,
  createDesktopPackagingPreflightContract,
  createDesktopProductionShellPlan,
  desktopPackagedArtifactCandidates,
  inspectDesktopProductionArtifact,
  resolveDesktopPackagedArtifact,
} from '../../src/desktop/index.js';

test('R-DESK/R-PKG planner loads only the dist-ui production artifact', () => {
  const projectRoot = process.cwd();
  const plan = createDesktopProductionShellPlan({
    projectRoot,
    runtimeControlUrl: 'http://127.0.0.1:62001',
    requireExistingRenderer: true,
  });

  assert.equal(plan.implementationStatus, 'electron-entrypoint-present');
  assert.equal(plan.fullElectronEntrypointImplemented, true);
  assert.equal(plan.renderer.source, 'dist-ui-index-html');
  assert.equal(plan.renderer.loadStrategy.kind, 'electron-load-file');
  assert.equal(plan.renderer.loadStrategy.filePath, join(projectRoot, 'dist-ui', 'index.html'));
  assert.equal(plan.renderer.devServerUrlAllowed, false);
  assert.equal(plan.renderer.requireBuildArtifact, true);
  assert.equal(plan.packageBoundary.rendererEntryRelativePath, 'dist-ui/index.html');
  assert.equal(plan.main.entrypoint.sourcePath, join(projectRoot, 'src', 'desktop', 'main.ts'));
  assert.equal(plan.main.preloadScript.sourcePath, join(projectRoot, 'src', 'desktop', 'preload.cjs'));
  assert.equal(plan.packageBoundary.rendererBuildArtifactRequired, true);
  assert.equal(plan.packageBoundary.electronDependencyRequiredForPackaging, true);
  assert.equal(plan.packageBoundary.startsViteDevServer, false);
  assert.equal(plan.packageBoundary.fixedDevPortsAreProductionContract, false);
  assertNoViteDevServerUrls(plan);
});

test('R-PKG rejects Vite dev URLs instead of making them production contracts', () => {
  assert.throws(
    () => createDesktopProductionShellPlan({
      projectRoot: process.cwd(),
      runtimeControlUrl: 'http://localhost:5173',
    }),
    /must not use a Vite dev server URL/,
  );

  assert.throws(
    () => assertNoViteDevServerUrls({ renderer: 'http://127.0.0.1:5178/src/main.tsx' }),
    /Vite dev server URL/,
  );
});

test('R-DESK sidecar lifecycle belongs to Electron main and the launcher', () => {
  const plan = createDesktopProductionShellPlan({
    projectRoot: process.cwd(),
    runtimeControlUrl: 'http://127.0.0.1:62002',
  });

  assert.equal(plan.main.runtimeLauncherOwnership.owner, 'electron-main-runtime-launcher');
  assert.equal(plan.main.runtimeLauncherOwnership.startBeforeRendererReady, true);
  assert.equal(plan.main.runtimeLauncherOwnership.injectRuntimeControlUrlIntoPreload, true);
  assert.equal(plan.main.runtimeLauncherOwnership.rendererMayStartSidecars, false);
  assert.equal(plan.runtime.portPolicy.allocation, 'dynamic-loopback-port-assigned-by-launcher');
  assert.equal(plan.runtime.portPolicy.fixedDevPortsAllowed, false);
  assert.equal(plan.runtime.portPolicy.viteDevServerPortsForbidden, true);
  assert.ok(plan.runtime.portPolicy.forbiddenFixedDevPorts.includes(5173));

  const roles = new Set(plan.runtime.sidecars.map((sidecar) => sidecar.role));
  assert.deepEqual([...roles].sort(), ['provider-proxy', 'runtime-codex', 'workspace-server']);
  for (const sidecar of plan.runtime.sidecars) {
    assert.equal(sidecar.owner, 'electron-main-runtime-launcher');
    assert.equal(sidecar.lifecycle, 'managed-by-launcher');
    assert.equal(sidecar.startTrigger, 'main-before-renderer-ready');
    assert.equal(sidecar.shutdownTrigger, 'launcher-shutdown');
    assert.equal(sidecar.rendererMayStart, false);
  }
});

test('R-DESK preload exposes a narrow renderer contract with Node disabled', () => {
  const plan = createDesktopProductionShellPlan({
    projectRoot: process.cwd(),
    runtimeControlUrl: 'http://127.0.0.1:62003',
  });

  assert.equal(plan.preload.apiName, 'sciforgeDesktop');
  assert.equal(plan.preload.contextIsolation, true);
  assert.equal(plan.preload.sandbox, true);
  assert.equal(plan.preload.nodeIntegration, false);
  assert.equal(plan.appData.source, 'electron-app-getPath-userData');
  assert.equal(plan.appData.requiredForPackaging, true);
  assert.equal(plan.appData.logsDirectoryRelativePath, 'logs');
  assert.equal(plan.appData.sidecarLogsDirectoryRelativePath, 'logs/sidecars');
  assert.equal(plan.appData.rendererMayResolveOrWrite, false);
	  assert.deepEqual(plan.preload.ipcChannels, [
	    'runtime:config',
	    'runtime:health',
	    'runtime:ready',
    'runtime:shutdown',
    'desktop:native-browser:open',
    'desktop:native-browser:back',
    'desktop:native-browser:forward',
    'desktop:native-browser:reload',
    'desktop:native-browser:state',
    'desktop:native-browser:screenshot',
    'desktop:browser-host-surface:attach',
    'desktop:browser-host-surface:detach',
    'desktop:browser-host-surface:state',
    'desktop:virtual-app-screen-surface:attach',
    'desktop:virtual-app-screen-surface:present',
    'desktop:virtual-app-screen-surface:detach',
    'platform:open-external',
    'platform:reveal-path',
    'platform:pick-directory',
  ]);
  assert.ok(plan.preload.forbiddenRendererCapabilities.includes('start or own Runtime Codex sidecars'));
});

test('R-DESK shutdown closes the runtime launcher exactly once', async () => {
  const calls: string[] = [];
  let closed = false;
  const shell = new DesktopProductionShellController({
    projectRoot: process.cwd(),
    launcher: {
      async start() {
        calls.push('start');
        return {
          controlUrl: 'http://127.0.0.1:62004',
          auditLogPath: '/tmp/sciforge-desktop-runtime-audit.ndjson',
        };
      },
      async shutdown() {
        calls.push('shutdown');
        closed = true;
      },
    },
  });

  const started = await shell.start();
  assert.equal(started.rendererLoad.filePath, join(process.cwd(), 'dist-ui', 'index.html'));
  assert.equal(started.plan.shutdown.closesLauncher, true);
  assert.ok(started.plan.shutdown.sequence.includes('runtime-launcher.shutdown'));

  await shell.shutdown();
  await shell.shutdown();

  assert.equal(closed, true);
  assert.deepEqual(calls, ['start', 'shutdown']);
});

test('R-PKG preflight blocks pass claims when Electron dependency and entrypoint are absent', () => {
  const plan = createDesktopProductionShellPlan({
    projectRoot: process.cwd(),
    runtimeControlUrl: 'http://127.0.0.1:62005',
    electronEntrypointImplemented: false,
  });
  const userDataPath = join(tmpdir(), 'sciforge-desktop-preflight-userData');
  const logPath = join(userDataPath, 'logs');

  const preflight = createDesktopPackagingPreflightContract({
    plan,
    packageManifest: {},
    rendererArtifactExists: true,
    resolvedAppDataPath: userDataPath,
    resolvedLogPath: logPath,
  });

  assert.equal(preflight.verdict, 'blocked');
  assert.equal(preflight.preflightChecksPass, false);
  assert.equal(preflight.canClaimPass, false);
  assert.equal(preflight.canClaimRDeskOrRPkgPass, false);
  assert.equal(preflight.checks.fullElectronEntrypointImplemented.actual, false);
  assert.equal(preflight.checks.fullElectronEntrypointImplemented.status, 'fail');
  assert.equal(preflight.checks.electronDependency.present, false);
  assert.equal(preflight.checks.electronDependency.status, 'fail');
  assert.equal(preflight.checks.rendererBuildArtifact.status, 'pass');
  assert.equal(preflight.checks.appDataPath.status, 'pass');
  assert.equal(preflight.checks.logPath.status, 'pass');
  assert.equal(preflight.checks.sidecarRoles.status, 'pass');
  assert.equal(preflight.checks.portPolicy.status, 'pass');
  assert.match(preflight.blockReasons.join('\n'), /fullElectronEntrypointImplemented=false/);
  assert.match(preflight.blockReasons.join('\n'), /No electron runtime dependency/);
  assert.match(preflight.passClaimBlockReasons.join('\n'), /real Runtime Codex task/);
  assert.throws(
    () => assertDesktopPackagingPreflightCanClaimPass(preflight),
    /cannot claim R-DESK\/R-PKG pass/,
  );
});

test('R-PKG preflight becomes inspectable but still cannot claim R-DESK/R-PKG pass by itself', () => {
  const plan = createDesktopProductionShellPlan({
    projectRoot: process.cwd(),
    runtimeControlUrl: 'http://127.0.0.1:62007',
  });
  const packageManifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const userDataPath = join(tmpdir(), 'sciforge-desktop-pass-userData');
  const logPath = join(userDataPath, 'logs');

  const preflight = createDesktopPackagingPreflightContract({
    plan,
    packageManifest,
    rendererArtifactExists: true,
    resolvedAppDataPath: userDataPath,
    resolvedLogPath: logPath,
  });

  assert.equal(preflight.verdict, 'inspectable');
  assert.equal(preflight.preflightChecksPass, true);
  assert.equal(preflight.canClaimPass, false);
  assert.equal(preflight.canClaimRDeskOrRPkgPass, false);
  assert.equal(preflight.checks.fullElectronEntrypointImplemented.status, 'pass');
  assert.equal(preflight.checks.electronDependency.status, 'pass');
  assert.ok(preflight.checks.electronDependency.dependencyNames.some((entry) => entry.endsWith(':electron')));
  assert.deepEqual(preflight.blockReasons, []);
  assert.deepEqual(preflight.passClaimBoundary.requiredLiveEvidence, [
    'runtime-codex-real-task',
    'selected-artifact-followup',
    'sidecar-lifecycle-owned-by-main',
    'clean-shutdown',
  ]);
  assert.throws(
    () => assertDesktopPackagingPreflightCanClaimPass(preflight),
    /real Runtime Codex task, selected-artifact follow-up, sidecar lifecycle, and clean shutdown evidence/,
  );
});

test('R-PKG preflight requires renderer artifact and Electron userData logs path contract', () => {
  const plan = createDesktopProductionShellPlan({
    projectRoot: process.cwd(),
    runtimeControlUrl: 'http://127.0.0.1:62006',
  });
  const userDataPath = join(tmpdir(), 'sciforge-desktop-valid-userData');
  const logPath = join(userDataPath, 'logs');

  const preflight = createDesktopPackagingPreflightContract({
    plan,
    packageManifest: { devDependencies: { electron: '^99.0.0' } },
    rendererArtifactExists: false,
    resolvedAppDataPath: userDataPath,
    resolvedLogPath: logPath,
  });

  assert.equal(preflight.checks.electronDependency.status, 'pass');
  assert.deepEqual(preflight.checks.electronDependency.dependencyNames, ['devDependencies:electron']);
  assert.equal(preflight.checks.rendererBuildArtifact.required, true);
  assert.equal(preflight.checks.rendererBuildArtifact.relativePath, 'dist-ui/index.html');
  assert.equal(preflight.checks.rendererBuildArtifact.status, 'fail');
  assert.match(preflight.checks.rendererBuildArtifact.message, /requires dist-ui\/index\.html/);
  assert.equal(preflight.checks.appDataPath.resolvedPath, userDataPath);
  assert.equal(preflight.checks.logPath.resolvedPath, logPath);
  assert.equal(preflight.checks.logPath.sidecarLogDirectory, join(logPath, 'sidecars'));
  assert.equal(preflight.checks.logPath.auditLogFile, join(logPath, 'desktop-runtime-audit.ndjson'));
  assert.doesNotMatch(preflight.blockReasons.join('\n'), /fullElectronEntrypointImplemented=false/);

  const invalidPaths = createDesktopPackagingPreflightContract({
    plan,
    packageManifest: { devDependencies: { electron: '^99.0.0' } },
    rendererArtifactExists: true,
    resolvedAppDataPath: userDataPath,
    resolvedLogPath: join(tmpdir(), 'sciforge-desktop-outside-logs'),
  });

  assert.equal(invalidPaths.checks.appDataPath.status, 'pass');
  assert.equal(invalidPaths.checks.logPath.status, 'fail');
  assert.match(invalidPaths.checks.logPath.message, /under Electron userData/);
});

test('R-PKG packaged app artifact inspection reads app.asar main, preload, and renderer without credentials', async () => {
  const artifactPath = await createPackagedAppFixture();

  const inspection = await inspectDesktopProductionArtifact({ artifactPath });

  assert.equal(inspection.schemaVersion, 'sciforge.desktop.production-artifact-inspection.v1');
  assert.equal(inspection.verdict, 'inspectable');
  assert.equal(inspection.inspectable, true);
  assert.equal(inspection.canClaimRDeskOrRPkgPass, false);
  assert.equal(inspection.artifactKind, 'mac-app-directory');
  assert.equal(inspection.checks.electronBundleLayout.status, 'pass');
  assert.equal(inspection.checks.asarArchive.status, 'pass');
  assert.equal(inspection.checks.packageMain.status, 'pass');
  assert.equal(inspection.checks.mainProcess.status, 'pass');
  assert.equal(inspection.checks.preload.status, 'pass');
  assert.equal(inspection.checks.renderer.status, 'pass');
  assert.equal(inspection.checks.noDevServerUrls.status, 'pass');
  assert.equal(inspection.checks.noTestArtifacts.status, 'pass');
  assert.equal(inspection.evidence.bundleIdentifier, 'ai.sciforge.desktop');
  assert.equal(inspection.evidence.packageMain, 'dist-desktop/src/desktop/main.js');
	  assert.ok(inspection.evidence.extractedFiles.some((file) => file.path === 'dist-desktop/src/desktop/main.js'));
	  assert.ok(inspection.evidence.extractedFiles.some((file) => file.path === 'dist-desktop/src/desktop/preload.cjs'));
	  assert.ok(inspection.evidence.extractedFiles.some((file) => file.path === 'dist-desktop/src/runtime/workspace-server.js'));
	  assert.ok(inspection.evidence.extractedFiles.some((file) => file.path === 'dist-desktop/packages/backend/src/cli.js'));
	  assert.ok(inspection.evidence.extractedFiles.some((file) => file.path === 'dist-desktop/src/runtime/codex/codex-runtime-standalone-server.js'));
	  assert.ok(inspection.evidence.extractedFiles.some((file) => file.path === 'dist-ui/index.html'));
  assert.equal(inspection.liveAcceptanceSummary?.credentialsRequired, false);
  assert.equal(inspection.liveAcceptanceSummary?.canClaimRDeskOrRPkgPass, false);
  assert.doesNotThrow(() => assertDesktopProductionArtifactInspectable(inspection));
  assert.doesNotThrow(() => assertDesktopProductionArtifactCannotClaimRDeskOrRPkgPass(inspection));
});

test('R-PKG packaged artifact resolver derives platform package paths without mac-arm64 hardcoding', () => {
  const root = join(tmpdir(), 'sciforge-desktop-package-root');

  assert.deepEqual(
    desktopPackagedArtifactCandidates({ projectRoot: root, platform: 'darwin', arch: 'arm64' }),
    [
      join(root, 'dist-desktop-packages', 'mac-arm64', 'SciForge.app'),
      join(root, 'dist-desktop-packages', 'mac', 'SciForge.app'),
      join(root, 'dist-desktop-packages', 'mac-universal', 'SciForge.app'),
    ],
  );
  assert.deepEqual(
    desktopPackagedArtifactCandidates({ projectRoot: root, platform: 'darwin', arch: 'x64' }),
    [
      join(root, 'dist-desktop-packages', 'mac', 'SciForge.app'),
      join(root, 'dist-desktop-packages', 'mac-x64', 'SciForge.app'),
      join(root, 'dist-desktop-packages', 'mac-universal', 'SciForge.app'),
    ],
  );
  assert.deepEqual(
    desktopPackagedArtifactCandidates({ projectRoot: root, platform: 'linux', arch: 'x64' }),
    [join(root, 'dist-desktop-packages', 'linux-unpacked', 'resources', 'app.asar')],
  );
  assert.deepEqual(
    desktopPackagedArtifactCandidates({ projectRoot: root, platform: 'win32', arch: 'x64' }),
    [join(root, 'dist-desktop-packages', 'win-unpacked', 'resources', 'app.asar')],
  );

  const explicitAsar = join(root, 'custom', 'resources', 'app.asar');
  const resolved = resolveDesktopPackagedArtifact({
    projectRoot: root,
    artifactPath: explicitAsar,
    platform: 'linux',
    arch: 'x64',
  });

  assert.equal(resolved.artifactPath, explicitAsar);
  assert.equal(resolved.asarPath, explicitAsar);
  assert.equal(resolved.resourcesPath, join(root, 'custom', 'resources'));
  assert.equal(resolved.executablePath, join(root, 'custom', 'SciForge'));
});

test('R-PKG artifact inspection blocks Vite-style renderer artifacts', async () => {
  const artifactPath = await createPackagedAppFixture({
    rendererHtml: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  });

  const inspection = await inspectDesktopProductionArtifact({ artifactPath });

  assert.equal(inspection.verdict, 'blocked');
  assert.equal(inspection.inspectable, false);
  assert.equal(inspection.canClaimRDeskOrRPkgPass, false);
  assert.equal(inspection.checks.renderer.status, 'fail');
  assert.match(inspection.blockReasons.join('\n'), /built dist-ui\/index\.html/);
  assert.throws(
    () => assertDesktopProductionArtifactInspectable(inspection),
    /not inspectable/,
  );
});

test('R-PKG artifact inspection blocks compiled project tests but ignores dependency fixture specs', async () => {
  const dependencySpecArtifact = await createPackagedAppFixture({
    extraFiles: [
      ['node_modules/json-schema-traverse/spec/index.spec.js', 'module.exports = {};\n'],
    ],
  });

  const dependencyInspection = await inspectDesktopProductionArtifact({ artifactPath: dependencySpecArtifact });
  assert.equal(dependencyInspection.verdict, 'inspectable');
  assert.equal(dependencyInspection.checks.noTestArtifacts.status, 'pass');

  const projectTestArtifact = await createPackagedAppFixture({
    extraFiles: [
      ['dist-desktop/src/runtime/codex/codex-runtime-server.test.js', 'export {};\n'],
    ],
  });

  const projectInspection = await inspectDesktopProductionArtifact({ artifactPath: projectTestArtifact });
  assert.equal(projectInspection.verdict, 'blocked');
  assert.equal(projectInspection.checks.noTestArtifacts.status, 'fail');
  assert.match(projectInspection.blockReasons.join('\n'), /dist-desktop\/src\/runtime\/codex\/codex-runtime-server\.test\.js/);
});

async function createPackagedAppFixture(
  options: {
    rendererHtml?: string;
    extraFiles?: Array<[string, string]>;
  } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-packaged-app-inspection-'));
  const appPath = join(root, 'SciForge.app');
  const resourcesPath = join(appPath, 'Contents', 'Resources');
  const macOsPath = join(appPath, 'Contents', 'MacOS');
  const asarSourcePath = join(root, 'asar-source');
  await mkdir(resourcesPath, { recursive: true });
  await mkdir(macOsPath, { recursive: true });
	  await mkdir(join(asarSourcePath, 'dist-desktop', 'src', 'desktop'), { recursive: true });
	  await mkdir(join(asarSourcePath, 'dist-desktop', 'src', 'runtime', 'codex'), { recursive: true });
	  await mkdir(join(asarSourcePath, 'dist-desktop', 'packages', 'backend', 'src'), { recursive: true });
	  await mkdir(join(asarSourcePath, 'dist-ui'), { recursive: true });
  await writeFile(join(appPath, 'Contents', 'Info.plist'), infoPlistFixture(), 'utf8');
  await writeFile(join(macOsPath, 'SciForge'), '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(join(macOsPath, 'SciForge'), 0o755);
  await copyFile(join(process.cwd(), 'package.json'), join(asarSourcePath, 'package.json'));
  await copyFile(
    join(process.cwd(), 'dist-desktop', 'src', 'desktop', 'main.js'),
    join(asarSourcePath, 'dist-desktop', 'src', 'desktop', 'main.js'),
  );
	  await copyFile(
	    join(process.cwd(), 'dist-desktop', 'src', 'desktop', 'preload.cjs'),
	    join(asarSourcePath, 'dist-desktop', 'src', 'desktop', 'preload.cjs'),
	  );
	  await copyFile(
	    join(process.cwd(), 'dist-desktop', 'src', 'runtime', 'workspace-server.js'),
	    join(asarSourcePath, 'dist-desktop', 'src', 'runtime', 'workspace-server.js'),
	  );
	  await copyFile(
	    join(process.cwd(), 'dist-desktop', 'packages', 'backend', 'src', 'cli.js'),
	    join(asarSourcePath, 'dist-desktop', 'packages', 'backend', 'src', 'cli.js'),
	  );
	  await copyFile(
	    join(process.cwd(), 'dist-desktop', 'src', 'runtime', 'codex', 'codex-runtime-standalone-server.js'),
	    join(asarSourcePath, 'dist-desktop', 'src', 'runtime', 'codex', 'codex-runtime-standalone-server.js'),
	  );
  if (options.rendererHtml) {
    await writeFile(join(asarSourcePath, 'dist-ui', 'index.html'), options.rendererHtml, 'utf8');
  } else {
    await copyFile(join(process.cwd(), 'dist-ui', 'index.html'), join(asarSourcePath, 'dist-ui', 'index.html'));
  }
  for (const [relativePath, contents] of options.extraFiles ?? []) {
    const targetPath = join(asarSourcePath, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, contents, 'utf8');
  }
  const asar = await import('@electron/asar');
  await asar.createPackage(asarSourcePath, join(resourcesPath, 'app.asar'));
  return appPath;
}

function infoPlistFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleExecutable</key>
    <string>SciForge</string>
    <key>CFBundleIdentifier</key>
    <string>ai.sciforge.desktop</string>
    <key>CFBundleName</key>
    <string>SciForge</string>
  </dict>
</plist>
`;
}
