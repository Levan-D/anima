import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const alias = {
  '@': resolve('src/renderer'),
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
};

// The only inline styles the UI libraries inject. No 'unsafe-inline': nothing else needs it.
// If an upgrade changes one, the console prints the new hash, and nothing else breaks.
const INLINE_STYLE_HASHES = [
  "'sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo='", // Radix's scroll lock, in every modal.
  "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='", // The empty tag motion's popLayout fills through CSSOM.
];

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  `style-src 'self' ${INLINE_STYLE_HASHES.join(' ')}`,
  "img-src 'self' art: data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' art:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Production only: Vite's dev server needs inline styles and a websocket for HMR. */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'music-player:csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias },
  },
  preload: {
    resolve: { alias },
    build: {
      // Electron's sandbox loads exactly one CommonJS file: no ESM, no chunks, no node_modules.
      externalizeDeps: false,
      rolldownOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
    build: {
      minify: true,
      // Inlined assets would become data: URLs, which the CSP doesn't allow for fonts.
      assetsInlineLimit: 0,
    },
  },
});
