import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Explicit fixture roots stay isolated; product discovery also reads dual-form domains. */
export async function listDshPluginDirectories({ root = process.cwd(), pluginsDirectory } = {}) {
  const roots = pluginsDirectory
    ? [{ path: resolve(root, pluginsDirectory), requireDsh: false }]
    : [{ path: resolve(root, 'plugins'), requireDsh: false }, { path: resolve(root, 'packages/domains'), requireDsh: true }]
  const directories = []
  for (const candidate of roots) {
    for (const entry of await readdir(candidate.path, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'templates') continue
      const directory = join(candidate.path, entry.name)
      let bytes
      try { bytes = await readFile(join(directory, 'package.json'), 'utf8') } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      const manifest = JSON.parse(bytes)
      if (!candidate.requireDsh || manifest.dsh !== undefined) directories.push(directory)
    }
  }
  return directories.sort()
}
