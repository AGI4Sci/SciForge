import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareDshStorageRoot, resolveDshStorageRoot } from './dsh-storage-root.mjs'

async function fixture(run: (parent: string) => Promise<void>) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'public-storage-')))
  try { await run(parent) } finally { await rm(parent, { recursive: true, force: true }) }
}

async function runCommand(executable: string, args: string[]) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `${executable} exited with ${code}`)))
  })
}

async function windowsAcl(paths: string[]) {
  const userSid = (await runCommand('whoami.exe', ['/user', '/fo', 'csv', '/nh'])).match(/"(S-1-[0-9-]+)"\s*$/)?.[1]
  assert.ok(userSid, 'whoami must report the current user SID')
  const results: Array<{ path: string; sddl: string; userSid: string }> = []
  for (const path of paths) {
    const scratch = await mkdtemp(join(tmpdir(), 'dsh-acl-inspect-'))
    try {
      const aclFile = join(scratch, 'acl.txt')
      await runCommand('icacls.exe', [path, '/save', aclFile, '/c'])
      const serialized = (await readFile(aclFile)).toString('utf16le').replace(/^\uFEFF/, '')
      const sddl = serialized.match(/D:[^\r\n]+/)?.[0]?.trim()
      assert.ok(sddl, `icacls did not serialize the DACL for ${path}: ${serialized}`)
      results.push({ path, sddl, userSid })
    } finally { await rm(scratch, { recursive: true, force: true }) }
  }
  return results as Array<{
    path: string
    userSid: string
    sddl: string
  }>
}

async function allowEveryone(path: string) {
  await runCommand('icacls.exe', [path, '/grant', '*S-1-1-0:(F)'])
}

function assertPrivateAcl(acl: Awaited<ReturnType<typeof windowsAcl>>[number], protectedDacl = true) {
  if (protectedDacl) assert.match(acl.sddl, /^D:P/)
  const aliases: Record<string, string> = { SY: 'S-1-5-18', BA: 'S-1-5-32-544' }
  const sids = [...acl.sddl.matchAll(/;;;([^)]*)\)/g)].map(match => aliases[match[1]] ?? match[1]).sort()
  assert.deepEqual(sids, [acl.userSid, 'S-1-5-18', 'S-1-5-32-544'].sort(), acl.sddl)
}

test('storage root restricts only the granted tree and preserves ancestor modes and bytes', async () => {
  await fixture(async parent => {
    const root = join(parent, 'owned')
    await mkdir(join(root, 'nested'), { recursive: true, mode: 0o755 })
    const file = join(root, 'nested', 'record.json')
    await writeFile(file, '{"retained":true}', { mode: 0o644 })
    const parentAcl = process.platform === 'win32' ? (await windowsAcl([parent]))[0].sddl : undefined
    if (process.platform === 'win32') {
      await allowEveryone(root)
      await allowEveryone(join(root, 'nested'))
      await allowEveryone(file)
    } else {
      await chmod(parent, 0o755)
    }
    assert.equal(await prepareDshStorageRoot(root), root)
    if (process.platform === 'win32') {
      const acls = await windowsAcl([parent, root, join(root, 'nested'), file])
      assert.equal(acls[0].sddl, parentAcl, 'profile ancestors are not modified')
      for (const acl of acls.slice(1)) assertPrivateAcl(acl)
      const childDirectory = join(root, 'new-child')
      const childFile = join(childDirectory, 'created.json')
      await mkdir(childDirectory)
      await writeFile(childFile, 'private')
      for (const acl of await windowsAcl([childDirectory, childFile])) assertPrivateAcl(acl, false)
    } else {
      assert.equal((await lstat(parent)).mode & 0o777, 0o755)
      assert.equal((await lstat(root)).mode & 0o777, 0o700)
      assert.equal((await lstat(file)).mode & 0o777, 0o600)
    }
    assert.equal(await readFile(file, 'utf8'), '{"retained":true}')
    const privateInode = (await lstat(file)).ino
    assert.equal(await prepareDshStorageRoot(root), root)
    assert.equal((await lstat(file)).ino, privateInode, 'already-private files are not replaced')
    assert.equal(await readFile(file, 'utf8'), '{"retained":true}')
  })
})

test('storage root rejects descendant and profile symlinks without touching external files', async () => {
  await fixture(async parent => {
    const external = join(parent, 'external')
    await mkdir(external)
    const file = join(external, 'keep')
    await writeFile(file, 'untouched', { mode: 0o644 })
    const externalAcl = process.platform === 'win32' ? (await windowsAcl([file]))[0].sddl : undefined
    const root = join(parent, 'owned')
    await mkdir(root)
    await symlink(external, join(root, 'escape'), process.platform === 'win32' ? 'junction' : undefined)
    await assert.rejects(prepareDshStorageRoot(root), /symlink/)
    await symlink(external, join(parent, 'profile-alias'), process.platform === 'win32' ? 'junction' : undefined)
    await assert.rejects(prepareDshStorageRoot(join(parent, 'profile-alias', 'owned')), /symlink/)
    assert.equal(await readFile(file, 'utf8'), 'untouched')
    if (process.platform === 'win32') assert.equal((await windowsAcl([file]))[0].sddl, externalAcl)
    else assert.equal((await lstat(file)).mode & 0o777, 0o644)
  })
})

test('storage root rejects an ancestor redirect before writing a private replacement inode', { skip: process.platform === 'win32' ? 'Windows tightens the existing inode ACL without publishing a replacement.' : false }, async () => {
  await fixture(async parent => {
    const root = join(parent, 'owned')
    const external = join(parent, 'external')
    await mkdir(root)
    await mkdir(external)
    await writeFile(join(root, 'record.json'), 'owned-sensitive-bytes', { mode: 0o644 })
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs/promises'
      import { constants } from 'node:fs'
      import { syncBuiltinESMExports } from 'node:module'
      const [root, external, moduleUrl] = process.argv.slice(1)
      const originalOpen = fs.open
      let redirected = false
      let externalWriteObserved = false
      fs.open = async (path, flags, mode) => {
        if (!redirected && typeof path === 'string' && path.includes('/.dsh-private-') && flags & constants.O_CREAT) {
          redirected = true
          await fs.rename(root, root + '-parked')
          await fs.symlink(external, root)
        }
        const handle = await originalOpen(path, flags, mode)
        if (redirected && typeof path === 'string' && path.includes('/.dsh-private-')) {
          const originalWrite = handle.writeFile.bind(handle)
          handle.writeFile = async (...args) => {
            externalWriteObserved = true
            return originalWrite(...args)
          }
        }
        return handle
      }
      syncBuiltinESMExports()
      let rejected = false
      try { const { prepareDshStorageRoot } = await import(moduleUrl); await prepareDshStorageRoot(root) }
      catch { rejected = true }
      process.send({ redirected, rejected, externalWriteObserved })
      process.disconnect()
    `, root, external, new URL('./dsh-storage-root.mjs', import.meta.url).href], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    const [result] = await once(child, 'message') as [{ redirected: boolean; rejected: boolean; externalWriteObserved: boolean }]
    await once(child, 'exit')
    assert.equal(result.redirected, true)
    assert.equal(result.rejected, true)
    assert.equal(result.externalWriteObserved, false)
    assert.equal(await readFile(join(external, '.dsh-private-probe')).catch(() => undefined), undefined)
  })
})

test('storage root rejects hardlinked data before chmod and rejects noncanonical identities', async () => {
  await fixture(async parent => {
    const root = join(parent, 'owned')
    await mkdir(root)
    const external = join(parent, 'external.json')
    await writeFile(external, 'retained', { mode: 0o644 })
    await link(external, join(root, 'alias.json'))
    await assert.rejects(prepareDshStorageRoot(root), /hardlink/)
    if (process.platform !== 'win32') assert.equal((await lstat(external)).mode & 0o777, 0o644)
    await assert.rejects(prepareDshStorageRoot(`${parent}/a/../owned`), /canonical/)
    await assert.rejects(resolveDshStorageRoot({ profileRoot: parent, packageName: 'neutral-consumer' }, 'other-consumer'), /identity/)
    await assert.rejects(resolveDshStorageRoot({ profileRoot: parent, packageName: ' neutral-consumer' }, ' neutral-consumer'), /identity/)
  })
})

// A separate process pauses only scheduling; the attacker performs real unlink/link
// operations, and the child runs the actual boundary against the real filesystem.
for (const boundary of ['inspection', 'restriction', 'mutation'] as const) for (const attack of ['replacement', 'addition'] as const) {
  test(`storage root fails closed on concurrent hardlink ${attack} after ${boundary}`, { timeout: 15_000 }, async t => {
    await fixture(async parent => {
      const root = join(parent, 'owned')
      await mkdir(root)
      const file = join(root, 'record.json')
      const external = join(parent, 'external.json')
      await writeFile(file, 'owned', { mode: 0o644 })
      await writeFile(external, 'external', { mode: 0o644 })
      const child = spawn(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs/promises'
        import { syncBuiltinESMExports } from 'node:module'
        const [root, file, boundary, moduleUrl] = process.argv.slice(1)
        const pause = async () => {
          process.send('paused')
          await new Promise(resolve => process.once('message', resolve))
        }
        const originalMkdir = fs.mkdir
        fs.mkdir = async (...args) => {
          const result = await originalMkdir(...args)
          if (boundary === 'inspection' && args[0] === root) await pause()
          return result
        }
        const originalLstat = fs.lstat
        let inspections = 0
        fs.lstat = async (...args) => {
          const result = await originalLstat(...args)
          if (boundary === 'restriction' && args[0] === file && ++inspections === 2) await pause()
          if (boundary === 'mutation' && process.platform === 'win32' && args[0] === file && ++inspections === 3) await pause()
          return result
        }
        // The late barrier catches both path chmod and a descriptor/copy strategy.
        const originalChmod = fs.chmod
        fs.chmod = async (...args) => {
          if (boundary === 'mutation' && args[0] === file) await pause()
          return originalChmod(...args)
        }
        const seed = await fs.open(file, 'r')
        const prototype = Object.getPrototypeOf(seed)
        await seed.close()
        const originalHandleChmod = prototype.chmod
        prototype.chmod = async function(mode) {
          if (boundary === 'mutation' && mode === 0o600) await pause()
          return originalHandleChmod.call(this, mode)
        }
        const originalReadFile = prototype.readFile
        prototype.readFile = async function(...args) {
          if (boundary === 'mutation') await pause()
          return originalReadFile.apply(this, args)
        }
        syncBuiltinESMExports()
        const { prepareDshStorageRoot } = await import(moduleUrl)
        try {
          await prepareDshStorageRoot(root)
          process.send({ accepted: true })
        } catch (error) {
          process.send({ accepted: false, error: error.message })
        } finally { process.disconnect() }
      `, root, file, boundary, new URL('./dsh-storage-root.mjs', import.meta.url).href], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      let stderr = ''
      child.stderr!.on('data', chunk => { stderr += chunk })
      const exit = once(child, 'exit')
      try {
        assert.equal((await once(child, 'message'))[0], 'paused')
        if (attack === 'replacement') {
          await rm(file)
          await link(external, file)
        } else {
          await rm(external)
          await link(file, external)
        }
        const expectedAcl = process.platform === 'win32' ? (await windowsAcl([external]))[0].sddl : undefined
        const result = once(child, 'message')
        child.send('resume')
        const [outcome] = await result
        await exit
        assert.equal(stderr, '')
        const mode = (await lstat(external)).mode & 0o777
        t.diagnostic(`${boundary}/${attack}: external mode=0${mode.toString(8)}, accepted=${outcome.accepted}, error=${outcome.error}`)
        if (process.platform === 'win32') {
          assert.equal((await windowsAcl([external]))[0].sddl, expectedAcl, 'external inode ACL must not be changed')
        } else {
          assert.equal(mode, 0o644, 'external inode must never be chmodded')
        }
        assert.equal(await readFile(external, 'utf8'), attack === 'replacement' ? 'external' : 'owned')
        assert.equal(outcome.accepted, false, 'replacement must fail closed')
        assert.match(outcome.error, /changed|hardlink/)
      } finally {
        if (child.exitCode === null) { child.kill(); await exit }
      }
    })
  })
}

test('storage grants isolate neutral package identities within one canonical profile', async () => {
  await fixture(async parent => {
    const a = await resolveDshStorageRoot({ profileRoot: parent, packageName: '@neutral/consumer-a' }, '@neutral/consumer-a')
    const b = await resolveDshStorageRoot({ profileRoot: parent, packageName: '@neutral/consumer-b' }, '@neutral/consumer-b')
    assert.notEqual(a, b)
    await writeFile(join(a, 'state.json'), 'a')
    await assert.rejects(readFile(join(b, 'state.json')), { code: 'ENOENT' })
  })
})
