import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Allow Vite's test asset loader to follow explicitly installed dependencies.
 * Worktrees can use junctions to a shared dependency cache. Only declared
 * package directories are admitted, never their containing checkout or drive.
 * Vite's default deny list and strict filesystem checks remain enabled. */
export function viteDependencyAssetRoots(repositoryRoot: string): string[] {
  const root = resolve(repositoryRoot)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, unknown>
    devDependencies?: Record<string, unknown>
  }
  const roots = new Set([root])
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || name.split('/').some(part => part === '.' || part === '..')) continue
    try {
      const installed = realpathSync(join(root, 'node_modules', ...name.split('/')))
      if (!statSync(installed).isDirectory() || dirname(installed) === installed) continue
      const manifestPath = realpathSync(join(installed, 'package.json'))
      const packageRoot = dirname(manifestPath)
      if ((process.platform === 'win32' ? packageRoot.toLowerCase() !== installed.toLowerCase() : packageRoot !== installed)) continue
      const installedManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
      if (installedManifest.name === name) roots.add(installed)
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
  }
  return [...roots]
}
