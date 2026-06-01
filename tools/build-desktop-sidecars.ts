import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

type DesktopSidecarBundle = {
  label: string;
  entryPoint: string;
  outfile: string;
};

const projectRoot = process.cwd();
const sidecars: DesktopSidecarBundle[] = [
  {
    label: 'workspace-server',
    entryPoint: 'src/runtime/workspace-server.ts',
    outfile: 'dist-desktop/src/runtime/workspace-server.js',
  },
  {
    label: 'provider-proxy',
    entryPoint: 'packages/backend/src/cli.ts',
    outfile: 'dist-desktop/packages/backend/src/cli.js',
  },
  {
    label: 'runtime-codex',
    entryPoint: 'src/runtime/codex/codex-runtime-standalone-server.ts',
    outfile: 'dist-desktop/src/runtime/codex/codex-runtime-standalone-server.js',
  },
];

for (const sidecar of sidecars) {
  const outfile = resolve(projectRoot, sidecar.outfile);
  await build({
    absWorkingDir: projectRoot,
    entryPoints: [sidecar.entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: false,
    logLevel: 'warning',
    external: [
      // Playwright keeps these optional bidi modules behind runtime branches.
      'chromium-bidi/*',
      // node-pty ships platform-native .node binaries; keep it as a runtime
      // dependency so Electron sidecars load the correct prebuilt artifact.
      '@homebridge/node-pty-prebuilt-multiarch',
      '@homebridge/node-pty-prebuilt-multiarch/*',
      // ws is CommonJS and contains dynamic requires of Node builtins; leaving
      // it external avoids ESM bundle shims that fail inside Electron sidecars.
      'ws',
      'ws/*',
    ],
    banner: {
      js: '// Bundled by tools/build-desktop-sidecars.ts for SciForge Electron sidecar cold start.\n',
    },
  });

  const output = await stat(outfile);
  console.log(`[desktop:bundle-sidecars] ${sidecar.label} -> ${sidecar.outfile} (${output.size} bytes)`);
}
