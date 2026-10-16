import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'FitLog - 训练记录',
        short_name: 'FitLog',
        description: '健身训练记录 PWA 应用',
        theme_color: '#10b981',
        background_color: '#030712',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: '/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^\/api\/v1\/exercises/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-exercises',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            urlPattern: /\/media\/(exercises|exercises-dataset)\/.*\.(jpg|jpeg|webp|png|gif|mp4|webm|svg)/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'media-exercises-v2',
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /^\/api\/v1\/workouts/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^\/api\/v1\/auth/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },

  },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-router-dom') || id.includes('react-dom') || id.includes('react/')) {
              return 'vendor-react';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('recharts')) {
              return 'vendor-charts';
            }
            if (id.includes('d3-')) {
              return 'vendor-d3';
            }
            if (id.includes('axios') || id.includes('zustand')) {
              return 'vendor-utils';
            }
          }
        },
      },
    },
  },
});
