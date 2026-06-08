import { existsSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DESKTOP_PRODUCTION_SHELL_SCHEMA = 'sciforge.desktop.production-shell-plan.v1';
export const DESKTOP_PACKAGING_PREFLIGHT_SCHEMA = 'sciforge.desktop.packaging-preflight.v1';

export type DesktopPassClaimLiveEvidenceRequirement =
  | 'runtime-codex-real-task'
  | 'selected-artifact-followup'
  | 'sidecar-lifecycle-owned-by-main'
  | 'clean-shutdown';

export const DESKTOP_PASS_CLAIM_LIVE_EVIDENCE_REQUIREMENTS: readonly DesktopPassClaimLiveEvidenceRequirement[] = [
  'runtime-codex-real-task',
  'selected-artifact-followup',
  'sidecar-lifecycle-owned-by-main',
  'clean-shutdown',
];

export const DESKTOP_PASS_CLAIM_BLOCK_REASON =
  'R-DESK/R-PKG pass claims require real Runtime Codex task, selected-artifact follow-up, sidecar lifecycle, and clean shutdown evidence.';

export type DesktopSidecarRole = 'workspace-server' | 'model-router' | 'runtime-codex';

export type DesktopLifecycleOwner = 'electron-main-runtime-launcher';

export type DesktopSidecarPlan = {
  role: DesktopSidecarRole;
  owner: DesktopLifecycleOwner;
  lifecycle: 'managed-by-launcher';
  startTrigger: 'main-before-renderer-ready';
  shutdownTrigger: 'launcher-shutdown';
  rendererMayStart: false;
};

export type DesktopPreloadApiMethod =
  | 'getRuntimeConfig'
  | 'getRuntimeHealth'
  | 'getRuntimeReady'
  | 'requestShutdown'
  | 'openExternal'
  | 'openNativeBrowser'
  | 'nativeBrowserBack'
  | 'nativeBrowserForward'
  | 'nativeBrowserReload'
  | 'getNativeBrowserState'
  | 'captureNativeBrowserScreenshot'
  | 'attachBrowserHostSessionSurface'
  | 'detachBrowserHostSessionSurface'
  | 'resizeBrowserHostSessionSurface'
  | 'getBrowserHostSessionSurfaceState'
  | 'startAnnotation'
  | 'startDesktopAnnotation'
  | 'getAnnotationState'
  | 'cancelAnnotation'
  | 'revealPath'
  | 'pickDirectory';

export type DesktopPreloadContract = {
  apiName: 'sciforgeDesktop';
  contextIsolation: true;
  sandbox: true;
  nodeIntegration: false;
  exposedMethods: DesktopPreloadApiMethod[];
	  ipcChannels: Array<
	    | 'runtime:config'
	    | 'runtime:health'
    | 'runtime:ready'
    | 'runtime:shutdown'
    | 'desktop:native-browser:open'
    | 'desktop:native-browser:back'
    | 'desktop:native-browser:forward'
    | 'desktop:native-browser:reload'
    | 'desktop:native-browser:state'
    | 'desktop:native-browser:screenshot'
    | 'desktop:browser-host-surface:attach'
    | 'desktop:browser-host-surface:detach'
    | 'desktop:browser-host-surface:resize'
    | 'desktop:browser-host-surface:state'
    | 'desktop:annotation-overlay:start'
    | 'desktop:annotation-overlay:status'
    | 'desktop:annotation-overlay:cancel'
    | 'platform:open-external'
    | 'platform:reveal-path'
    | 'platform:pick-directory'
  >;
  forbiddenRendererCapabilities: string[];
};

export type DesktopRendererContract = {
  source: 'dist-ui-index-html';
  loadStrategy: {
    kind: 'electron-load-file';
    filePath: string;
    fileUrl: string;
  };
  devServerUrlAllowed: false;
  requireBuildArtifact: true;
  nodeIntegration: false;
  contextIsolation: true;
  sandbox: true;
};

export type DesktopRuntimeContract = {
  transport: 'controlled-loopback';
  controlUrl: string;
  portPolicy: {
    allocation: 'dynamic-loopback-port-assigned-by-launcher';
    fixedDevPortsAllowed: false;
    viteDevServerPortsForbidden: true;
    forbiddenFixedDevPorts: readonly number[];
    rendererReceivesOnlyControlUrl: true;
  };
  sidecars: DesktopSidecarPlan[];
};

export type DesktopAppDataContract = {
  source: 'electron-app-getPath-userData';
  requiredForPackaging: true;
  resolveBeforeLauncherStart: true;
  rendererMayResolveOrWrite: false;
  logsDirectoryRelativePath: 'logs';
  sidecarLogsDirectoryRelativePath: 'logs/sidecars';
  auditLogFileRelativePath: 'logs/desktop-runtime-audit.ndjson';
};

export type DesktopProductionShellPlan = {
  schemaVersion: typeof DESKTOP_PRODUCTION_SHELL_SCHEMA;
  implementationStatus: 'electron-entrypoint-present' | 'pure-ts-planner-no-electron-dependency';
  fullElectronEntrypointImplemented: boolean;
  projectRoot: string;
  renderer: DesktopRendererContract;
  preload: DesktopPreloadContract;
  runtime: DesktopRuntimeContract;
  appData: DesktopAppDataContract;
  main: {
    ownsBrowserWindow: true;
    entrypoint: {
      sourcePath: string;
      compiledPath: string;
    };
    preloadScript: {
      sourcePath: string;
      compiledPath: string;
    };
    runtimeLauncherOwnership: {
      owner: DesktopLifecycleOwner;
      startBeforeRendererReady: true;
      injectRuntimeControlUrlIntoPreload: true;
      rendererMayStartSidecars: false;
    };
    forbiddenResponsibilities: string[];
  };
  shutdown: {
    owner: DesktopLifecycleOwner;
    trigger: 'electron-before-quit-or-window-all-closed';
    sequence: Array<
      | 'stop-renderer-ipc'
      | 'runtime-launcher.shutdown'
      | 'wait-for-launcher-sidecars'
      | 'close-control-transport'
      | 'destroy-browser-window'
    >;
    closesLauncher: true;
  };
  packageBoundary: {
    startsViteDevServer: false;
    fixedDevPortsAreProductionContract: false;
    rendererEntryRelativePath: 'dist-ui/index.html';
    rendererBuildArtifactRequired: true;
    electronDependencyRequiredForPackaging: true;
    externalElectronDependencyRequired: false;
  };
};

export type DesktopProductionShellOptions = {
  projectRoot: string;
  runtimeControlUrl: string;
  requireExistingRenderer?: boolean;
  electronEntrypointImplemented?: boolean;
  desktopMainSourcePath?: string;
  desktopMainCompiledPath?: string;
  preloadSourcePath?: string;
  preloadCompiledPath?: string;
};

export type DesktopRuntimeLauncherStarted = {
  controlUrl: string;
  ports?: Array<{ name: string; actual: number; url: string; conflict?: boolean }>;
  auditLogPath?: string;
};

export type DesktopRuntimeLauncherBridge = {
  start(): Promise<DesktopRuntimeLauncherStarted>;
  shutdown(): Promise<void>;
};

export type DesktopPackageManifestLike = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export type DesktopPackagingPreflightCheckStatus = 'pass' | 'fail';

export type DesktopPackagingPreflightContract = {
  schemaVersion: typeof DESKTOP_PACKAGING_PREFLIGHT_SCHEMA;
  planSchemaVersion: typeof DESKTOP_PRODUCTION_SHELL_SCHEMA;
  verdict: 'inspectable' | 'blocked';
  preflightChecksPass: boolean;
  canClaimPass: false;
  canClaimRDeskOrRPkgPass: false;
  blockReasons: string[];
  passClaimBlockReasons: string[];
  passClaimBoundary: {
    kind: 'packaging-preflight-only';
    requiredLiveEvidence: readonly DesktopPassClaimLiveEvidenceRequirement[];
    message: typeof DESKTOP_PASS_CLAIM_BLOCK_REASON;
  };
  checks: {
    fullElectronEntrypointImplemented: {
      required: true;
      actual: boolean;
      status: DesktopPackagingPreflightCheckStatus;
      message: string;
    };
    electronDependency: {
      required: true;
      present: boolean;
      dependencyNames: string[];
      searchedSections: Array<keyof DesktopPackageManifestLike>;
      status: DesktopPackagingPreflightCheckStatus;
      message: string;
    };
    rendererBuildArtifact: {
      required: true;
      relativePath: 'dist-ui/index.html';
      filePath: string;
      exists: boolean;
      status: DesktopPackagingPreflightCheckStatus;
      message: string;
    };
    appDataPath: {
      required: true;
      source: 'electron-app-getPath-userData';
      mustBeAbsolute: true;
      resolvedPath?: string;
      status: DesktopPackagingPreflightCheckStatus;
      message: string;
    };
    logPath: {
      required: true;
      relativeTo: 'appDataPath';
      relativePath: 'logs';
      resolvedPath?: string;
      sidecarLogDirectory?: string;
      auditLogFile?: string;
      status: DesktopPackagingPreflightCheckStatus;
      message: string;
    };
    sidecarRoles: {
      required: true;
      roles: DesktopSidecarRole[];
      status: DesktopPackagingPreflightCheckStatus;
      message: string;
    };
    portPolicy: {
      required: true;
      fixedDevPortsAllowed: false;
      viteDevServerUrlsAllowed: false;
      forbiddenFixedDevPorts: readonly number[];
      status: DesktopPackagingPreflightCheckStatus;
      message: string;
    };
  };
};

export type DesktopPackagingPreflightOptions = {
  plan: DesktopProductionShellPlan;
  packageManifest?: DesktopPackageManifestLike;
  rendererArtifactExists?: boolean;
  resolvedAppDataPath?: string;
  resolvedLogPath?: string;
};

export type DesktopProductionShellStartResult = {
  plan: DesktopProductionShellPlan;
  launcher: DesktopRuntimeLauncherStarted;
  rendererLoad: DesktopRendererContract['loadStrategy'];
  preload: DesktopPreloadContract;
};

export class DesktopProductionShellController {
  private started?: DesktopProductionShellStartResult;
  private shutdownPromise?: Promise<void>;

  constructor(
    private readonly options: {
      projectRoot: string;
      launcher: DesktopRuntimeLauncherBridge;
      requireExistingRenderer?: boolean;
    },
  ) {}

  async start(): Promise<DesktopProductionShellStartResult> {
    if (this.started) return this.started;
    const launcher = await this.options.launcher.start();
    const plan = createDesktopProductionShellPlan({
      projectRoot: this.options.projectRoot,
      runtimeControlUrl: launcher.controlUrl,
      requireExistingRenderer: this.options.requireExistingRenderer,
    });
    this.started = {
      plan,
      launcher,
      rendererLoad: plan.renderer.loadStrategy,
      preload: plan.preload,
    };
    return this.started;
  }

  async shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.options.launcher.shutdown();
    }
    await this.shutdownPromise;
  }
}

export function createDesktopProductionShellPlan(options: DesktopProductionShellOptions): DesktopProductionShellPlan {
  assertFilePathInput('projectRoot', options.projectRoot);
  const projectRoot = resolve(options.projectRoot);
  const rendererEntry = join(projectRoot, 'dist-ui', 'index.html');
  const runtimeControlUrl = normalizeLoopbackControlUrl(options.runtimeControlUrl);
  const mainSourcePath = resolve(options.desktopMainSourcePath ?? join(projectRoot, 'src', 'desktop', 'main.ts'));
  const mainCompiledPath = resolve(options.desktopMainCompiledPath ?? join(projectRoot, 'dist-desktop', 'src', 'desktop', 'main.js'));
  const preloadSourcePath = resolve(options.preloadSourcePath ?? join(projectRoot, 'src', 'desktop', 'preload.cjs'));
  const preloadCompiledPath = resolve(options.preloadCompiledPath ?? join(projectRoot, 'dist-desktop', 'src', 'desktop', 'preload.cjs'));
  const fullElectronEntrypointImplemented = options.electronEntrypointImplemented
    ?? (existsSync(mainSourcePath) && existsSync(preloadSourcePath));

  assertPathInsideProject(projectRoot, rendererEntry);
  assertPathInsideProject(projectRoot, mainSourcePath);
  assertPathInsideProject(projectRoot, mainCompiledPath);
  assertPathInsideProject(projectRoot, preloadSourcePath);
  assertPathInsideProject(projectRoot, preloadCompiledPath);
  if (options.requireExistingRenderer === true && !existsSync(rendererEntry)) {
    throw new Error(`Desktop production renderer build entry is missing: ${rendererEntry}`);
  }

  const sidecars = defaultSidecars();
  const plan: DesktopProductionShellPlan = {
    schemaVersion: DESKTOP_PRODUCTION_SHELL_SCHEMA,
    implementationStatus: fullElectronEntrypointImplemented
      ? 'electron-entrypoint-present'
      : 'pure-ts-planner-no-electron-dependency',
    fullElectronEntrypointImplemented,
    projectRoot,
    renderer: {
      source: 'dist-ui-index-html',
      loadStrategy: {
        kind: 'electron-load-file',
        filePath: rendererEntry,
        fileUrl: pathToFileURL(rendererEntry).href,
      },
      devServerUrlAllowed: false,
      requireBuildArtifact: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    preload: {
      apiName: 'sciforgeDesktop',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
	      exposedMethods: [
	        'getRuntimeConfig',
	        'getRuntimeHealth',
        'getRuntimeReady',
        'requestShutdown',
        'openExternal',
        'openNativeBrowser',
        'nativeBrowserBack',
        'nativeBrowserForward',
        'nativeBrowserReload',
        'getNativeBrowserState',
        'captureNativeBrowserScreenshot',
        'attachBrowserHostSessionSurface',
        'detachBrowserHostSessionSurface',
        'resizeBrowserHostSessionSurface',
        'getBrowserHostSessionSurfaceState',
        'startAnnotation',
        'startDesktopAnnotation',
        'getAnnotationState',
        'cancelAnnotation',
        'revealPath',
        'pickDirectory',
      ],
	      ipcChannels: [
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
        'desktop:browser-host-surface:resize',
        'desktop:browser-host-surface:state',
        'desktop:annotation-overlay:start',
        'desktop:annotation-overlay:status',
        'desktop:annotation-overlay:cancel',
        'platform:open-external',
        'platform:reveal-path',
        'platform:pick-directory',
      ],
      forbiddenRendererCapabilities: [
        'spawn child processes',
        'start or own Runtime Codex sidecars',
        'start Vite dev servers',
        'read arbitrary filesystem paths through Node globals',
        'route providers or execute agent policy',
      ],
    },
    runtime: {
      transport: 'controlled-loopback',
      controlUrl: runtimeControlUrl,
      portPolicy: {
        allocation: 'dynamic-loopback-port-assigned-by-launcher',
        fixedDevPortsAllowed: false,
        viteDevServerPortsForbidden: true,
        forbiddenFixedDevPorts: [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180],
        rendererReceivesOnlyControlUrl: true,
      },
      sidecars,
    },
    appData: {
      source: 'electron-app-getPath-userData',
      requiredForPackaging: true,
      resolveBeforeLauncherStart: true,
      rendererMayResolveOrWrite: false,
      logsDirectoryRelativePath: 'logs',
      sidecarLogsDirectoryRelativePath: 'logs/sidecars',
      auditLogFileRelativePath: 'logs/desktop-runtime-audit.ndjson',
    },
    main: {
      ownsBrowserWindow: true,
      entrypoint: {
        sourcePath: mainSourcePath,
        compiledPath: mainCompiledPath,
      },
      preloadScript: {
        sourcePath: preloadSourcePath,
        compiledPath: preloadCompiledPath,
      },
      runtimeLauncherOwnership: {
        owner: 'electron-main-runtime-launcher',
        startBeforeRendererReady: true,
        injectRuntimeControlUrlIntoPreload: true,
        rendererMayStartSidecars: false,
      },
      forbiddenResponsibilities: [
        'load a remote renderer URL',
        'start a Vite dev server',
        'perform agent reasoning',
        'implement provider routing policy',
        'let renderer own sidecar lifecycle',
      ],
    },
    shutdown: {
      owner: 'electron-main-runtime-launcher',
      trigger: 'electron-before-quit-or-window-all-closed',
      sequence: [
        'stop-renderer-ipc',
        'runtime-launcher.shutdown',
        'wait-for-launcher-sidecars',
        'close-control-transport',
        'destroy-browser-window',
      ],
      closesLauncher: true,
    },
    packageBoundary: {
      startsViteDevServer: false,
      fixedDevPortsAreProductionContract: false,
      rendererEntryRelativePath: 'dist-ui/index.html',
      rendererBuildArtifactRequired: true,
      electronDependencyRequiredForPackaging: true,
      externalElectronDependencyRequired: false,
    },
  };

  assertProductionDesktopShellPlan(plan);
  return plan;
}

export function createDesktopPackagingPreflightContract(
  options: DesktopPackagingPreflightOptions,
): DesktopPackagingPreflightContract {
  const { plan } = options;
  assertProductionDesktopShellPlan(plan);

  const electronDependencyNames = findElectronRuntimeDependencyNames(options.packageManifest);
  const rendererArtifactExists = options.rendererArtifactExists ?? existsSync(plan.renderer.loadStrategy.filePath);
  const appDataPath = normalizeOptionalAbsolutePath('Electron userData path', options.resolvedAppDataPath);
  const logPath = normalizeOptionalAbsolutePath('desktop logs path', options.resolvedLogPath);
  const roles = plan.runtime.sidecars.map((sidecar) => sidecar.role);
  const requiredRoles = ['workspace-server', 'model-router', 'runtime-codex'] satisfies DesktopSidecarRole[];
  const missingRoles = requiredRoles.filter((role) => !roles.includes(role));
  const viteUrlMatches = collectViteDevServerUrls(plan);

  const fullElectronEntrypointImplemented = {
    required: true as const,
    actual: plan.fullElectronEntrypointImplemented,
    status: statusFor(plan.fullElectronEntrypointImplemented),
    message: plan.fullElectronEntrypointImplemented
      ? 'Full Electron entrypoint is implemented.'
      : 'fullElectronEntrypointImplemented=false; pure TS planner cannot claim production package pass.',
  };
  const electronDependency = {
    required: true as const,
    present: electronDependencyNames.length > 0,
    dependencyNames: electronDependencyNames,
    searchedSections: ['dependencies', 'devDependencies', 'optionalDependencies'] as Array<keyof DesktopPackageManifestLike>,
    status: statusFor(electronDependencyNames.length > 0),
    message: electronDependencyNames.length > 0
      ? 'Electron runtime dependency is present in the package manifest.'
      : 'No electron runtime dependency was found in dependencies, devDependencies, or optionalDependencies.',
  };
  const rendererBuildArtifact = {
    required: true as const,
    relativePath: 'dist-ui/index.html' as const,
    filePath: plan.renderer.loadStrategy.filePath,
    exists: rendererArtifactExists,
    status: statusFor(rendererArtifactExists),
    message: rendererArtifactExists
      ? 'Renderer build artifact exists.'
      : 'Production package requires dist-ui/index.html before it can pass preflight.',
  };
  const appDataPathCheck = {
    required: true as const,
    source: plan.appData.source,
    mustBeAbsolute: true as const,
    resolvedPath: appDataPath.path,
    status: statusFor(appDataPath.ok),
    message: appDataPath.message,
  };
  const logPathInsideAppData = Boolean(
    appDataPath.path && logPath.path && isPathInsideOrEqual(appDataPath.path, logPath.path),
  );
  const logPathCheck = {
    required: true as const,
    relativeTo: 'appDataPath' as const,
    relativePath: plan.appData.logsDirectoryRelativePath,
    resolvedPath: logPath.path,
    sidecarLogDirectory: logPath.path ? join(logPath.path, 'sidecars') : undefined,
    auditLogFile: logPath.path ? join(logPath.path, 'desktop-runtime-audit.ndjson') : undefined,
    status: statusFor(logPath.ok && logPathInsideAppData),
    message: logPath.ok && logPathInsideAppData
      ? 'Desktop logs path resolves under Electron userData.'
      : logPath.ok
        ? 'Desktop logs path must resolve under Electron userData.'
        : logPath.message,
  };
  const sidecarRoles = {
    required: true as const,
    roles,
    status: statusFor(missingRoles.length === 0),
    message: missingRoles.length === 0
      ? 'Required sidecar roles are present.'
      : `Missing desktop sidecar role(s): ${missingRoles.join(', ')}`,
  };
  const portPolicy = {
    required: true as const,
    fixedDevPortsAllowed: false as const,
    viteDevServerUrlsAllowed: false as const,
    forbiddenFixedDevPorts: plan.runtime.portPolicy.forbiddenFixedDevPorts,
    status: statusFor(
      plan.runtime.portPolicy.fixedDevPortsAllowed === false &&
        plan.runtime.portPolicy.viteDevServerPortsForbidden === true &&
        plan.packageBoundary.fixedDevPortsAreProductionContract === false &&
        plan.packageBoundary.startsViteDevServer === false &&
        viteUrlMatches.length === 0,
    ),
    message: viteUrlMatches.length === 0
      ? 'Production desktop package uses dynamic loopback ports and contains no Vite dev-server URLs.'
      : `Production desktop package contains Vite dev-server URL(s): ${viteUrlMatches.map((match) => match.value).join(', ')}`,
  };

  const checks: DesktopPackagingPreflightContract['checks'] = {
    fullElectronEntrypointImplemented,
    electronDependency,
    rendererBuildArtifact,
    appDataPath: appDataPathCheck,
    logPath: logPathCheck,
    sidecarRoles,
    portPolicy,
  };
  const blockReasons = Object.values(checks)
    .filter((check) => check.status !== 'pass')
    .map((check) => check.message);
  const preflightChecksPass = blockReasons.length === 0;

  return {
    schemaVersion: DESKTOP_PACKAGING_PREFLIGHT_SCHEMA,
    planSchemaVersion: plan.schemaVersion,
    verdict: preflightChecksPass ? 'inspectable' : 'blocked',
    preflightChecksPass,
    canClaimPass: false,
    canClaimRDeskOrRPkgPass: false,
    blockReasons,
    passClaimBlockReasons: [DESKTOP_PASS_CLAIM_BLOCK_REASON],
    passClaimBoundary: {
      kind: 'packaging-preflight-only',
      requiredLiveEvidence: DESKTOP_PASS_CLAIM_LIVE_EVIDENCE_REQUIREMENTS,
      message: DESKTOP_PASS_CLAIM_BLOCK_REASON,
    },
    checks,
  };
}

export function assertDesktopPackagingPreflightCanClaimPass(preflight: DesktopPackagingPreflightContract): void {
  const entrypointReason = preflight.checks.fullElectronEntrypointImplemented.actual === false
    ? ' fullElectronEntrypointImplemented=false;'
    : '';
  const preflightReason = preflight.blockReasons.length > 0
    ? ` preflight blocked by: ${preflight.blockReasons.join('; ')};`
    : '';
  throw new Error(
    `Desktop packaging preflight cannot claim R-DESK/R-PKG pass;${entrypointReason}${preflightReason} ${preflight.passClaimBlockReasons.join('; ')}`,
  );
}

export function assertProductionDesktopShellPlan(plan: DesktopProductionShellPlan): void {
  if (plan.schemaVersion !== DESKTOP_PRODUCTION_SHELL_SCHEMA) {
    throw new Error(`Unsupported desktop shell schema: ${plan.schemaVersion}`);
  }
  const expectedRendererEntry = join(plan.projectRoot, 'dist-ui', 'index.html');
  if (plan.renderer.loadStrategy.kind !== 'electron-load-file') {
    throw new Error('Desktop renderer must use Electron loadFile semantics.');
  }
  if (plan.renderer.loadStrategy.filePath !== expectedRendererEntry) {
    throw new Error(`Desktop renderer must load only dist-ui/index.html, got: ${plan.renderer.loadStrategy.filePath}`);
  }
  if (basename(plan.renderer.loadStrategy.filePath) !== 'index.html') {
    throw new Error('Desktop renderer entry must be index.html.');
  }
  if (plan.renderer.source !== 'dist-ui-index-html' || plan.renderer.devServerUrlAllowed !== false) {
    throw new Error('Desktop renderer contract must be the built dist-ui artifact, not a dev server.');
  }
  if (
    plan.renderer.nodeIntegration !== false ||
    plan.renderer.contextIsolation !== true ||
    plan.renderer.sandbox !== true ||
    plan.preload.nodeIntegration !== false ||
    plan.preload.contextIsolation !== true ||
    plan.preload.sandbox !== true
  ) {
    throw new Error('Desktop preload contract must isolate renderer from Node and sidecar ownership.');
  }
  if (
    plan.main.runtimeLauncherOwnership.owner !== 'electron-main-runtime-launcher' ||
    plan.main.runtimeLauncherOwnership.rendererMayStartSidecars !== false
  ) {
    throw new Error('Desktop sidecar lifecycle must be owned by Electron main and the runtime launcher.');
  }
  assertPathInsideProject(plan.projectRoot, plan.main.entrypoint.sourcePath);
  assertPathInsideProject(plan.projectRoot, plan.main.entrypoint.compiledPath);
  assertPathInsideProject(plan.projectRoot, plan.main.preloadScript.sourcePath);
  assertPathInsideProject(plan.projectRoot, plan.main.preloadScript.compiledPath);
  if (plan.fullElectronEntrypointImplemented && plan.implementationStatus !== 'electron-entrypoint-present') {
    throw new Error('Desktop Electron entrypoint status must be explicit when the main/preload files exist.');
  }
  assertRequiredSidecars(plan.runtime.sidecars);
  if (!plan.shutdown.sequence.includes('runtime-launcher.shutdown') || plan.shutdown.closesLauncher !== true) {
    throw new Error('Desktop shutdown must close the runtime launcher.');
  }
  if (plan.packageBoundary.startsViteDevServer || plan.packageBoundary.fixedDevPortsAreProductionContract) {
    throw new Error('Desktop package boundary must not start Vite or make fixed dev ports production contracts.');
  }
  if (
    plan.renderer.requireBuildArtifact !== true ||
    plan.packageBoundary.rendererBuildArtifactRequired !== true ||
    plan.packageBoundary.electronDependencyRequiredForPackaging !== true
  ) {
    throw new Error('Desktop package preflight must require both dist-ui/index.html and an Electron runtime dependency.');
  }
  if (
    plan.runtime.portPolicy.fixedDevPortsAllowed !== false ||
    plan.runtime.portPolicy.viteDevServerPortsForbidden !== true ||
    plan.runtime.portPolicy.rendererReceivesOnlyControlUrl !== true
  ) {
    throw new Error('Desktop runtime ports must be dynamic loopback ports owned by the launcher.');
  }
  if (
    plan.appData.source !== 'electron-app-getPath-userData' ||
    plan.appData.requiredForPackaging !== true ||
    plan.appData.logsDirectoryRelativePath !== 'logs' ||
    plan.appData.rendererMayResolveOrWrite !== false
  ) {
    throw new Error('Desktop app data and logs must be resolved by Electron main before launcher start.');
  }
  assertNoViteDevServerUrls(plan);
}

export function assertNoViteDevServerUrls(value: unknown): void {
  const matches = collectViteDevServerUrls(value);
  if (matches.length > 0) {
    const rendered = matches.map((match) => `${match.path}=${match.value}`).join(', ');
    throw new Error(`Production desktop contract contains Vite dev server URL(s): ${rendered}`);
  }
}

export function collectViteDevServerUrls(value: unknown, path = '$'): Array<{ path: string; value: string }> {
  const matches: Array<{ path: string; value: string }> = [];
  visitForDevServerUrls(value, path, matches);
  return matches;
}

function defaultSidecars(): DesktopSidecarPlan[] {
  return ['workspace-server', 'model-router', 'runtime-codex'].map((role) => ({
    role: role as DesktopSidecarRole,
    owner: 'electron-main-runtime-launcher',
    lifecycle: 'managed-by-launcher',
    startTrigger: 'main-before-renderer-ready',
    shutdownTrigger: 'launcher-shutdown',
    rendererMayStart: false,
  }));
}

function assertRequiredSidecars(sidecars: DesktopSidecarPlan[]): void {
  const roles = new Set(sidecars.map((sidecar) => sidecar.role));
  for (const role of ['workspace-server', 'model-router', 'runtime-codex'] satisfies DesktopSidecarRole[]) {
    if (!roles.has(role)) throw new Error(`Desktop runtime sidecar is missing from the launcher contract: ${role}`);
  }
  for (const sidecar of sidecars) {
    if (
      sidecar.owner !== 'electron-main-runtime-launcher' ||
      sidecar.lifecycle !== 'managed-by-launcher' ||
      sidecar.rendererMayStart !== false ||
      sidecar.shutdownTrigger !== 'launcher-shutdown'
    ) {
      throw new Error(`Desktop sidecar ${sidecar.role} is not owned by the Electron main runtime launcher.`);
    }
  }
}

function findElectronRuntimeDependencyNames(manifest: DesktopPackageManifestLike | undefined): string[] {
  if (!manifest) return [];
  const names: string[] = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] satisfies Array<keyof DesktopPackageManifestLike>) {
    for (const dependencyName of Object.keys(manifest[section] ?? {})) {
      if (dependencyName === 'electron') names.push(`${section}:${dependencyName}`);
    }
  }
  return names;
}

function normalizeOptionalAbsolutePath(label: string, value: string | undefined): {
  ok: boolean;
  path?: string;
  message: string;
} {
  if (!value) {
    return { ok: false, message: `${label} must be resolved before desktop packaging preflight can pass.` };
  }
  try {
    assertFilePathInput(label, value);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!isAbsolute(value)) {
    return { ok: false, message: `${label} must be an absolute filesystem path, got: ${value}` };
  }
  return { ok: true, path: resolve(value), message: `${label} resolved.` };
}

function statusFor(value: boolean): DesktopPackagingPreflightCheckStatus {
  return value ? 'pass' : 'fail';
}

function normalizeLoopbackControlUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Desktop runtime control URL must use loopback HTTP(S), got: ${value}`);
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(`Desktop runtime control URL must stay on loopback, got: ${value}`);
  }
  if (!parsed.port) {
    throw new Error(`Desktop runtime control URL must include an explicit dynamic loopback port, got: ${value}`);
  }
  if (looksLikeViteDevServerUrl(value)) {
    throw new Error(`Desktop runtime control URL must not use a Vite dev server URL: ${value}`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function visitForDevServerUrls(
  value: unknown,
  path: string,
  matches: Array<{ path: string; value: string }>,
): void {
  if (typeof value === 'string') {
    if (looksLikeViteDevServerUrl(value)) matches.push({ path, value });
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitForDevServerUrls(item, `${path}[${index}]`, matches));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    visitForDevServerUrls(nested, `${path}.${key}`, matches);
  }
}

function looksLikeViteDevServerUrl(value: string): boolean {
  const candidates = value.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  return candidates.some((candidate) => {
    try {
      const parsed = new URL(candidate);
      return isLoopbackHost(parsed.hostname) && isViteDevPort(parsed.port);
    } catch {
      return false;
    }
  });
}

function isViteDevPort(port: string): boolean {
  return /^(517[3-9]|5180)$/.test(port);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function assertFilePathInput(label: string, value: string): void {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^file:/i.test(value)) {
    throw new Error(`${label} must be a filesystem path, got URL-like value: ${value}`);
  }
}

function assertPathInsideProject(projectRoot: string, targetPath: string): void {
  const relativePath = relative(projectRoot, targetPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Desktop renderer entry must stay under the project root, got: ${targetPath}`);
  }
}

function isPathInsideOrEqual(parentPath: string, targetPath: string): boolean {
  const relativePath = relative(parentPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}
