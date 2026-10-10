// All internal links go through here so the /foodieverse/ base path is applied.
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export const href = (path = '') => base + path.replace(/^\/+/, '');
export const cityHref = (city: string) => href(`${city}/`);
export const poiHref = (city: string, slug: string) => href(`${city}/${slug}/`);
export const asset = (path: string) => href(path);
