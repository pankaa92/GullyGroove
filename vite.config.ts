import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  let resolvedOutDir = 'dist';

  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        useCredentials: true,
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: './',
          name: 'GullyGroove — Feel the Beat',
          short_name: 'GullyGroove',
          description:
            'Stream curated Indian and global playlists with smooth crossfade and standalone mobile app playback.',
          theme_color: '#09090D',
          background_color: '#09090D',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: './',
          scope: './',
          categories: ['music', 'entertainment'],
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: ['**/assets/aistudio/**'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^\/api\//i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        enforce: 'post',
        configResolved(config) {
          resolvedOutDir = config.build.outDir || 'dist';
        },
        closeBundle: {
          order: 'post',
          sequential: true,
          handler(error?: Error): void {
            if (error) {
              return;
            }
            const outDir = path.resolve(__dirname, resolvedOutDir);
            const srcAssets = path.resolve(__dirname, 'src/assets');
            const distAssets = path.resolve(outDir, 'src/assets');
            if (fs.existsSync(outDir) && fs.existsSync(srcAssets)) {
              fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
            }
            if (fs.existsSync(outDir)) {
              fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
              const indexFile = path.join(outDir, 'index.html');
              const notFoundFile = path.join(outDir, '404.html');
              if (fs.existsSync(indexFile)) {
                fs.copyFileSync(indexFile, notFoundFile);
              }
              if (path.basename(outDir) === 'dist') {
                const docsDir = path.resolve(__dirname, 'docs');
                fs.rmSync(docsDir, {recursive: true, force: true});
                fs.cpSync(outDir, docsDir, {recursive: true, force: true});
              }
            }
          },
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
