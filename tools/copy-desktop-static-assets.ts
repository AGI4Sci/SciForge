import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export type DesktopStaticAssetCopy = {
  from: string;
  to?: string;
};

const desktopStaticFiles: DesktopStaticAssetCopy[] = [
  { from: 'packages/actions/computer-use/action-provider.manifest.json' },
  { from: 'packages/actions/computer-use/adapter-registry.manifest.json' },
  { from: 'packages/actions/computer-use/native-window-capability.manifest.json' },
  { from: 'packages/actions/computer-use/virtual-app-screen-host/capability.manifest.json' },
  { from: 'packages/observe/web/capabilities/web_search.manifest.json' },
  { from: 'packages/observe/web/capabilities/web_fetch.manifest.json' },
  { from: 'packages/observe/web/capabilities/browser_search.manifest.json' },
  { from: 'packages/observe/web/capabilities/browser_fetch.manifest.json' },
  { from: 'packages/observe/web/capabilities/browser_runtime.manifest.json' },
  { from: 'packages/observe/web/capabilities/playwright_browser_automation.manifest.json' },
  { from: 'packages/observe/web/capabilities/playwright_edge_browser.manifest.json' },
  { from: 'packages/verifiers/fixtures/human-approval.manifest.json' },
];

const desktopStaticDirs: DesktopStaticAssetCopy[] = [
  { from: 'packages/actions/computer-use/sciforge_computer_use' },
  { from: 'packages/actions/computer-use/fixtures' },
  { from: 'packages/actions/computer-use/skills' },
];

const computerUsePackageFiles: DesktopStaticAssetCopy[] = [
  { from: 'packages/actions/computer-use/pyproject.toml' },
  { from: 'packages/actions/computer-use/README.md' },
];

export async function copyDesktopStaticAssets(options: {
  rootDir?: string;
  outDir?: string;
} = {}): Promise<{ files: number; dirs: number }> {
  const rootDir = options.rootDir ?? process.cwd();
  const outDir = options.outDir ?? 'dist-desktop';
  let files = 0;
  let dirs = 0;

  for (const entry of [...desktopStaticFiles, ...computerUsePackageFiles]) {
    await copyStaticFile(rootDir, outDir, entry);
    files += 1;
  }

  for (const entry of desktopStaticDirs) {
    await copyStaticDir(rootDir, outDir, entry);
    dirs += 1;
  }

  return { files, dirs };
}

async function copyStaticFile(rootDir: string, outDir: string, entry: DesktopStaticAssetCopy): Promise<void> {
  const destination = join(rootDir, outDir, entry.to ?? entry.from);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(rootDir, entry.from), destination, { force: true });
}

async function copyStaticDir(rootDir: string, outDir: string, entry: DesktopStaticAssetCopy): Promise<void> {
  const destination = join(rootDir, outDir, entry.to ?? entry.from);
  await rm(destination, { recursive: true, force: true });
  await cp(join(rootDir, entry.from), destination, {
    recursive: true,
    force: true,
    filter: (source) => shouldCopyComputerUseRuntimeAsset(source),
  });
}

function shouldCopyComputerUseRuntimeAsset(source: string): boolean {
  const normalized = source.split(sep).join('/');
  if (normalized.includes('/__pycache__')) return false;
  if (normalized.includes('/.pytest_cache')) return false;
  if (normalized.includes('/tests/')) return false;
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await copyDesktopStaticAssets();
  console.log(`[desktop:copy-static-assets] copied ${result.files} files and ${result.dirs} directories`);
}
