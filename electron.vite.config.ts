import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'model-router-sidecar-node-entry': resolve('src/main/model-router-sidecar-node-entry.ts'),
          'plan-gateway-sidecar-node-entry': resolve('src/main/plan-gateway-sidecar-node-entry.ts'),
          'schedule-mcp-node-entry': resolve('src/main/schedule-mcp-node-entry.ts'),
          'research-search-mcp-node-entry': resolve('src/main/research-search-mcp-node-entry.ts'),
          'workflow-mcp-node-entry': resolve('src/main/workflow-mcp-node-entry.ts'),
          'workspace-intel-mcp-node-entry': resolve('src/main/workspace-intel-mcp-node-entry.ts'),
          'remote-executor-mcp-node-entry': resolve('src/main/remote-executor-mcp-node-entry.ts'),
          'write-assist-mcp-node-entry': resolve('src/main/write-assist-mcp-node-entry.ts'),
          'runtime-inspector-mcp-node-entry': resolve('src/main/runtime-inspector-mcp-node-entry.ts'),
          'scientific-skills-mcp-node-entry': resolve('src/main/scientific-skills-mcp-node-entry.ts'),
          'scientific-plotting-mcp-node-entry': resolve('src/main/scientific-plotting-mcp-node-entry.ts'),
          'bgc-discovery-mcp-node-entry': resolve('src/main/bgc-discovery-mcp-node-entry.ts'),
          'image-generation-mcp-node-entry': resolve('src/main/image-generation-mcp-node-entry.ts'),
          'ppt-master-mcp-node-entry': resolve('src/main/ppt-master-mcp-node-entry.ts'),
          'visual-document-mcp-node-entry': resolve('src/main/visual-document-mcp-node-entry.ts'),
          'computer-use-mcp-node-entry': resolve('src/main/computer-use-mcp-node-entry.ts')
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
    define: {
      __SCIFORGE_DEV_INSTANCE_ID__: JSON.stringify(process.env.SCIFORGE_DEV_INSTANCE_ID ?? '')
    },
    server: {
      // Keep the privileged renderer and launch-editor endpoint loopback-only.
      // The dev bootstrap and browser bridge both publish this exact address.
      host: '127.0.0.1',
      // Never drift to 5174+ when a stale dev renderer is already alive. The
      // bridge endpoint intentionally owns 5174, so an incremented renderer
      // would otherwise present a page backed by a different Electron main.
      port: 5173,
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
          target: 'http://127.0.0.1:5174',
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
