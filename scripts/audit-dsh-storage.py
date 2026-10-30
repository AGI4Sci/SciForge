#!/usr/bin/env python3
"""Storage audit only: registry reads, no install/import/hook execution."""
import base64
import hashlib

def verify_integrity(data, integrity, shasum):
    actual = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
    if actual != integrity or hashlib.sha1(data).hexdigest() != shasum:
        raise ValueError('registry integrity mismatch')
    return True

import io
import json
import re
import subprocess
import tarfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.2.0-rc.2'
TARGETS = ['@deepseek-ai/dsh-' + n for n in ['storage', 'storage-domain', 'storage-json']]
HOOKS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']


def fetch(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.netloc != 'registry.npmjs.org':
        raise ValueError('only HTTPS npm registry is authorized')
    with urllib.request.urlopen(url, timeout=60) as response:
        if urllib.parse.urlparse(response.geturl()).netloc != 'registry.npmjs.org':
            raise ValueError('redirect outside registry')
        return response.read()


def runtime_imports(sources):
    # Existing TypeScript parser is read-only; published code is JSON data only.
    parser = r'''
const ts = require('typescript');
const sources = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const result = [];
for (const [path, text] of Object.entries(sources)) {
  const tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const external = new Set(), dynamic = [];
  function add(n) {
    if (!n || !ts.isStringLiteralLike(n)) { dynamic.push(n ? n.getText(tree) : '<missing>'); return; }
    if (!n.text.startsWith('.') && !n.text.startsWith('/')) external.add(n.text);
  }
  function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) add(n.moduleSpecifier);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) add(n.arguments[0]);
    ts.forEachChild(n, visit);
  }
  visit(tree);
  result.push({path, external: [...external].sort(), nonLiteralModuleLoads: dynamic});
}
process.stdout.write(JSON.stringify(result));
'''
    result = subprocess.run(['node', '-e', parser], input=json.dumps(sources),
                            text=True, capture_output=True, cwd=ROOT, check=True)
    return json.loads(result.stdout)


def edges(package):
    result = []
    optional = package.get('optionalDependencies') or {}
    for name, version in (package.get('dependencies') or {}).items():
        if name not in optional:
            result.append({'name': name, 'range': version, 'kind': 'dependency', 'optional': False})
    for name, version in optional.items():
        result.append({'name': name, 'range': version, 'kind': 'optionalDependency', 'optional': True})
    for name, version in (package.get('peerDependencies') or {}).items():
        result.append({'name': name, 'range': version, 'kind': 'peer', 'optional':
                       (package.get('peerDependenciesMeta') or {}).get(name, {}).get('optional', False)})
    return result


def package_of(specifier):
    return '/'.join(specifier.split('/')[:2]) if specifier.startswith('@') else specifier.split('/')[0]


def satisfies(version, constraint):
    output = subprocess.run(['node', '-e',
        "process.stdout.write(String(require('semver').satisfies(process.argv[1],process.argv[2])))",
        version, constraint], text=True, capture_output=True, cwd=ROOT, check=True)
    return output.stdout == 'true'


def audit(name, version):
    url = 'https://registry.npmjs.org/' + urllib.parse.quote(name, safe='') + '/' + version
    metadata = json.loads(fetch(url))
    if metadata['name'] != name or metadata['version'] != version:
        raise ValueError('metadata identity mismatch')
    data = fetch(metadata['dist']['tarball'])
    verify_integrity(data, metadata['dist']['integrity'], metadata['dist']['shasum'])
    sources, licenses, files = {}, [], []
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        manifest = archive.extractfile('package/package.json')
        if manifest is None:
            raise ValueError('missing manifest')
        package = json.load(manifest)
        if package['name'] != name or package['version'] != version:
            raise ValueError('tarball identity mismatch')
        for member in archive.getmembers():
            if not member.isfile():
                continue
            handle = archive.extractfile(member)
            if handle is None:
                raise ValueError('unreadable tar entry')
            content = handle.read()
            relative = member.name.removeprefix('package/')
            sha = hashlib.sha256(content).hexdigest()
            files.append({'path': relative, 'sha256': sha})
            if re.match(r'(?i)^(license|copying)', Path(relative).name):
                licenses.append({'path': relative, 'sha256': sha, 'text': content.decode()})
            if relative.endswith(('.js', '.cjs', '.mjs')):
                sources[relative] = content.decode()
    if not licenses:
        raise ValueError('missing license ' + name)
    parsed = runtime_imports(sources)
    imports = sorted({s for row in parsed for s in row['external']})
    declared = {e['name'] for e in edges(package)} | {name}
    builtins = set(json.loads(subprocess.check_output(['node', '-e',
        "process.stdout.write(JSON.stringify(require('node:module').builtinModules))"], text=True)))
    undeclared = sorted({s for s in imports if not s.startswith('node:') and s not in builtins
                         and package_of(s) not in declared})
    record = {k: package.get(k) for k in ['name', 'version', 'license', 'repository', 'main',
               'module', 'exports', 'types', 'scripts', 'dependencies', 'optionalDependencies',
               'peerDependencies', 'peerDependenciesMeta', 'engines', 'bin']}
    record.update(metadataURL=url, dist={k: metadata['dist'].get(k) for k in
                  ['tarball', 'integrity', 'shasum', 'signatures', 'attestations']},
                  verifiedIntegrity=True, tarballSHA256=hashlib.sha256(data).hexdigest(),
                  licenses=licenses, files=sorted(files, key=lambda f: f['path']),
                  externalRuntimeImports=imports, runtimeImportsByFile=parsed,
                  undeclaredRuntimeImports=undeclared,
                  lifecycleScripts={k:v for k,v in (package.get('scripts') or {}).items() if k in HOOKS},
                  implicitNodeGypInstall=any(f['path'] == 'binding.gyp' for f in files),
                  metadataManifestMatch=all(metadata.get(k) == package.get(k) for k in
                       ['name','version','license','scripts','dependencies','optionalDependencies',
                        'peerDependencies','peerDependenciesMeta']))
    return record


def main():
    locked = json.loads((ROOT / 'package-lock.json').read_text())['packages']
    prior = set()
    for filename in ['dsh-runtime-dependency-audit.json', 'dsh-approved-peers-audit.json',
                     'dsh-four-approved-packages-audit.json', 'dsh-ordinary-closure-audit.json']:
        prior.update((p['name'],p['version']) for p in json.loads((ROOT/'docs'/filename).read_text())['packages'])
    queue = [(name, VERSION) for name in TARGETS]
    records, graph, optional, unresolved = {}, [], [], []
    while queue:
        name, version = queue.pop(0)
        if name in records:
            continue
        record = audit(name, version)
        records[name] = record
        for edge in edges(record):
            edge = dict(edge, requestedBy=name)
            if edge['optional']:
                optional.append(edge)
                continue
            target_version = VERSION if edge['name'] in TARGETS else locked.get('node_modules/' + edge['name'], {}).get('version')
            if target_version is None or not satisfies(target_version, edge['range']):
                unresolved.append(edge)
                continue
            edge['resolvedVersion'] = target_version
            graph.append(edge)
            queue.append((edge['name'], target_version))
    additional = sorted({e['name'] for e in unresolved} | {
        r['name'] for r in records.values() if r['name'] not in TARGETS and (r['name'], r['version']) not in prior})
    evidence = {'schemaVersion':1, 'registry':'https://registry.npmjs.org',
        'officialTag':'dsh-v0.2.0-rc.2', 'officialCommit':'639ed015397290b3745d163aafe02ffee4aa3f84',
        'scope':'registry tarballs inspected as data only; no package scripts executed',
        'signatureVerification':'SRI+SHA1 checked; publisher signatures/provenance recorded, not cryptographically verified',
        'targets':TARGETS, 'packages':sorted(records.values(),key=lambda r:r['name']),
        'requiredEdges':graph, 'optionalEdgesNotAdded':optional, 'unresolvedRequiredEdges':unresolved,
        'additionalRequiredPackagesOutsidePriorApproval':additional,
        'approvedForInstallation':not additional and not unresolved and not any(r['undeclaredRuntimeImports'] for r in records.values())}
    destination=ROOT/'docs/dsh-storage-approval-audit.json'
    destination.write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'audited':len(records), 'targets':len(TARGETS), 'report':str(destination.relative_to(ROOT)),
        'requiredClosure':[r['name']+'@'+r['version'] for r in evidence['packages']],
        'additionalRequiredPackagesOutsidePriorApproval':additional,
        'unresolvedRequiredEdges':unresolved, 'approvedForInstallation':evidence['approvedForInstallation']},indent=2))
    if not evidence['approvedForInstallation']:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
