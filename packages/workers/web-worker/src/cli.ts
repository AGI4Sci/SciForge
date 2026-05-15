#!/usr/bin/env node
import { assertToolInvokeRequest } from '../../../contracts/tool-worker/src/index';
import { webWorkerManifest } from './manifest';
import { startWebWorkerServer } from './server';
import { createWebWorker } from './worker';

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'manifest') {
    printJson(webWorkerManifest);
  } else if (command === 'health') {
    printJson(await createWebWorker().health());
  } else if (command === 'invoke') {
    const [toolId, rawInput = '{}'] = args;
    if (!toolId) throw new Error('Usage: invoke <toolId> <jsonInput>');
    const request = { toolId, input: JSON.parse(rawInput) };
    assertToolInvokeRequest(request);
    printJson(await createWebWorker().invoke(request));
  } else if (command === 'serve') {
    const options = parseServeArgs(args);
    const server = await startWebWorkerServer(options);
    console.log(`SciForge web worker listening on ${server.url}`);
  } else {
    console.error('Usage: sciforge-web-worker <manifest|health|invoke|serve>');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseServeArgs(args: string[]): { host?: string; port?: number } {
  const options: { host?: string; port?: number } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--host') {
      options.host = args[++index];
    } else if (arg === '--port') {
      options.port = Number(args[++index]);
      if (!Number.isInteger(options.port) || options.port < 0) {
        throw new Error('--port must be a non-negative integer');
      }
    } else {
      throw new Error(`Unknown serve option: ${arg}`);
    }
  }
  return options;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
