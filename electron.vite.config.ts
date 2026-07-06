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
          'schedule-mcp-node-entry': resolve('src/main/schedule-mcp-node-entry.ts'),
          'research-search-mcp-node-entry': resolve('src/main/research-search-mcp-node-entry.ts'),
          'workflow-mcp-node-entry': resolve('src/main/workflow-mcp-node-entry.ts'),
          'workspace-intel-mcp-node-entry': resolve('src/main/workspace-intel-mcp-node-entry.ts'),
          'remote-executor-mcp-node-entry': resolve('src/main/remote-executor-mcp-node-entry.ts'),
          'write-assist-mcp-node-entry': resolve('src/main/write-assist-mcp-node-entry.ts'),
          'paper-radar-mcp-node-entry': resolve('src/main/paper-radar-mcp-node-entry.ts'),
          'runtime-inspector-mcp-node-entry': resolve('src/main/runtime-inspector-mcp-node-entry.ts'),
          'scientific-skills-mcp-node-entry': resolve('src/main/scientific-skills-mcp-node-entry.ts'),
          'scientific-plotting-mcp-node-entry': resolve('src/main/scientific-plotting-mcp-node-entry.ts'),
          'image-generation-mcp-node-entry': resolve('src/main/image-generation-mcp-node-entry.ts'),
          'ppt-master-mcp-node-entry': resolve('src/main/ppt-master-mcp-node-entry.ts'),
          'sciforge-canvas-mcp-node-entry': resolve('src/main/sciforge-canvas-mcp-node-entry.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
    server: {
      // Bind the web dev surface on both loopback families so browser debugging
      // works whether localhost resolves to ::1 or 127.0.0.1.
      host: '::',
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
