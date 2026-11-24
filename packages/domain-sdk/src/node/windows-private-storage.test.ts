import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  restrictWindowsStorage,
  restrictWindowsStorageSync,
  type WindowsStorageEntry
} from './windows-private-storage.mjs'

async function inspect(path: string): Promise<WindowsStorageEntry> {
  const stat = await lstat(path, { bigint: true })
  return { path, dev: stat.dev, ino: stat.ino, directory: stat.isDirectory() }
}

function assertPrivateAcl(paths: string[]) {
  // Read back the OS ACL independently of the enforcement bridge.
  const script = `
$ErrorActionPreference = 'Stop'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = @($paths | ForEach-Object {
  $acl = if ([System.IO.Directory]::Exists($_)) {
    [System.IO.Directory]::GetAccessControl($_)
  } else {
    [System.IO.File]::GetAccessControl($_)
  }
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
    @{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); inherited = $_.IsInherited; rights = $_.FileSystemRights.ToString() }
  })
  @{ protected = $acl.AreAccessRulesProtected; owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; rules = $rules }
})
@{ user = $user; entries = $results } | ConvertTo-Json -Depth 5 -Compress
`
  const result = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')
  ], { input: JSON.stringify(paths), encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  const snapshot = JSON.parse(result.stdout)
  assert.equal(snapshot.entries.length, paths.length)
  for (const entry of snapshot.entries) {
    assert.equal(entry.protected, true)
    assert.equal(entry.owner, snapshot.user)
    assert.equal(entry.rules.length, 3)
    assert.deepEqual(entry.rules.map((rule: { sid: string }) => rule.sid).sort(),
      [snapshot.user, 'S-1-5-18', 'S-1-5-32-544'].sort())
    for (const rule of entry.rules) {
      assert.equal(rule.type, 'Allow')
      assert.equal(rule.inherited, false)
      assert.equal(rule.rights, 'FullControl')
    }
  }
}

test('Windows async restriction completes before sync reuse and preserves private readable/writable storage', {
  skip: process.platform !== 'win32', timeout: 120_000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-sdk-windows-private-'))
  try {
    const directory = join(root, 'private')
    const file = join(directory, 'content.txt')
    await mkdir(directory)
    await writeFile(file, 'original content', 'utf8')
    const paths = [directory, file]
    const entries = await Promise.all(paths.map(inspect))

    await restrictWindowsStorage(entries)
    assertPrivateAcl(paths)
    assert.equal(await readFile(file, 'utf8'), 'original content')
    await writeFile(file, 'after async', 'utf8')
    restrictWindowsStorageSync(entries)
    assertPrivateAcl(paths)
    assert.equal(await readFile(file, 'utf8'), 'after async')
    await writeFile(file, 'after sync', 'utf8')
    assert.equal(await readFile(file, 'utf8'), 'after sync')
    const created = join(directory, 'created.txt')
    await writeFile(created, 'directory remains writable', 'utf8')
    assert.equal(await readFile(created, 'utf8'), 'directory remains writable')
  } finally {
    // root is the unique directory created by this test, never a caller path.
    await rm(root, { recursive: true, force: true })
  }
})


test('Windows async ACL preparation rejects stale file identity', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-sdk-stale-'))
  try {
    const file = join(root, 'owned.txt')
    await writeFile(file, 'preserved content')
    const entry = await inspect(file)
    await assert.rejects(restrictWindowsStorage([{ ...entry, ino: BigInt(entry.ino) + 1n }]), /ACL enforcement failed/)
    assert.equal(await readFile(file, 'utf8'), 'preserved content')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
