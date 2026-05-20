import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_PRODUCT_NAME = 'SciForge';
const DEFAULT_PACKAGE_OUTPUT_DIR = 'dist-desktop-packages';

export type DesktopPackagedArtifactResolution = {
  artifactPath: string;
  executablePath?: string;
  asarPath: string;
  resourcesPath: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  candidates: string[];
};

export type ResolveDesktopPackagedArtifactOptions = {
  projectRoot?: string;
  artifactPath?: string;
  productName?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
};

export function resolveDesktopProductionArtifactPath(
  options: ResolveDesktopPackagedArtifactOptions = {},
): string {
  return resolveDesktopPackagedArtifact(options).artifactPath;
}

export function resolveDesktopPackagedArtifact(
  options: ResolveDesktopPackagedArtifactOptions = {},
): DesktopPackagedArtifactResolution {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const productName = options.productName ?? DEFAULT_PRODUCT_NAME;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  if (options.artifactPath) {
    return artifactResolutionFromPath({
      projectRoot,
      artifactPath: resolve(projectRoot, options.artifactPath),
      productName,
      platform,
      arch,
      candidates: [resolve(projectRoot, options.artifactPath)],
    });
  }

  const candidates = desktopPackagedArtifactCandidates({ projectRoot, productName, platform, arch });
  const artifactPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
  return artifactResolutionFromPath({
    projectRoot,
    artifactPath,
    productName,
    platform,
    arch,
    candidates,
  });
}

export function desktopPackagedArtifactCandidates(input: {
  projectRoot?: string;
  productName?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
} = {}): string[] {
  const projectRoot = resolve(input.projectRoot ?? process.cwd());
  const productName = input.productName ?? DEFAULT_PRODUCT_NAME;
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const outputRoot = join(projectRoot, DEFAULT_PACKAGE_OUTPUT_DIR);

  if (platform === 'darwin') {
    const appName = `${productName}.app`;
    const primary = arch === 'arm64' ? 'mac-arm64' : 'mac';
    return uniquePaths([
      join(outputRoot, primary, appName),
      join(outputRoot, `mac-${arch}`, appName),
      join(outputRoot, 'mac', appName),
      join(outputRoot, 'mac-universal', appName),
    ]);
  }

  if (platform === 'win32') {
    return [join(outputRoot, 'win-unpacked', 'resources', 'app.asar')];
  }

  if (platform === 'linux') {
    return [join(outputRoot, 'linux-unpacked', 'resources', 'app.asar')];
  }

  return [join(outputRoot, `${platform}-${arch}`, 'resources', 'app.asar')];
}

function artifactResolutionFromPath(input: {
  projectRoot: string;
  artifactPath: string;
  productName: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  candidates: string[];
}): DesktopPackagedArtifactResolution {
  const { artifactPath, productName, platform, arch, candidates } = input;

  if (artifactPath.endsWith('.app')) {
    const resourcesPath = join(artifactPath, 'Contents', 'Resources');
    return {
      artifactPath,
      executablePath: join(artifactPath, 'Contents', 'MacOS', productName),
      asarPath: join(resourcesPath, 'app.asar'),
      resourcesPath,
      platform,
      arch,
      candidates,
    };
  }

  if (artifactPath.endsWith('.asar')) {
    const resourcesPath = dirname(artifactPath);
    return {
      artifactPath,
      executablePath: executableForResourcesPath(resourcesPath, productName, platform),
      asarPath: artifactPath,
      resourcesPath,
      platform,
      arch,
      candidates,
    };
  }

  const resourcesPath = join(artifactPath, 'resources');
  return {
    artifactPath: join(resourcesPath, 'app.asar'),
    executablePath: executableForResourcesPath(resourcesPath, productName, platform),
    asarPath: join(resourcesPath, 'app.asar'),
    resourcesPath,
    platform,
    arch,
    candidates,
  };
}

function executableForResourcesPath(
  resourcesPath: string,
  productName: string,
  platform: NodeJS.Platform,
): string | undefined {
  const unpackedRoot = dirname(resourcesPath);
  if (platform === 'win32') return join(unpackedRoot, `${productName}.exe`);
  if (platform === 'linux') return join(unpackedRoot, productName);
  return undefined;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}
