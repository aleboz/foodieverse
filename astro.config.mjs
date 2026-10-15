import { defineConfig } from 'astro/config';

// Served from https://quillis.github.io/foodieverse/
export default defineConfig({
  site: 'https://quillis.github.io',
  base: '/foodieverse',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
});
