import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface RuntimeContractPackageJson {
  files?: unknown;
  exports?: Record<string, unknown>;
}

const packageRoot = join(process.cwd(), 'packages/contracts/runtime');
const indexText = await readFile(join(packageRoot, 'index.ts'), 'utf8');
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as RuntimeContractPackageJson;
const packageFiles = new Set(Array.isArray(packageJson.files) ? packageJson.files.map(String) : []);
const packageExports = isRecord(packageJson.exports) ? packageJson.exports : {};

const publicLocalModules = [...indexText.matchAll(/from ['"]\.\/([^'"]+)['"]/g)]
  .map((match) => match[1])
  .filter((specifier) => !specifier.includes('/'));
const uniquePublicLocalModules = [...new Set(publicLocalModules)].sort();

assert.ok(uniquePublicLocalModules.length > 0, 'runtime contract barrel must expose local public modules');

const failures: string[] = [];
for (const moduleName of uniquePublicLocalModules) {
  const fileName = `${moduleName}.ts`;
  try {
    await access(join(packageRoot, fileName));
  } catch {
    failures.push(`missing source file for ./${moduleName}`);
    continue;
  }
  if (!packageFiles.has(fileName)) {
    failures.push(`packages/contracts/runtime/package.json files must include ${fileName}`);
  }
  if (packageExports[`./${moduleName}`] !== `./${fileName}`) {
    failures.push(`packages/contracts/runtime/package.json exports["./${moduleName}"] must be "./${fileName}"`);
  }
}

assert.deepEqual(failures, []);
console.log('runtime contract package manifest smoke passed');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
