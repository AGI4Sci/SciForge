#!/usr/bin/env python3
"""Read-only registry audit; never installs or executes package code/hooks."""
import base64
import concurrent.futures
import hashlib
import io
import json
import re
import subprocess
import tarfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = ['agent', 'ptc-runtime', 'invariants', 'llm', 'scope', 'session',
         'system-prompt', 'user-approval', 'sandbox', 'sandbox-policy']
VERSION = '0.2.0-rc.2'


def runtime_imports(source):
    # Parse only: package JS is stdin data and is never evaluated/imported.
    parser = r'''
const fs = require('node:fs');
const ts = require(process.cwd() + '/node_modules/typescript');
const tree = ts.createSourceFile('published.js', fs.readFileSync(0, 'utf8'),
                                 ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const imports = new Set();
function add(node) {
  if (node && ts.isStringLiteralLike(node) && !node.text.startsWith('.') && !node.text.startsWith('/')) imports.add(node.text);
}
function visit(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
  if (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
       (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(tree);
process.stdout.write(JSON.stringify([...imports].sort()));
'''
    parsed = subprocess.run(['node', '-e', parser], input=source, text=True,
                            capture_output=True, check=True, cwd=ROOT)
    return json.loads(parsed.stdout)


def audit(short_name):
    name = '@deepseek-ai/dsh-' + short_name
    url = 'https://registry.npmjs.org/' + urllib.parse.quote(name, safe='') + '/' + VERSION
    with urllib.request.urlopen(url, timeout=60) as response:
        metadata = json.load(response)
    assert metadata['name'] == name and metadata['version'] == VERSION
    tarball_url = metadata['dist']['tarball']
    assert urllib.parse.urlparse(tarball_url).netloc == 'registry.npmjs.org'
    with urllib.request.urlopen(tarball_url, timeout=60) as response:
        data = response.read()
    actual = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
    assert actual == metadata['dist']['integrity'], name
    licenses = []
    imports = set()
    sources = []
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        manifest_file = archive.extractfile('package/package.json')
        assert manifest_file is not None
        package = json.load(manifest_file)
        assert package['name'] == name and package['version'] == VERSION
        for member in archive.getmembers():
            if not member.isfile():
                continue
            member_file = archive.extractfile(member)
            assert member_file is not None
            content = member_file.read()
            relative = member.name.removeprefix('package/')
            if re.match(r'(?i)^(license|copying)', Path(relative).name):
                licenses.append({'path': relative, 'sha256': hashlib.sha256(content).hexdigest(),
                                 'text': content.decode()})
            if relative.endswith(('.js', '.mjs', '.cjs')):
                text = content.decode()
                imports.update(runtime_imports(text))
                sources.append({'path': relative, 'sha256': hashlib.sha256(content).hexdigest()})
        assert licenses, name
    record = {key: package.get(key) for key in ['name', 'version', 'license', 'repository',
              'scripts', 'dependencies', 'peerDependencies', 'peerDependenciesMeta', 'engines']}
    record.update(dist=metadata['dist'], verifiedIntegrity=True,
                  tarballSHA256=hashlib.sha256(data).hexdigest(), licenses=licenses,
                  externalRuntimeImports=sorted(imports), runtimeSources=sources,
                  deployment='audited only; complete required official closure awaits approval')
    return record


def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        records = list(pool.map(audit, NAMES))
    prior = json.loads((ROOT / 'docs/dsh-runtime-dependency-audit.json').read_text())
    approved = {row['name'] for row in prior['packages']} | {row['name'] for row in records}
    blockers = []
    for row in records:
        for field in ['dependencies', 'peerDependencies']:
            for name, version in (row[field] or {}).items():
                optional = field == 'peerDependencies' and (row['peerDependenciesMeta'] or {}).get(name, {}).get('optional', False)
                if name.startswith('@deepseek-ai/') and name not in approved:
                    blockers.append({'requestedBy': row['name'], 'kind': field,
                                     'name': name, 'version': version, 'optional': optional})
    result = {'registry': prior['registry'], 'officialCheckout': prior['officialCheckout'],
              'officialTag': prior['officialTag'], 'verification': prior['verification'],
              'packages': records, 'additionalOfficialEdges': blockers,
              'requiredAdditionalOfficialPackages': sorted({edge['name'] for edge in blockers if not edge['optional']}),
              'installation': 'STOPPED before npm resolution/install; no peer bypass or partial lock changes'}
    destination = ROOT / 'docs/dsh-approved-peers-audit.json'
    destination.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'audited': len(records), 'report': str(destination),
                      'requiredAdditionalOfficialPackages': result['requiredAdditionalOfficialPackages'],
                      'optionalNotInstalled': sorted({edge['name'] for edge in blockers if edge['optional']})}, indent=2))


if __name__ == '__main__':
    main()
