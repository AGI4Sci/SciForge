import { resolve } from 'path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { installedMainSourcePackageNames } from './src/main/modules/installed-main-source-packages'
import { stageDomainMainNativeAddons } from './scripts/domain-main-native-addons.mjs'
import { stagePluginRuntimeRunner } from './scripts/plugin-runtime-runner-staging.mjs'

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_DEV_RENDERER_PORT = 5173
const DEFAULT_DEV_BRIDGE_PORT = 5174

function configuredDevPort(name: string, fallback: number): number {
  const value = process.env[name]?.trim()
  if (!value) return fallback
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : fallback
}

const devRendererPort = configuredDevPort('SCIFORGE_DEV_RENDERER_PORT', DEFAULT_DEV_RENDERER_PORT)
const devBridgePort = configuredDevPort('SCIFORGE_DEV_BROWSER_BRIDGE_PORT', DEFAULT_DEV_BRIDGE_PORT)

type MainBundleOutput = Readonly<Record<string, Readonly<{
  type: string
  imports?: readonly string[]
  dynamicImports?: readonly string[]
}>>>

export function assertNoBareMainSourcePackageImports(
  bundle: MainBundleOutput,
  packageNames: readonly string[] = installedMainSourcePackageNames
): void {
  const bareImports = new Set<string>()
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue
    for (const specifier of [...(output.imports ?? []), ...(output.dynamicImports ?? [])]) {
      if (packageNames.some((packageName) =>
        specifier === packageName || specifier.startsWith(`${packageName}/`)
      )) {
        bareImports.add(specifier)
      }
    }
  }
  if (bareImports.size > 0) {
    throw new Error(
      `Electron main bundle left public source package imports external: ${[...bareImports].sort().join(', ')}`
    )
  }
}

function mainSourcePackageBundleGuard(): Plugin {
  return {
    name: 'sciforge:main-source-package-bundle-guard',
    generateBundle(_options, bundle) {
      assertNoBareMainSourcePackageImports(bundle)
    }
  }
}

function domainMainNativeAddonStaging(): Plugin {
  return {
    name: 'sciforge:stage-domain-main-native-addons',
    async writeBundle(outputOptions) {
      if (!outputOptions.dir) {
        throw new Error('Electron main output directory is required for native addon staging.')
      }
      await stageDomainMainNativeAddons({
        repositoryRoot,
        mainOutputDirectory: resolve(repositoryRoot, outputOptions.dir),
        platform: process.platform
      })
    }
  }
}

/**
 * The installed-plugin runner must exist next to the bundled Host, because that
 * is where the Host looks for it once the app is packaged. Without it a packaged
 * app cannot start any installed plugin — and its market never appears. The DSH
 * runtime packages the runner imports travel as explicit file sets from
 * electron-builder.config.cjs.
 */
function pluginRuntimeRunnerStaging(): Plugin {
  return {
    name: 'sciforge:stage-plugin-runtime-runner',
    async writeBundle(outputOptions) {
      if (!outputOptions.dir) {
        throw new Error('Electron main output directory is required for plugin runtime staging.')
      }
      await stagePluginRuntimeRunner({
        repositoryRoot,
        mainOutputDirectory: resolve(repositoryRoot, outputOptions.dir)
      })
    }
  }
}

export default defineConfig({
  main: {
    // The generated list is the public TypeScript workspace dependency closure
    // of the Host and installed main domains. Packaged Electron must not depend
    // on source entrypoints remaining in node_modules.
    plugins: [
      externalizeDepsPlugin({
        exclude: [...installedMainSourcePackageNames]
      }),
      mainSourcePackageBundleGuard(),
      domainMainNativeAddonStaging(),
      pluginRuntimeRunnerStaging()
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'model-router-sidecar-node-entry': resolve('src/main/model-router-sidecar-node-entry.ts'),
          'plan-gateway-sidecar-node-entry': resolve('src/main/plan-gateway-sidecar-node-entry.ts'),
          'codex-pre-tool-use-governance-node-entry': resolve(
            'src/main/codex-pre-tool-use-governance-node-entry.ts'
          ),
          'schedule-mcp-node-entry': resolve('src/main/schedule-mcp-node-entry.ts'),
          'research-search-mcp-node-entry': resolve('src/main/research-search-mcp-node-entry.ts'),
          'workspace-intel-mcp-node-entry': resolve('src/main/workspace-intel-mcp-node-entry.ts'),
          'write-assist-mcp-node-entry': resolve('src/main/write-assist-mcp-node-entry.ts'),
          'runtime-inspector-mcp-node-entry': resolve('src/main/runtime-inspector-mcp-node-entry.ts'),
          'scientific-skills-mcp-node-entry': resolve('src/main/scientific-skills-mcp-node-entry.ts'),
          'scientific-plotting-mcp-node-entry': resolve('src/main/scientific-plotting-mcp-node-entry.ts'),
          'bgc-discovery-mcp-node-entry': resolve('src/main/bgc-discovery-mcp-node-entry.ts'),
          'image-generation-mcp-node-entry': resolve('src/main/image-generation-mcp-node-entry.ts'),
          'ppt-master-mcp-node-entry': resolve('src/main/ppt-master-mcp-node-entry.ts'),
          'domain-runtime-mcp-node-entry': resolve('src/main/domain-runtime-mcp-node-entry.ts')
        }
      }
    }
  },
  preload: {
    // Sandbox preloads cannot resolve external zod at runtime; keep it bundled
    // whenever shared preload code pulls it into this build graph.
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    // PDF.js Adobe CMaps are binary assets. Mark them explicitly so the
    // renderer can lazy-import packed maps for CID fonts in dev and builds.
    assetsInclude: ['**/*.bcmap'],
    define: {
      __SCIFORGE_DEV_INSTANCE_ID__: JSON.stringify(process.env.SCIFORGE_DEV_INSTANCE_ID ?? '')
    },
    server: {
      // Keep the privileged renderer and launch-editor endpoint loopback-only.
      // The dev bootstrap and browser bridge both publish this exact address.
      host: '127.0.0.1',
      // The normal dev profile uses 5173; isolated eval profiles inject a
      // free renderer port so they can coexist with a user-owned Host.
      port: devRendererPort,
      strictPort: true,
      fs: {
        strict: true,
        deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**']
      },
      // The renderer HTML keeps a strict script-src CSP. React Fast Refresh adds
      // an inline module preamble in dev, which loopback browser previews reject
      // and then lazy routes hang at the startup fallback.
      hmr: false,
      proxy: {
        '/__sciforge-dev-bridge': {
          target: `http://127.0.0.1:${devBridgePort}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/__sciforge-dev-bridge/, '')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
