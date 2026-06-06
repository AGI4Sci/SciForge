import { spawn } from 'node:child_process';

const env: NodeJS.ProcessEnv = {
  ...process.env,
  SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE: '1',
};

delete env.SCIFORGE_DESKTOP_RENDERER_URL;
delete env.SCIFORGE_DESKTOP_DEV;
delete env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
delete env.VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL;
delete env.VITE_SCIFORGE_DEFAULT_AGENT_SERVER_URL;
delete env.VITE_SCIFORGE_DEFAULT_WORKSPACE_PATH;

const child = spawn(
  process.execPath,
  ['--import', 'tsx', 'tests/smoke/smoke-desktop-browser-native-live-acceptance.ts'],
  {
    env,
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
