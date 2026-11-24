import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const scope = 'test-fixtures/migration-plugins/'
const provenancePath = `${scope}THIRD_PARTY.provenance.json`
const noticePath = `${scope}THIRD_PARTY_NOTICES.md`
const digest = data => createHash('sha256').update(data).digest('hex')
// Reviewed public ba00016 inputs: never derive the expected bytes from a build or install.
const fixtures = new Map([
  ['failure-activation/dist/main.js', 'da867a5b5fae8736a3e504fd5d42aa87421a1443439fd8be116af5022bc1c098'],
  ['failure-incompatible/dist/main.js', '8d04820160e407d43b35bafdbcc8ab6ccb4485327a81b9473f84873732952f57'],
  ['p1-unitverse/dist/main.js', '3bbe4042cdbe20a1b24903dee52fe57b5dd51e63c50a65abdbf550663d1719af'],
  ['p2-better-sidebar/dist/main.js', 'd4b81ccb21c511563f2bfa3c45de74b942b1382037fe963543962c5becd6727c'],
  ['p2-better-sidebar/dist/renderer.html', 'b47d252cfcf3612232218c05c78e3a561eb8f9105b834d7a8bda4b1456a26cce'],
  ['p2-better-sidebar/dist/renderer.mjs', 'dad0b988a088b4f90ac5203d019b89877d2e9e21511b7785f152d196a8c36a62'],
  ['p3-mcp-bridge/dist/main.js', '2b7880cf1c65dd71804bde33e436f271c1a6eee3c809366958a8c16e09e4042a'],
  ['p4-agent-teams/dist/main.js', '9805d27d8fb431a98bf0c792d11a5a160793df4355fc42a6facccc440147ee5a'],
  ['p5-ws-scope/dist/main.js', '74482272287902b7e4f5d899e15c1d042b17ef43500b822ce8e4d0bd22d71df2']
].map(([path, hash]) => [scope + path, hash]))
const components = [
  ['zod', '4.4.3', 'MIT', 'zod', '3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8', ['Copyright (c) 2025 Colin McDonnell']],
  ['@modelcontextprotocol/sdk', '1.29.0', 'MIT', 'modelcontextprotocol--sdk', '5e13dbbc1d120fc2a03cecde7c91424ae2d7de11b63d58ded2f4431e261ee50d', ['Copyright (c) 2024 Anthropic, PBC']],
  ['ajv', '8.20.0', 'MIT', 'ajv', 'a05350a88e318e4f5f2c2a1ff1e2e88daa4dd38e6e78b71cccae422bdc762cc3', ['Copyright (c) 2015-2021 Evgeny Poberezkin']],
  ['ajv-formats', '3.0.1', 'MIT', 'ajv-formats', '9df3bb69929a3b650ed73b3bfa1756725aaff0ac296461605753547004eafeaf', ['Copyright (c) 2020 Evgeny Poberezkin']],
  ['fast-deep-equal', '3.1.3', 'MIT', 'fast-deep-equal', '7bf9b2de73a6b356761c948d0e9eeb4be6c1270bd04c79cd489c1e400ffdfc1a', ['Copyright (c) 2017 Evgeny Poberezkin']],
  ['fast-uri', '3.1.2', 'BSD-3-Clause', 'fast-uri', 'b010b0dfdfdb23d7396e03b82cd4621fc9bb8f95d6b0aea70b9c24e12074c786', ['Copyright (c) 2011-2021, Gary Court', 'Copyright (c) 2021-present The Fastify team']],
  ['json-schema-traverse', '1.0.0', 'MIT', 'json-schema-traverse', '7bf9b2de73a6b356761c948d0e9eeb4be6c1270bd04c79cd489c1e400ffdfc1a', ['Copyright (c) 2017 Evgeny Poberezkin']],
  ['zod-to-json-schema', '3.25.2', 'ISC', 'zod-to-json-schema', '80d3168ad2f70f6f5bb2ab22b23414707abf6f0a392034891481ae36a1a429d4', ['Copyright (c) 2020, Stefan Terdell']],
  ['esbuild', '0.25.12', 'MIT', 'esbuild', 'b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681', ['Copyright (c) 2020 Evan Wallace']]
].map(([name, version, license, slug, hash, copyright]) => ({name, version, license, hash, copyright,
  path: `${scope}licenses/${slug}-${version}.LICENSE.txt`,
  role: name === 'esbuild' ? 'generated-helper-attribution' : 'inlined-third-party-code'}))
const inlineNames = components.filter(item => item.role === 'inlined-third-party-code').map(item => item.name).sort()

export async function loadMigrationFixtureLicenseSnapshot(root) {
  const directory = resolve(root, scope)
  assert.equal(await realpath(directory), join(await realpath(root), scope.slice(0, -1)), 'Fixture scope must not be a linked path')
  const files = new Map()
  async function visit(path) {
    for (const entry of await readdir(path, {withFileTypes: true})) {
      const target = join(path, entry.name)
      assert.equal(entry.isSymbolicLink(), false, 'Symbolic links are not licensed fixture inputs')
      if (entry.isDirectory()) await visit(target)
      else {
        assert.equal(entry.isFile(), true, 'Special fixture files are not allowed')
        const name = relative(root, target).split('\\').join('/')
        if (name.includes('/dist/') || name.startsWith(`${scope}licenses/`) || [provenancePath, noticePath].includes(name)) {
          const info = await lstat(target)
          assert.ok(info.isFile() && !info.isSymbolicLink(), 'Fixture and license inputs must be regular files')
          files.set(name, await readFile(target))
        }
      }
    }
  }
  await visit(directory)
  return files
}

/** Offline publication gate; declared dependencies alone are never counted as shipped code. */
export function verifyMigrationFixtureLicenseSnapshot(files) {
  const metadata = JSON.parse(required(files, provenancePath).toString('utf8'))
  assert.equal(metadata.kind, 'sciforge-migration-fixture-license-provenance')
  assert.equal(metadata.schemaVersion, 1)
  assert.equal(metadata.immutableFixtureBaseline, 'ba00016cd864127102e9736e8acfb942050bfc80')
  assert.deepEqual([...files.keys()].filter(path => path.includes('/dist/')).sort(), [...fixtures.keys()].sort(), 'Exactly nine reviewed dist inputs are allowed')
  const observed = [], byFixture = new Map()
  for (const path of fixtures.keys()) {
    const lines = required(files, path).toString('utf8').split('\n')
    if (lines.at(-1) === '') lines.pop()
    const markers = lines.flatMap((line, index) => line.startsWith('// ') ? [{label:line.slice(3), index}] : [])
    const occurrences = []
    for (const [index, marker] of markers.entries()) {
      const dependencyOffset = marker.label.lastIndexOf('node_modules/')
      if (dependencyOffset < 0 || dependencyOffset > 0 && marker.label[dependencyOffset - 1] !== '/') continue
      const parts = marker.label.slice(dependencyOffset + 'node_modules/'.length).split('/')
      const name = parts[0].startsWith('@') ? parts.splice(0, 2).join('/') : parts.shift()
      assert.ok(inlineNames.includes(name), `Unreviewed inlined package: ${name}`)
      const occurrence = {fixture:path, name, modulePath:parts.join('/'), bundleStartLine:marker.index + 1,
        bundleEndLine:markers[index + 1]?.index ?? lines.length}
      occurrence.bundleSegmentSHA256 = digest(Buffer.from(lines.slice(occurrence.bundleStartLine, occurrence.bundleEndLine).join('\n')))
      occurrences.push(occurrence); observed.push(occurrence)
    }
    byFixture.set(path, occurrences)
  }
  assert.deepEqual([...new Set(observed.map(item => item.name))].sort(), inlineNames, 'Observed eight-package closure differs')
  assert.deepEqual(metadata.fixtures.map(item => item.path).sort(), [...fixtures.keys()].sort(), 'Provenance must cover exactly the reviewed fixtures')
  for (const fixture of metadata.fixtures) {
    const data = required(files, fixture.path)
    assert.equal(digest(data), fixtures.get(fixture.path), `Immutable fixture bytes changed: ${fixture.path}`)
    assert.equal(fixture.sha256, digest(data)); assert.equal(fixture.bytes, data.length)
    assert.equal(fixture.blob, createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex'))
    assert.deepEqual([...fixture.inlinedPackages].sort(), [...new Set(byFixture.get(fixture.path).map(item => item.name))].sort())
    assert.equal(fixture.nodeModuleCommentCount, byFixture.get(fixture.path).length)
  }
  assert.deepEqual(metadata.components.map(item => item.name).sort(), components.map(item => item.name).sort(), 'Unexpected or missing licensed component')
  assert.deepEqual(metadata.expectedInlinePackageNames, inlineNames)
  assert.deepEqual(metadata.expectedGeneratedHelperNames, ['esbuild'])
  assert.deepEqual([...files.keys()].filter(path => path.startsWith(`${scope}licenses/`)).sort(), components.map(item => item.path).sort(), 'Only exact full-license files belong to this sidecar scope')
  const declared = []
  for (const item of components) {
    const component = metadata.components.find(entry => entry.name === item.name)
    assert.equal(component.recordedVersion, item.version); assert.equal(component.license, item.license); assert.equal(component.role, item.role)
    assert.equal(component.licensePath, item.path, 'License path must stay in the exact reviewed sidecar scope')
    assert.equal(component.licenseSHA256, item.hash)
    const bytes = required(files, item.path)
    assert.equal(digest(bytes), item.hash, `Full license bytes changed: ${item.name}`)
    assert.ok(bytes.length > 200)
    for (const copyright of item.copyright) assert.ok(bytes.toString('utf8').includes(copyright), 'Original copyright must remain')
    assert.deepEqual(component.copyright, item.copyright.map(text => component.copyright.find(line => line.startsWith(text))))
    assert.equal(component.versionEvidence.uniqueOriginalBuildIdentityProven, false)
    assert.equal(component.versionEvidence.originalInstallAttestationAvailable, false)
    for (const url of [component.metadataUrl, component.tarballUrl]) {
      const parsed = new URL(url)
      assert.equal(parsed.protocol, 'https:'); assert.equal(parsed.hostname, 'registry.npmjs.org')
      assert.equal(parsed.username + parsed.password + parsed.search + parsed.hash, '')
    }
    assert.match(component.registryIntegrity, /^sha512-[A-Za-z0-9+/]+=*$/)
    assert.match(component.archiveSHA256, /^[a-f0-9]{64}$/)
    if (item.role === 'generated-helper-attribution') assert.deepEqual(component.embeddedModuleOccurrences, [])
    else for (const occurrence of component.embeddedModuleOccurrences) {
      declared.push({fixture:occurrence.fixture, name:item.name, modulePath:occurrence.modulePath,
        bundleStartLine:occurrence.bundleStartLine, bundleEndLine:occurrence.bundleEndLine, bundleSegmentSHA256:occurrence.bundleSegmentSHA256})
    }
  }
  assert.deepEqual(declared.map(item => JSON.stringify(item)).sort(), observed.map(item => JSON.stringify(item)).sort(), 'Emitted module occurrence inventory differs')
  const notice = required(files, noticePath).toString('utf8')
  assert.match(notice, /only to the nine immutable fixture inputs/)
  assert.match(notice, /not.*(?:claim|attestation)|not a retroactive/is)
  const links = [...notice.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]).sort()
  assert.deepEqual(links, ['THIRD_PARTY.provenance.json', ...components.map(item => item.path.slice(scope.length))].sort(), 'Notice links must resolve only to the scoped provenance and full texts')
  return {fixtures:fixtures.size, inlinePackages:inlineNames.length, helperAttributions:1, moduleOccurrences:observed.length}
}

function required(files, path) {
  assert.ok(files.has(path), `Missing fixture/license sidecar: ${path}`)
  return files.get(path)
}
