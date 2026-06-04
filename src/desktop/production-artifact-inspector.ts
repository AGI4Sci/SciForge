import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import {
  DESKTOP_PASS_CLAIM_BLOCK_REASON,
  DESKTOP_PASS_CLAIM_LIVE_EVIDENCE_REQUIREMENTS,
  type DesktopPassClaimLiveEvidenceRequirement,
  collectViteDevServerUrls,
} from './production-shell-planner.js';
export { resolveDesktopProductionArtifactPath } from './desktop-artifact-paths.js';

export const DESKTOP_PRODUCTION_ARTIFACT_INSPECTION_SCHEMA =
  'sciforge.desktop.production-artifact-inspection.v1';

export type DesktopProductionArtifactKind = 'mac-app-directory' | 'asar-archive';
export type DesktopProductionArtifactInspectionCheckStatus = 'pass' | 'fail';

export type DesktopProductionArtifactInspectionCheck = {
  required: boolean;
  status: DesktopProductionArtifactInspectionCheckStatus;
  message: string;
  path?: string;
  sizeBytes?: number;
  sha256?: string;
};

export type DesktopProductionArtifactInspectionSummary = {
  schemaVersion: typeof DESKTOP_PRODUCTION_ARTIFACT_INSPECTION_SCHEMA;
  artifactPath: string;
  inspectable: true;
  credentialsRequired: false;
  mainProcessInspected: true;
  preloadInspected: true;
  rendererArtifactInspected: true;
  viteDevServerUrlFound: false;
  canClaimRDeskOrRPkgPass: false;
};

export type DesktopProductionArtifactInspection = {
  schemaVersion: typeof DESKTOP_PRODUCTION_ARTIFACT_INSPECTION_SCHEMA;
  artifactPath: string;
  artifactKind: DesktopProductionArtifactKind;
  verdict: 'inspectable' | 'blocked';
  inspectable: boolean;
  canClaimRDeskOrRPkgPass: false;
  passClaimBoundary: {
    kind: 'production-artifact-inspection-only';
    requiredLiveEvidence: readonly DesktopPassClaimLiveEvidenceRequirement[];
    message: typeof DESKTOP_PASS_CLAIM_BLOCK_REASON;
  };
  checks: {
    artifactRoot: DesktopProductionArtifactInspectionCheck;
    electronBundleLayout: DesktopProductionArtifactInspectionCheck;
    asarArchive: DesktopProductionArtifactInspectionCheck;
    packageMain: DesktopProductionArtifactInspectionCheck;
    mainProcess: DesktopProductionArtifactInspectionCheck;
    preload: DesktopProductionArtifactInspectionCheck;
    renderer: DesktopProductionArtifactInspectionCheck;
    noDevServerUrls: DesktopProductionArtifactInspectionCheck;
    noTestArtifacts: DesktopProductionArtifactInspectionCheck;
  };
  evidence: {
    asarPath?: string;
    executablePath?: string;
    infoPlistPath?: string;
    bundleIdentifier?: string;
    productName?: string;
    packageMain?: string;
    extractedFiles: Array<{
      path: string;
      sizeBytes: number;
      sha256: string;
    }>;
  };
  blockReasons: string[];
  liveAcceptanceSummary?: DesktopProductionArtifactInspectionSummary;
};

export type DesktopProductionArtifactInspectionOptions = {
  artifactPath: string;
  expectedBundleIdentifier?: string;
  expectedProductName?: string;
  expectedPackageMain?: string;
  expectedMainPath?: string;
  expectedPreloadPath?: string;
  expectedRendererPath?: string;
};

type AsarModule = typeof import('@electron/asar');

type ArtifactLayout = {
  artifactPath: string;
  artifactKind: DesktopProductionArtifactKind;
  asarPath?: string;
  executablePath?: string;
  infoPlistPath?: string;
  bundleIdentifier?: string;
  productName?: string;
};

const DEFAULT_BUNDLE_IDENTIFIER = 'ai.sciforge.desktop';
const DEFAULT_PRODUCT_NAME = 'SciForge';
const DEFAULT_PACKAGE_MAIN = 'dist-desktop/src/desktop/main.js';
const DEFAULT_PRELOAD_PATH = 'dist-desktop/src/desktop/preload.cjs';
const DEFAULT_RENDERER_PATH = 'dist-ui/index.html';
const DEFAULT_SIDECAR_PATHS = [
  'dist-desktop/src/runtime/workspace-server.js',
  'dist-desktop/packages/backend/src/cli.js',
  'dist-desktop/src/runtime/codex/codex-runtime-standalone-server.js',
] as const;

export async function inspectDesktopProductionArtifact(
  options: DesktopProductionArtifactInspectionOptions,
): Promise<DesktopProductionArtifactInspection> {
  assertFilePathInput('desktop production artifact path', options.artifactPath);
  const artifactPath = resolve(options.artifactPath);
  const expectedBundleIdentifier = options.expectedBundleIdentifier ?? DEFAULT_BUNDLE_IDENTIFIER;
  const expectedProductName = options.expectedProductName ?? DEFAULT_PRODUCT_NAME;
  const expectedPackageMain = options.expectedPackageMain ?? DEFAULT_PACKAGE_MAIN;
  const expectedMainPath = options.expectedMainPath ?? expectedPackageMain;
  const expectedPreloadPath = options.expectedPreloadPath ?? DEFAULT_PRELOAD_PATH;
  const expectedRendererPath = options.expectedRendererPath ?? DEFAULT_RENDERER_PATH;
  const checks = createInitialChecks(artifactPath);
  const evidence: DesktopProductionArtifactInspection['evidence'] = { extractedFiles: [] };

  const layout = inspectArtifactLayout({
    artifactPath,
    expectedBundleIdentifier,
    expectedProductName,
  });
  checks.artifactRoot = layout.artifactRoot;
  checks.electronBundleLayout = layout.electronBundleLayout;
  evidence.asarPath = layout.layout.asarPath;
  evidence.executablePath = layout.layout.executablePath;
  evidence.infoPlistPath = layout.layout.infoPlistPath;
  evidence.bundleIdentifier = layout.layout.bundleIdentifier;
  evidence.productName = layout.layout.productName;

  if (!layout.layout.asarPath || !existsSync(layout.layout.asarPath)) {
    checks.asarArchive = failCheck('Packaged artifact must contain an app.asar archive.', layout.layout.asarPath);
    return finalizeArtifactInspection({
      artifactPath,
      artifactKind: layout.layout.artifactKind,
      checks,
      evidence,
    });
  }

  const asarStat = statSync(layout.layout.asarPath);
  checks.asarArchive = passCheck(
    'app.asar archive exists and can be read without launching Runtime Codex.',
    layout.layout.asarPath,
    asarStat.size,
    sha256File(layout.layout.asarPath),
  );

  let asar: AsarModule;
  try {
    asar = await import('@electron/asar');
  } catch (error) {
    checks.asarArchive = failCheck(
      `@electron/asar is required for package inspection: ${error instanceof Error ? error.message : String(error)}`,
      layout.layout.asarPath,
    );
    return finalizeArtifactInspection({
      artifactPath,
      artifactKind: layout.layout.artifactKind,
      checks,
      evidence,
    });
  }

  const files = new Set(asar.listPackage(layout.layout.asarPath, { isPack: false }).map(normalizeAsarPath));
  const forbiddenTestArtifacts = [...files].filter(isPackagedTestArtifact).sort();
  checks.noTestArtifacts = forbiddenTestArtifacts.length === 0
    ? passCheck('Packaged production artifacts exclude compiled test files.')
    : failCheck(`Packaged production artifacts must not include compiled test files: ${forbiddenTestArtifacts.slice(0, 12).join(', ')}`);
  const requiredFiles = [expectedPackageMain, expectedMainPath, expectedPreloadPath, expectedRendererPath, ...DEFAULT_SIDECAR_PATHS, 'package.json'];
  const missingFiles = [...new Set(requiredFiles)].filter((filePath) => !files.has(filePath));
  if (missingFiles.length > 0) {
    checks.asarArchive = failCheck(
      `app.asar is missing production artifact file(s): ${missingFiles.join(', ')}`,
      layout.layout.asarPath,
      asarStat.size,
      sha256File(layout.layout.asarPath),
    );
    return finalizeArtifactInspection({
      artifactPath,
      artifactKind: layout.layout.artifactKind,
      checks,
      evidence,
    });
  }

  const asarPath = layout.layout.asarPath;
  const packageText = extractAsarText(asar, asarPath, 'package.json');
  const mainText = extractAsarText(asar, asarPath, expectedMainPath);
  const preloadText = extractAsarText(asar, asarPath, expectedPreloadPath);
  const rendererText = extractAsarText(asar, asarPath, expectedRendererPath);
  const sidecarTexts = DEFAULT_SIDECAR_PATHS.map((filePath) => ({
    filePath,
    text: extractAsarText(asar, asarPath, filePath),
  }));
  evidence.extractedFiles = [
    fileEvidence('package.json', packageText),
    fileEvidence(expectedMainPath, mainText),
    fileEvidence(expectedPreloadPath, preloadText),
    ...sidecarTexts.map(({ filePath, text }) => fileEvidence(filePath, text)),
    fileEvidence(expectedRendererPath, rendererText),
  ];

  const packageMain = parsePackageMain(packageText);
  evidence.packageMain = packageMain;
  checks.packageMain = packageMain === expectedPackageMain
    ? passCheck(`Packaged package.json points Electron at ${expectedPackageMain}.`)
    : failCheck(`Packaged package.json main must be ${expectedPackageMain}, got: ${String(packageMain)}`);

  const mainDevUrls = collectViteDevServerUrls(mainText);
  const preloadDevUrls = collectViteDevServerUrls(preloadText);
  const rendererDevUrls = collectViteDevServerUrls(rendererText);
  checks.mainProcess = mainLooksProduction(mainText) && sidecarsLookBundled(sidecarTexts)
    ? passCheck('Electron main artifact owns BrowserWindow, loads dist-ui with loadFile, uses dynamic launcher ports, exposes runtime config, and launches bundled JS sidecars.')
    : failCheck('Electron main artifact must load dist-ui with loadFile, own BrowserWindow, request dynamic launcher ports, expose runtime config, and launch bundled JS sidecars without tsx/source TS or unresolved workspace imports.');
  checks.preload = preloadLooksIsolated(preloadText)
    ? passCheck('Preload artifact exposes only the sciforgeDesktop IPC bridge including runtime config and no Node sidecar ownership.')
    : failCheck('Preload artifact must expose the narrow sciforgeDesktop IPC bridge including runtime config without Node sidecar ownership.');
  checks.renderer = rendererLooksBuilt(rendererText)
    ? passCheck('Renderer artifact is a built dist-ui index.html, not a Vite source entry.')
    : failCheck('Renderer artifact must be built dist-ui/index.html with bundled assets, not Vite source paths.');

  const devUrlMessages = [...mainDevUrls, ...preloadDevUrls, ...rendererDevUrls].map((match) => `${match.path}=${match.value}`);
  checks.noDevServerUrls = devUrlMessages.length === 0
    ? passCheck('Packaged production artifacts contain no loopback Vite dev-server URLs.')
    : failCheck(`Packaged production artifacts contain Vite dev-server URL(s): ${devUrlMessages.join(', ')}`);

  return finalizeArtifactInspection({
    artifactPath,
    artifactKind: layout.layout.artifactKind,
    checks,
    evidence,
  });
}

export function assertDesktopProductionArtifactInspectable(inspection: DesktopProductionArtifactInspection): void {
  if (inspection.inspectable) return;
  throw new Error(`Desktop production artifact is not inspectable: ${inspection.blockReasons.join('; ')}`);
}

export function assertDesktopProductionArtifactCannotClaimRDeskOrRPkgPass(
  inspection: DesktopProductionArtifactInspection,
): void {
  if (inspection.canClaimRDeskOrRPkgPass === false) return;
  throw new Error(DESKTOP_PASS_CLAIM_BLOCK_REASON);
}

function createInitialChecks(artifactPath: string): DesktopProductionArtifactInspection['checks'] {
  const pending = failCheck('Production artifact inspection did not reach this check yet.');
  return {
    artifactRoot: failCheck('Desktop production artifact path does not exist.', artifactPath),
    electronBundleLayout: pending,
    asarArchive: pending,
    packageMain: pending,
    mainProcess: pending,
    preload: pending,
    renderer: pending,
    noDevServerUrls: pending,
    noTestArtifacts: pending,
  };
}

function inspectArtifactLayout(input: {
  artifactPath: string;
  expectedBundleIdentifier: string;
  expectedProductName: string;
}): {
  layout: ArtifactLayout;
  artifactRoot: DesktopProductionArtifactInspectionCheck;
  electronBundleLayout: DesktopProductionArtifactInspectionCheck;
} {
  const { artifactPath, expectedBundleIdentifier, expectedProductName } = input;
  if (!existsSync(artifactPath)) {
    return {
      layout: { artifactPath, artifactKind: artifactKindForPath(artifactPath) },
      artifactRoot: failCheck('Desktop production artifact path does not exist.', artifactPath),
      electronBundleLayout: failCheck('Missing artifact cannot expose an Electron bundle layout.', artifactPath),
    };
  }

  const artifactStat = statSync(artifactPath);
  const artifactRoot = passCheck(
    'Desktop production artifact path exists.',
    artifactPath,
    artifactStat.size,
    artifactStat.isFile() ? sha256File(artifactPath) : undefined,
  );

  if (artifactStat.isFile() && extname(artifactPath) === '.asar') {
    return {
      layout: {
        artifactPath,
        artifactKind: 'asar-archive',
        asarPath: artifactPath,
      },
      artifactRoot,
      electronBundleLayout: passCheck('Direct app.asar inspection requested; native Electron wrapper is outside this artifact.', artifactPath),
    };
  }

  if (!artifactStat.isDirectory() || extname(artifactPath) !== '.app') {
    return {
      layout: { artifactPath, artifactKind: artifactKindForPath(artifactPath) },
      artifactRoot,
      electronBundleLayout: failCheck('Packaged desktop artifact must be a macOS .app directory or app.asar archive.', artifactPath),
    };
  }

  const infoPlistPath = join(artifactPath, 'Contents', 'Info.plist');
  const asarPath = join(artifactPath, 'Contents', 'Resources', 'app.asar');
  const infoPlistText = existsSync(infoPlistPath) ? readFileSync(infoPlistPath, 'utf8') : '';
  const executableName = readPlistString(infoPlistText, 'CFBundleExecutable') ?? basename(artifactPath, '.app');
  const executablePath = join(artifactPath, 'Contents', 'MacOS', executableName);
  const bundleIdentifier = readPlistString(infoPlistText, 'CFBundleIdentifier');
  const productName = readPlistString(infoPlistText, 'CFBundleName')
    ?? readPlistString(infoPlistText, 'CFBundleDisplayName');
  const layoutChecks = [
    existsSync(infoPlistPath),
    existsSync(asarPath),
    existsSync(executablePath),
    bundleIdentifier === expectedBundleIdentifier,
    productName === expectedProductName,
  ];

  return {
    layout: {
      artifactPath,
      artifactKind: 'mac-app-directory',
      asarPath,
      executablePath,
      infoPlistPath,
      bundleIdentifier,
      productName,
    },
    artifactRoot,
    electronBundleLayout: layoutChecks.every(Boolean)
      ? passCheck('macOS .app layout exposes Info.plist, executable, app.asar, bundle id, and product name.', artifactPath)
      : failCheck('macOS .app layout must expose Info.plist, executable, app.asar, expected bundle id, and product name.', artifactPath),
  };
}

function finalizeArtifactInspection(input: {
  artifactPath: string;
  artifactKind: DesktopProductionArtifactKind;
  checks: DesktopProductionArtifactInspection['checks'];
  evidence: DesktopProductionArtifactInspection['evidence'];
}): DesktopProductionArtifactInspection {
  const blockReasons = Object.values(input.checks)
    .filter((check) => check.required && check.status === 'fail')
    .map((check) => check.message);
  const inspectable = blockReasons.length === 0;
  const liveAcceptanceSummary: DesktopProductionArtifactInspectionSummary | undefined = inspectable
    ? {
      schemaVersion: DESKTOP_PRODUCTION_ARTIFACT_INSPECTION_SCHEMA,
      artifactPath: input.artifactPath,
      inspectable: true,
      credentialsRequired: false,
      mainProcessInspected: true,
      preloadInspected: true,
      rendererArtifactInspected: true,
      viteDevServerUrlFound: false,
      canClaimRDeskOrRPkgPass: false,
    }
    : undefined;

  return {
    schemaVersion: DESKTOP_PRODUCTION_ARTIFACT_INSPECTION_SCHEMA,
    artifactPath: input.artifactPath,
    artifactKind: input.artifactKind,
    verdict: inspectable ? 'inspectable' : 'blocked',
    inspectable,
    canClaimRDeskOrRPkgPass: false,
    passClaimBoundary: {
      kind: 'production-artifact-inspection-only',
      requiredLiveEvidence: DESKTOP_PASS_CLAIM_LIVE_EVIDENCE_REQUIREMENTS,
      message: DESKTOP_PASS_CLAIM_BLOCK_REASON,
    },
    checks: input.checks,
    evidence: input.evidence,
    blockReasons,
    liveAcceptanceSummary,
  };
}

function passCheck(
  message: string,
  path?: string,
  sizeBytes?: number,
  sha256?: string,
): DesktopProductionArtifactInspectionCheck {
  return {
    required: true,
    status: 'pass',
    message,
    path,
    sizeBytes,
    sha256,
  };
}

function failCheck(
  message: string,
  path?: string,
  sizeBytes?: number,
  sha256?: string,
): DesktopProductionArtifactInspectionCheck {
  return {
    required: true,
    status: 'fail',
    message,
    path,
    sizeBytes,
    sha256,
  };
}

function artifactKindForPath(artifactPath: string): DesktopProductionArtifactKind {
  return extname(artifactPath) === '.asar' ? 'asar-archive' : 'mac-app-directory';
}

function normalizeAsarPath(value: string): string {
  return value.replace(/^pack\s+:\s+/, '').replace(/^\/+/, '');
}

function isPackagedTestArtifact(filePath: string): boolean {
  return filePath.startsWith('dist-desktop/') &&
    /(?:^|\/)[^/]+\.(?:test|spec)\.js(?:\.map)?$/.test(filePath);
}

function extractAsarText(asar: AsarModule, archivePath: string, filePath: string): string {
  return asar.extractFile(archivePath, filePath).toString('utf8');
}

function parsePackageMain(packageText: string): string | undefined {
  try {
    const parsed = JSON.parse(packageText) as { main?: unknown };
    return typeof parsed.main === 'string' ? parsed.main : undefined;
  } catch {
    return undefined;
  }
}

function mainLooksProduction(value: string): boolean {
  const forbidden = [
    '--import',
    'tsx',
    'src/runtime/workspace-server.ts',
    'packages/backend/src/cli.ts',
    'codex-runtime-standalone-server.ts',
  ];
  const loadUrlOnlyForNativeBrowser = !value.includes('loadURL') || value.includes('desktop:native-browser:open');
  return value.includes('BrowserWindow') &&
    value.includes('loadFile') &&
    value.includes('requestedControlPort: 0') &&
    value.includes('requestedProviderProxyPort: 0') &&
    value.includes('requestedRuntimeCodexPort: 0') &&
    value.includes('runtime:config') &&
    value.includes('dist-desktop') &&
    DEFAULT_SIDECAR_PATHS.every((filePath) => value.includes(basename(filePath))) &&
    value.includes('runtime-codex') &&
    loadUrlOnlyForNativeBrowser &&
    forbidden.every((token) => !value.includes(token));
}

function sidecarsLookBundled(sidecars: Array<{ filePath: string; text: string }>): boolean {
  return sidecars.every(({ text }) =>
    text.includes('Bundled by tools/build-desktop-sidecars.ts') &&
    !/from ['"]@sciforge-ui\//.test(text) &&
    !/from ['"](?:\.{1,2}\/|\.\.\/\.\.\/packages\/|\.\.\/\.\.\/\.\.\/packages\/)[^'"]+['"]/.test(text),
  );
}

function preloadLooksIsolated(value: string): boolean {
  const requiredChannels = [
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
    'platform:open-external',
    'platform:pick-directory',
    'platform:reveal-path',
  ];
  return value.includes('contextBridge') &&
    value.includes('ipcRenderer') &&
    value.includes('sciforgeDesktop') &&
    requiredChannels.every((channel) => value.includes(channel)) &&
    !/node:child_process|from ['"]node:fs['"]|require\(['"](?:node:)?fs['"]\)/.test(value);
}

function rendererLooksBuilt(value: string): boolean {
  return /<script\b[^>]*type="module"[^>]*src="(?:\.\/|\/)?assets\/[^"]+\.js"/.test(value) &&
    !value.includes('/src/') &&
    !value.includes('@vite/client');
}

function fileEvidence(path: string, text: string): { path: string; sizeBytes: number; sha256: string } {
  return {
    path,
    sizeBytes: Buffer.byteLength(text),
    sha256: sha256Text(text),
  };
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function readPlistString(plistText: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<key>${escapedKey}</key>\\s*<string>([^<]+)</string>`).exec(plistText);
  return match?.[1];
}

function assertFilePathInput(label: string, value: string): void {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^file:/i.test(value)) {
    throw new Error(`${label} must be a filesystem path, got URL-like value: ${value}`);
  }
}
