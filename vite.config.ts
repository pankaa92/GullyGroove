import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  let resolvedOutDir = 'dist';

  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        configResolved(config) {
          resolvedOutDir = config.build.outDir || 'dist';
        },
        closeBundle(error?: Error): void {
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
