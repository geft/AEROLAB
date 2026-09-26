import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'snapshot' ? [{
      name: 'snapshot-api-client',
      enforce: 'pre' as const,
      resolveId(source: string) {
        if (source.endsWith('/api/client.js')) return path.resolve('src/frontend/api/snapshot-client.ts');
        return null;
      }
    }] : [])
  ],
  define: {
    'import.meta.env.VITE_AEROLAB_TARGET': JSON.stringify(mode === 'snapshot' ? 'snapshot' : 'desktop')
  },
  build: mode === 'snapshot' ? { outDir: 'dist-snapshot', emptyOutDir: true } : undefined,
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  }
}));
