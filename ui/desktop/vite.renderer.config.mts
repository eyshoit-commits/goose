import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  define: {
    // This replaces process.env.ALPHA with a literal at build time
    'process.env.ALPHA': JSON.stringify(process.env.ALPHA === 'true'),
  },

  plugins: [tailwindcss()],

  server: {
    host: '0.0.0.0',
    port: 8448,
    strictPort: true,
  },

  preview: {
    host: '0.0.0.0',
    port: 8448,
    strictPort: true,
  },

  build: {
    target: 'esnext'
  },
});
