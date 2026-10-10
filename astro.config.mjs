import { defineConfig } from 'astro/config';

// Served from https://aleboz.github.io/foodieverse/
export default defineConfig({
  site: 'https://aleboz.github.io',
  base: '/foodieverse',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
});
