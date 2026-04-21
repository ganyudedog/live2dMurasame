import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    tailwindcss(),
    nodePolyfills({
      protocolImports: true,
    })
  ],
  server: {
    port: 5180,
    proxy: {
      '/v3': {
        target: 'http://127.0.0.1:9881',
      },
    }
  },
  optimizeDeps: {
    include: ['pixi-live2d-display', 'eventemitter3'],
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    }
  }
})
