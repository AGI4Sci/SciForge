import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES,
  runWebSearchProductOrdinaryChatAcceptance,
  validateWebSearchProductAcceptanceManifest,
} from '../tests/smoke/helpers/web-search-product-acceptance-fixtures.js';

const DEFAULT_OUT_DIR = 'docs/test-artifacts/web-search-product-acceptance';
const DEFAULT_COMMAND_TEXT = [
  '普通聊天入口 product proof：使用 web_search 搜索一下伊朗局势，至少提供5条信息，',
  '用中文简要回答，并在最终回答中包含当前搜索结果里的 HTTP(S) 来源链接。',
  '除非任务明确要求读取页面正文，不要强制使用 web_read。',
].join('');

type TaskClass = typeof WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES[number];
type ProductProofRoute = 'native' | 'fallback';

interface CliArgs {
  outDir: string;
  workspacePath: string;
  taskClass: TaskClass;
  commandText: string;
  route?: ProductProofRoute;
  commandId?: string;
  attemptId?: string;
  threadId?: string;
  timeoutMs?: number;
  json: boolean;
}

export async function runWebSearchProductAcceptanceCli(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(helpText());
    return 0;
  }

  let args: CliArgs;
  try {
    args = parseArgs(argv, env);
  } catch (error) {
    process.stderr.write(`${messageFromError(error)}\n\n${helpText()}`);
    return 2;
  }

  await mkdir(args.outDir, { recursive: true });
  const manifest = await runWebSearchProductOrdinaryChatAcceptance({
    workspacePath: args.workspacePath,
    artifactDir: args.outDir,
    taskClass: args.taskClass,
    commandText: args.commandText,
    ...(args.commandId ? { commandId: args.commandId } : {}),
    ...(args.attemptId ? { attemptId: args.attemptId } : {}),
    ...(args.threadId ? { threadId: args.threadId } : {}),
    ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
    env: envWithWebSearchRoute(env, args.route),
  });
  const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
    artifactRoot: args.outDir,
    requireProductProof: true,
  });

  const summary = {
    status: manifest.status,
    productProof: validation.productProof,
    releaseEligible: validation.releaseEligible,
    route: manifest.currentRun.route,
    manifestPath: resolve(args.outDir, 'manifest.json'),
    blockers: validation.blockers,
    blockedReason: manifest.blockedReason,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write([
      `web_search product acceptance status: ${summary.status}`,
      `productProof: ${summary.productProof}`,
      `releaseEligible: ${summary.releaseEligible}`,
      `manifest: ${summary.manifestPath}`,
      ...(summary.blockedReason ? [`blockedReason: ${summary.blockedReason}`] : []),
      ...(summary.blockers.length ? ['blockers:', ...summary.blockers.map((blocker) => `- ${blocker}`)] : []),
      '',
    ].join('\n'));
  }

  return validation.productProof && validation.releaseEligible ? 0 : 2;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): CliArgs {
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unknown positional argument: ${arg}`);
    const name = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
    values.set(name, value);
    index += 1;
  }

  const taskClass = values.get('task-class') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_TASK_CLASS ?? 'ordinary-web-lookup';
  if (!isTaskClass(taskClass)) {
    throw new Error(`Invalid --task-class ${taskClass}; expected one of ${WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES.join(', ')}`);
  }

  return {
    outDir: resolve(values.get('out') ?? values.get('out-dir') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_ACCEPTANCE_OUT ?? DEFAULT_OUT_DIR),
    workspacePath: resolve(values.get('workspace') ?? env.SCIFORGE_WORKSPACE_PATH ?? process.cwd()),
    taskClass,
    commandText: values.get('prompt') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_ACCEPTANCE_PROMPT ?? DEFAULT_COMMAND_TEXT,
    route: productProofRoute(values.get('route') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_ACCEPTANCE_ROUTE),
    commandId: values.get('command-id') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_COMMAND_ID,
    attemptId: values.get('attempt-id') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_ATTEMPT_ID,
    threadId: values.get('thread-id') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_THREAD_ID,
    timeoutMs: positiveInteger(values.get('timeout-ms') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_ACCEPTANCE_TIMEOUT_MS),
    json,
  };
}

function helpText(): string {
  return [
    'Usage: tsx tools/web-search-product-acceptance.ts [--out dir] [--workspace path] [--task-class class] [--prompt text] [--json]',
    '',
    'Runs the real ordinary-chat live product proof harness for current-run web_search evidence plus final source links.',
    'This is not a scaffold: it calls CodexAppServerClient.startTurn() and passes ordinary search when current-run web_search refs support the final answer.',
    'Read-required prompts still fail closed unless current-run web_read source/page text evidence is present.',
    '',
    'Required live configuration:',
    '  config.local.json              Member-model provider/baseUrl/model/apiKey for the SciForge Model Router.',
    '  Model Router                   Runtime Codex is bootstrapped to the local Model Router profile automatically.',
    '  SCIFORGE_SEARXNG_BASE_URL      Recommended live search provider for fallback web_search.',
    '  or Codex native web_search / another configured live web_search provider supported by the Runtime.',
    '',
    'Options:',
    `  --out dir                 Artifact directory. Default: ${DEFAULT_OUT_DIR}`,
    '  --workspace path          Workspace path. Default: SCIFORGE_WORKSPACE_PATH or cwd.',
    `  --task-class class        ${WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES.join(' | ')}. Default: ordinary-web-lookup.`,
    '  --prompt text             Ordinary-chat user prompt to send through the desktop-default-chat/App Server entrypoint.',
    '  --route native|fallback   Select Codex native web_search or SciForge fallback web_search. Maps to SCIFORGE_WEB_SEARCH_MODE.',
    '  --command-id id           Current run id override.',
    '  --attempt-id id           Attempt id override.',
    '  --thread-id id            Existing ordinary-chat thread id override.',
    '  --timeout-ms ms           Product proof runner timeout before writing a blocked manifest.',
    '  --json                    Print machine-readable summary.',
    '',
    'Example:',
    '  SCIFORGE_SEARXNG_BASE_URL=http://127.0.0.1:8080 npm run web-search-product-acceptance -- --route fallback --out docs/test-artifacts/web-search-product-acceptance --json',
    '',
  ].join('\n');
}

function isTaskClass(value: string): value is TaskClass {
  return WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES.includes(value as TaskClass);
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function productProofRoute(value: string | undefined): ProductProofRoute | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'native' || normalized === 'fallback') return normalized;
  throw new Error(`Invalid --route ${value}; expected native or fallback`);
}

function envWithWebSearchRoute(env: NodeJS.ProcessEnv, route: ProductProofRoute | undefined): NodeJS.ProcessEnv {
  if (!route) return env;
  return {
    ...env,
    SCIFORGE_WEB_SEARCH_MODE: route,
  };
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const exitCode = await runWebSearchProductAcceptanceCli();
  process.exitCode = exitCode;
}
