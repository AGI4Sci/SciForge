#!/usr/bin/env python3
"""Offline, read-only installed-package closure staging. No package-manager scripts.
Only explicit source + Node inputs; children receive an empty-profile allowlist.
Output is NOT authority: review config against static sources before pin approval.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--node', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
source, node, output = a.source.resolve(), a.node.resolve(), a.output.absolute()
if output.exists():
    raise SystemExit('Refusing to overwrite an existing artifact')
if source in output.parents or output in source.parents:
    raise SystemExit('Output must be outside the read-only official source')
# No ambient provider keys, preloads, proxies, profile paths or package-manager env.
state = output.parent / '.stage-private'
for d in (state, state / 'tmp', state / 'dsh'):
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
env = {'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'LC_ALL': 'en_US.UTF-8',
       'HOME': str(state), 'TMPDIR': str(state / 'tmp'), 'DSH_HOME': str(state / 'dsh')}
commit = subprocess.check_output(['/usr/bin/git', '-C', str(source), 'rev-parse', 'HEAD'], env=env, text=True).strip()
if commit != '639ed015397290b3745d163aafe02ffee4aa3f84':
    raise SystemExit('Unreviewed source revision')
output.mkdir(parents=True)
metadata = {}
graph = {}
lock_json = subprocess.check_output([str(node), '--input-type=module', '-e', "import {createRequire} from 'node:module'; import fs from 'node:fs'; const r=createRequire(process.argv[1]+'/package.json'); console.log(JSON.stringify(r('js-yaml').load(fs.readFileSync(process.argv[1]+'/pnpm-lock.yaml','utf8'))));", str(source)], env=env, text=True)
lock = json.loads(lock_json)
workspaces = {}
for manifest in source.glob('packages/*/*/package.json'):
    workspaces[json.loads(manifest.read_text())['name']] = manifest.parent
for manifest in source.glob('vendor/*/package.json'):
    workspaces[json.loads(manifest.read_text())['name']] = manifest.parent
for manifest in source.glob('native/*/package.json'):
    workspaces[json.loads(manifest.read_text())['name']] = manifest.parent

def resolve(base, name, version):
    for parent in (base, *base.parents):
        candidate = parent / 'node_modules' / name
        if (candidate / 'package.json').is_file():
            return candidate.resolve()
    if name in workspaces:
        return workspaces[name]
    # An installed pnpm package can be present without a workspace link.
    matches = sorted({x.resolve() for x in (source / 'node_modules/.pnpm').glob('*/node_modules/' + name) if (x / 'package.json').is_file()})
    if source in base.parents:
        importer = lock.get('importers', {}).get(str(base.relative_to(source)), {})
        for section in ('dependencies', 'optionalDependencies', 'devDependencies'):
            declared = importer.get(section, {}).get(name)
            if declared:
                version = declared['version'].split('(')[0]
                break
    exact = [x for x in matches if json.loads((x / 'package.json').read_text()).get('version') == version]
    if len(exact) == 1:
        return exact[0]
    if len(matches) == 1:
        return matches[0].resolve()
    return None

def collect(root):
    if root in graph:
        return
    data = json.loads((root / 'package.json').read_text())
    graph[root] = {}
    metadata[root] = data
    optional = data.get('optionalDependencies', {})
    deps = dict(data.get('dependencies', {}))
    deps.update(optional)
    deps.update(data.get('peerDependencies', {}))
    for name in sorted(deps):
        target = resolve(root, name, deps[name])
        if target is None:
            if name in optional or name in data.get('peerDependencies', {}):
                continue
            raise RuntimeError(f'Missing installed dependency: {data["name"]} -> {name}')
        graph[root][name] = target
        collect(target)

cli = source / 'apps/cli'
collect(cli)
primary = {}
for root, data in metadata.items():
    primary.setdefault(data['name'], root)
primary[metadata[cli]['name']] = cli
copies = []

def copy_package(root, target):
    target.mkdir(parents=True)
    # Installed third-party files are already publication content. Official workspace
    # packages: retain lib plus published root/config/assets, never source/profile/env.
    workspace = source in root.parents and 'node_modules' not in root.parts
    def ignore(directory, names):
        excluded = {'node_modules', '.git', '.DS_Store', '.env', '.env.local'}
        excluded.update(n for n in names if n.endswith('.tsbuildinfo') or n.startswith('.env.'))
        if workspace and Path(directory) == root:
            excluded.update({'src', 'test', 'tests', 'evidence', '.agents'})
        return excluded.intersection(names)
    shutil.copytree(root, target, dirs_exist_ok=True, symlinks=False, ignore=ignore)
    if workspace:
        shutil.copyfile(source / 'LICENSE', target / 'LICENSE')
        main = metadata[root].get('main')
        if main and not (target / main).exists() and (root / 'src/index.ts').is_file():
            # Build only missing package output into owned target; imports stay
            # external and resolve exclusively through the staged dependency tree.
            build = output.parent / 'build-missing.mjs'
            build.write_text("import {build} from " + json.dumps(str(source / 'node_modules/tsdown/dist/index.mjs')) + "; await build({config:false,entry:[" + json.dumps(str(root / 'src/index.ts')) + "],outDir:" + json.dumps(str(target / 'lib')) + ",format:['esm'],platform:'node',target:'es2024',clean:false,dts:false,fixedExtension:false,deps:{neverBundle:[/^[^./]/]},logLevel:'error'});\n")
            subprocess.run([str(node), str(build)], env=env, cwd=output.parent, check=True)
    copies.append({'name': metadata[root]['name'], 'version': metadata[root].get('version'),
                   'license': metadata[root].get('license'), 'source': str(root.relative_to(source)) if source in root.parents else str(root),
                   'target': str(target.relative_to(output))})

installed = set()
def install(root, target, ancestors):
    if target in installed:
        return
    installed.add(target)
    copy_package(root, target)
    visible = dict(ancestors)
    visible[metadata[root]['name']] = root
    for name, dep in graph[root].items():
        if visible.get(name, primary.get(name)) == dep:
            continue
        install(dep, target / 'node_modules' / name, visible)

for name, root in primary.items():
    install(root, output / 'node_modules' / name, {})
(output / 'bin').mkdir()
shutil.copyfile(node, output / 'bin/node')
os.chmod(output / 'bin/node', 0o755)
shutil.copyfile(node.parent.parent / 'LICENSE', output / 'NODE-LICENSE')
launcher = '#!/bin/sh\nset -eu\nROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"\nexec "$ROOT/bin/node" "$ROOT/node_modules/@deepseek-ai/dsh/lib/bin.js" "$@"\n'
(output / 'dsh').write_text(launcher)
os.chmod(output / 'dsh', 0o755)
# Publication exports are part of executable closure; do not emit a pin for a
# package whose declared ACP-loaded face is absent. This is intentionally strict.
missing_exports = []
for manifest in output.glob('node_modules/@deepseek-ai/*/package.json'):
    data = json.loads(manifest.read_text())
    exports = data.get('exports', {})
    if not isinstance(exports, dict):
        continue
    for subpath, spec in exports.items():
        if subpath == './package.json' or not isinstance(spec, dict):
            continue
        entry = spec.get('default')
        if isinstance(entry, str) and not (manifest.parent / entry).is_file():
            missing_exports.append(f"{data.get('name')}:{subpath}:{entry}")
if missing_exports:
    raise RuntimeError('Missing published export in staged closure: ' + ', '.join(missing_exports))
# Native payloads are selected dynamically and are not listed in JS exports.
# Require the current host's declared matrix before issuing a closure manifest.
host = subprocess.check_output([str(node), '-p', 'process.platform + "-" + process.arch'], env=env, text=True).strip()
for metadata_file in output.glob('node_modules/@deepseek-ai/*/prebuilds.json'):
    spec = json.loads(metadata_file.read_text())
    if spec.get('platform') != host:
        continue
    for binary in spec.get('binaries', []):
        payload = metadata_file.parent / binary['path']
        if not payload.is_file() or payload.stat().st_size == 0:
            raise RuntimeError(f'Missing declared native payload: {metadata_file.parent.name}/{binary["path"]}')
        if binary.get('kind') == 'node-api':
            subprocess.run([str(node), '-e', 'require(process.argv[1])', str(payload)], env=env, check=True)
(output / 'SOURCE.json').write_text(json.dumps({'sourceCommit': commit, 'nodeInput': str(node), 'packages': copies}, indent=2) + '\n')
files = {}
for f in sorted(output.rglob('*')):
    if f.is_symlink():
        raise RuntimeError(f'Unexpected symlink {f}')
    if f.is_file():
        files[str(f.relative_to(output))] = hashlib.sha256(f.read_bytes()).hexdigest()
manifest = output.parent / (output.name + '.files.json')
manifest.write_text(json.dumps(files, indent=2) + '\n')
print(json.dumps({'artifact': str(output), 'manifest': str(manifest), 'files': len(files), 'bytes': sum(f.stat().st_size for f in output.rglob('*') if f.is_file()), 'packages': len(copies)}))
