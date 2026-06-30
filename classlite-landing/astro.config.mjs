// @ts-check
import { defineConfig, envField } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Story 1.10 AC1 — i18n routing. The CF Pages Function at
  // `functions/index.ts` handles the per-request Accept-Language
  // redirect; here we tell Astro that `/vi/` is the default locale
  // (Vietnamese is co-primary per UX-2).
  i18n: {
    locales: ['vi', 'en'],
    defaultLocale: 'vi',
    routing: {
      prefixDefaultLocale: true,
    },
  },
  // Story 1.10 AC7 + R-NEW-55 (Amelia BLOCKER #7). Typed env schema
  // for the dashboard URL — closes the open-redirect attack surface
  // by forbidding silently-absent / mistyped values.
  env: {
    schema: {
      PUBLIC_DASHBOARD_URL: envField.string({
        context: 'client',
        access: 'public',
      }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});