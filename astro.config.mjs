import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  site: 'https://primor.cl',
  // Pages are prerendered (static, fast); only src/pages/api runs on demand as a Vercel function.
  adapter: vercel(),
  security: {
    // Content Security Policy as a <meta> on every page. Astro hashes each of its own
    // scripts and styles, so only code we shipped can run; injected <script> tags,
    // inline handlers and javascript: URLs are refused by the browser.
    // (Not active in `astro dev`; test with `npm run build && npm run preview`.)
    csp: {
      algorithm: 'SHA-384',
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "media-src 'self'",
        // the only third party: the map on /contacto
        'frame-src https://www.google.com',
        "worker-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "manifest-src 'self'",
        'upgrade-insecure-requests',
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // fonts ship as files so font-src can stay 'self' without allowing data: URLs
      assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    },
  },
});
