import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://bet-tracker.kennyatx1.workers.dev',
        changeOrigin: true,
      },
    },
  },
});
