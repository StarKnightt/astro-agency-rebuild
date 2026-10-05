// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

const site = process.env.SITE_URL ?? 'https://astro-agency-rebuild.prasenjitt4e.workers.dev';

export default defineConfig({
  site,
  trailingSlash: 'never',
  build: {
    format: 'file',
    inlineStylesheets: 'always',
  },
  adapter: cloudflare({
    imageService: 'compile',
  }),
  session: false,
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/contact/thanks') && !page.includes('/404'),
    }),
  ],
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Schibsted Grotesk',
      cssVariable: '--font-sans',
      weights: ['400 900'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
  ],
  env: {
    schema: {
      RESEND_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),
      CONTACT_TO_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
      CONTACT_FROM_EMAIL: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
