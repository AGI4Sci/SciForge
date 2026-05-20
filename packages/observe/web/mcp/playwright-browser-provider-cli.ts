#!/usr/bin/env node
import { invokePlaywrightBrowserAutomation } from './playwright-browser-provider';

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'invoke') {
    const { mcpUrl, browserName, rawInput } = parseInvokeArgs(args);
    const input = JSON.parse(rawInput || '{}');
    const output = await invokePlaywrightBrowserAutomation({
      ...input,
      ...(mcpUrl ? { mcpUrl } : {}),
      ...(browserName ? { browserName } : {}),
    });
    printJson({ ok: true, output });
  } else {
    console.error('Usage: sciforge-playwright-browser-provider invoke [--mcp-url <url>] [--browser <name>] <jsonInput>');
    process.exitCode = 2;
  }
} catch (error) {
  printJson({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
    },
  });
  process.exitCode = 0;
}

function parseInvokeArgs(args: string[]) {
  let mcpUrl: string | undefined;
  let browserName: string | undefined;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--mcp-url') {
      mcpUrl = args[++index];
    } else if (arg === '--browser') {
      browserName = args[++index];
    } else {
      rest.push(arg);
    }
  }
  return {
    mcpUrl,
    browserName,
    rawInput: rest[0],
  };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
