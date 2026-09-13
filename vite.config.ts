import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

/**
 * Vite 构建配置。
 *
 * 版本锁定说明（见 ARCHITECTURE.md §6）：
 * - Vite 5 + vite-plugin-pwa 0.20.x 为稳定配对，不要升级到 Vite 6；
 * - Tailwind 锁 v3，不用 v4。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const brandName = env.VITE_BRAND_NAME ?? '师创';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons/*.png'],
        // 仅预缓存 App Shell，绝不预缓存业务数据（广场列表 / 应用 HTML）
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png}'],
          // ⚠️ T06 红线：three（~747KB）绝不进 SW 预缓存。
          //    否则教师首次打开平台就会被 Service Worker 静默下载 747KB，
          //    哪怕他这学期一次 3D 课件都不做。改为「用到再缓存」（下方 CacheFirst）。
          globIgnores: ['**/three.module-*.js', '**/OrbitControls-*.js'],
          navigateFallback: '404.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/functions\//],
          runtimeCaching: [
            {
              // 3D 运行时：首次真正打开 3D 课件时才下载，之后缓存 30 天（离线可再看）
              urlPattern: /\/assets\/(three\.module|OrbitControls)-[^/]*\.js$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'three-runtime',
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // 应用广场列表：SWR（stale-while-revalidate）60s
              urlPattern: /\/rest\/v1\/rpc\/list_square(\?.*)?$/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'square-list',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        manifest: {
          name: brandName,
          short_name: brandName,
          description: '一句话，做出你的教学应用',
          lang: 'zh-CN',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#F7F8FA',
          theme_color: '#2F6BFF',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }) as PluginOption,
    ],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), 'src'),
      },
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
    },
  };
});
