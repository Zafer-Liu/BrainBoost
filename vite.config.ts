import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    // 拆分大依赖为独立 chunk，避免单 chunk 过大
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 仅拆分体积大的特定包，其余让 Vite 自动处理
          if (id.includes('node_modules')) {
            if (id.includes('reactflow') || id.includes('@reactflow')) {
              return 'reactflow-vendor'
            }
            if (id.includes('react-markdown') || id.includes('remark') || id.includes('rehype') || id.includes('unified') || id.includes('micromark')) {
              return 'markdown-vendor'
            }
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  base: './',
})
