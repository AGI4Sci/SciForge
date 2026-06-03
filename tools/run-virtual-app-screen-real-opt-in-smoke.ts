import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type RealOptInSmokeKey =
  | 'windows-idd-real-driver'
  | 'windows-idd-real-human-input';

interface RealOptInSmokeConfig {
  readonly env: Record<string, string>;
  readonly testFile: string;
}

interface ParsedLauncherArgs {
  readonly env: Record<string, string>;
  readonly passthroughArgs: string[];
}

const SMOKES: Record<RealOptInSmokeKey, RealOptInSmokeConfig> = {
  'windows-idd-real-driver': {
    env: {
      SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_REAL_DRIVER: '1',
      SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS: '1',
    },
    testFile: 'tests/smoke/smoke-virtual-app-screen-windows-idd-real-driver-opt-in.test.ts',
  },
  'windows-idd-real-human-input': {
    env: {
      SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_REAL_HUMAN_INPUT: '1',
      SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_REAL_DRIVER: '1',
      SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS: '1',
    },
    testFile: 'tests/smoke/smoke-virtual-app-screen-windows-idd-real-human-input-opt-in.test.ts',
  },
};

async function main(): Promise<void> {
  const [smokeKey, ...rawArgs] = process.argv.slice(2);
  if (!isRealOptInSmokeKey(smokeKey)) {
    console.error([
      'Usage: node --import tsx tools/run-virtual-app-screen-real-opt-in-smoke.ts <smoke> [--linux-manifest path] [--evidence-manifest path] [node-test-args...]',
      `Known smokes: ${Object.keys(SMOKES).join(', ')}`,
    ].join('\n'));
    process.exitCode = 1;
    return;
  }

  const parsedArgs = parseVirtualAppScreenRealOptInSmokeLauncherArgs(rawArgs);
  const config = SMOKES[smokeKey];
  const child = spawn(process.execPath, [
    '--import',
    'tsx',
    '--test',
    config.testFile,
    ...parsedArgs.passthroughArgs,
  ], {
    env: {
      ...process.env,
      ...config.env,
      ...parsedArgs.env,
    },
    shell: false,
    stdio: 'inherit',
  });

  await new Promise<void>((resolve) => {
    child.on('error', (error) => {
      console.error(`Failed to start ${smokeKey} smoke: ${error.message}`);
      process.exitCode = 1;
      resolve();
    });
    child.on('exit', (code, signal) => {
      if (signal) {
        console.error(`${smokeKey} smoke terminated by signal ${signal}.`);
        process.exitCode = 1;
      } else {
        process.exitCode = code ?? 1;
      }
      resolve();
    });
  });
}

function isRealOptInSmokeKey(value: string | undefined): value is RealOptInSmokeKey {
  return value === 'windows-idd-real-driver' || value === 'windows-idd-real-human-input';
}

export function parseVirtualAppScreenRealOptInSmokeLauncherArgs(args: string[]): ParsedLauncherArgs {
  const env: Record<string, string> = {};
  const passthroughArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--linux-manifest') {
      env.SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST = requiredOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--macos-manifest') {
      env.SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST = requiredOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--evidence-manifest') {
      env.SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST = requiredOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    passthroughArgs.push(arg);
  }
  return { env, passthroughArgs };
}

function requiredOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${option} requires a path.`);
  return value;
}

const isCli = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isCli) {
  await main();
}
