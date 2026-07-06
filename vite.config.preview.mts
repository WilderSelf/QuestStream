import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone Vite server for the RENDERER ONLY, so the UI can be opened in a plain browser
// (Electron won't stay alive in this container). window.api is mocked by preview-api.js.
// Not part of the app build — used only for visual review via the Preview MCP.
const root = resolve(process.cwd(), 'src/renderer')

export default defineConfig({
  root,
  resolve: {
    alias: {
      '@renderer': resolve(process.cwd(), 'src/renderer/src'),
      '@shared': resolve(process.cwd(), 'src/shared')
    }
  },
  plugins: [
    react(),
    {
      // The Preview MCP opens `/`, but the mocked entry is preview.html (index.html is the real
      // Electron entry with no window.api mock). Rewrite `/` → preview.html so screenshots work.
      name: 'serve-preview-entry',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/' || req.url === '/index.html') req.url = '/preview.html'
          next()
        })
      }
    }
  ],
  server: { port: 5199, strictPort: true }
})
