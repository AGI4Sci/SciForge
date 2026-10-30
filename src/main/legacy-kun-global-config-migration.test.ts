import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateLegacyKunGlobalConfig } from './legacy-kun-global-config-migration'

describe('legacy Kun global config migration', () => {
  it('moves legacy MCP and skills into the SciForge global locations once', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-kun-migration-'))
    await mkdir(join(home, '.kun', 'skills', 'demo'), { recursive: true })
    await writeFile(join(home, '.kun', 'mcp.json'), '{"servers":{"user":{"command":"node"}}}', 'utf8')
    await writeFile(join(home, '.kun', 'skills', 'demo', 'SKILL.md'), '# Demo', 'utf8')

    const result = await migrateLegacyKunGlobalConfig({ homeDir: home })

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'mcp', status: 'moved' }),
      expect.objectContaining({ kind: 'skills', status: 'moved' })
    ]))
    expect(await readFile(join(home, '.sciforge', 'mcp.json'), 'utf8')).toContain('user')
    expect(await readdir(join(home, '.sciforge', 'skills'))).toContain('demo')
    await expect(readFile(join(home, '.kun', 'mcp.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(join(home, '.kun', 'skills'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves legacy files untouched when the SciForge target already exists', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-kun-migration-'))
    await mkdir(join(home, '.kun', 'skills', 'legacy'), { recursive: true })
    await mkdir(join(home, '.sciforge', 'skills', 'current'), { recursive: true })
    await mkdir(join(home, '.sciforge'), { recursive: true })
    await writeFile(join(home, '.kun', 'mcp.json'), '{"servers":{"legacy":{}}}', 'utf8')
    await writeFile(join(home, '.sciforge', 'mcp.json'), '{"servers":{"current":{}}}', 'utf8')

    const result = await migrateLegacyKunGlobalConfig({ homeDir: home })

    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'mcp', status: 'target-exists' }),
      expect.objectContaining({ kind: 'skills', status: 'target-exists' })
    ]))
    expect(await readFile(join(home, '.kun', 'mcp.json'), 'utf8')).toContain('legacy')
    expect(await readFile(join(home, '.sciforge', 'mcp.json'), 'utf8')).toContain('current')
    expect(await readdir(join(home, '.kun', 'skills'))).toContain('legacy')
    expect(await readdir(join(home, '.sciforge', 'skills'))).toContain('current')
  })

  it('does nothing when legacy global config is absent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sciforge-kun-migration-'))

    const result = await migrateLegacyKunGlobalConfig({ homeDir: home })

    expect(result.entries).toEqual([
      expect.objectContaining({ kind: 'mcp', status: 'legacy-missing' }),
      expect.objectContaining({ kind: 'skills', status: 'legacy-missing' })
    ])
  })
})
